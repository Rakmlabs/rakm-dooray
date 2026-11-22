import { useCallback, useEffect, useRef, useState } from 'react'
import type { Message } from '@shared/types'
import { call, errorText, onEvent } from '../api'
import { useApp } from '../state'

/** active 일 때 ms 간격으로 fn 을 부른다. 창이 숨겨져 있으면 쉰다. */
export function useInterval(fn: () => void, ms: number, active: boolean): void {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!active || ms <= 0) return
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') ref.current()
    }, ms)
    return () => window.clearInterval(id)
  }, [ms, active])
}

/**
 * 열린 대화방·스레드를 다시 읽는 간격 (설정에서 바꾸지 않는다).
 * - 창이 앞에 있을 때 3초: 요청 하나가 GET .../logs 한 번이라 열린 방 0.33회/초, 스레드를 같이 열어도 0.67회/초.
 *   뒤에서 안 읽음을 훑는 것(15초마다 3~4방 + 채널 목록 25초)을 더해도 1회/초 안쪽이다.
 *   두레이 요청 제한은 1초마다 토큰이 차는 토큰 버킷(수치 비공개)이라, 초당 1회 안쪽이면 걸리지 않는 것으로 봤다.
 *   남은 토큰이 바닥나면 main 의 http.ts 가 1초 쉬고 보내고, 429 를 받으면 물러났다 다시 시도한다.
 * - 창이 보이지만 다른 앱이 앞에 있으면 10초, 창이 숨겨지거나 최소화되면 멈춘다 (안 읽음·알림은 main 이 따로 훑는다).
 * - 실시간 연결(Socket Mode)이 되어 있으면 놓친 것을 위한 15초.
 */
export const POLL_FOCUSED_MS = 3_000
export const POLL_BACKGROUND_MS = 10_000
export const POLL_REALTIME_MS = 15_000

/** 창 상태에 맞춰 fn 을 부른다: 앞에 있으면 fastMs, 보이기만 하면 slowMs, 숨겨지면 쉰다. 창이 다시 앞에 오면 바로 한 번. */
export function usePolling(fn: () => void, fastMs: number, slowMs: number, active: boolean): void {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!active) return
    let last = Date.now()
    const run = () => {
      last = Date.now()
      ref.current()
    }
    const id = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - last >= (document.hasFocus() ? fastMs : slowMs) - 50) run()
    }, fastMs)
    const onFocus = () => {
      if (Date.now() - last > fastMs) run()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [fastMs, slowMs, active])
}

/**
 * 대화방(또는 스레드 채널) 메시지. 두레이에는 메시지 조회용 공식 API 가 없어
 * 비공식 GET .../logs?size=N (최신 N개, 최대 1000) 을 쓴다. 실시간 이벤트가 없으면 주기적으로 다시 읽는다.
 *
 * 받아 온 메시지는 main 의 로컬 보관함에 쌓이고, 화면은 보관함 기준으로 보여준다 (shell:logs).
 * 그래서 "이전 메시지 더 보기"는 서버의 1000개를 넘어 예전에 받아 둔 기록까지 이어진다.
 * 서버에 연결되지 않아도 보관함에 있는 것은 보인다.
 */
export function useChannelLogs(channelId: string | null, active: boolean, initialSize = 100) {
  const { realtime } = useApp()
  const [messages, setMessages] = useState<Message[]>([])
  const [limit, setLimit] = useState(initialSize)
  const [hasOlder, setHasOlder] = useState(false)
  const [serverFull, setServerFull] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [includeId, setIncludeId] = useState<string | null>(null)
  const inflight = useRef(false)
  const backfilled = useRef(false)
  const wantBackfill = useRef(false)
  const rerun = useRef(false)
  const current = useRef(channelId)
  current.current = channelId

  const load = useCallback(
    async (quiet = false) => {
      if (!channelId) return
      if (inflight.current) {
        rerun.current = true
        return
      }
      inflight.current = true
      const serverSize = wantBackfill.current ? 1000 : initialSize
      wantBackfill.current = false
      if (!quiet) setLoading(true)
      try {
        const r = await call('shell:logs', channelId, serverSize, limit, includeId)
        if (current.current === channelId) {
          setMessages((prev) => (sameList(prev, r.messages) ? prev : r.messages))
          setHasOlder(r.hasOlder)
          if (r.serverCount >= serverSize) setServerFull(true)
          setError(r.error)
        }
      } catch (e) {
        if (current.current === channelId) setError(errorText(e))
      } finally {
        inflight.current = false
        if (!quiet) setLoading(false)
        if (rerun.current) {
          rerun.current = false
          void loadRef.current(true)
        }
      }
    },
    [channelId, limit, includeId, initialSize]
  )
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    setMessages([])
    setError(null)
    setLimit(initialSize)
    setHasOlder(false)
    setServerFull(false)
    setIncludeId(null)
    backfilled.current = false
    wantBackfill.current = false
  }, [channelId, initialSize])

  useEffect(() => {
    void load()
  }, [load])

  // 실시간 연결이 되어 있으면 이벤트로, 아니면 폴링으로. 실시간이어도 놓친 것을 위해 느린 폴링은 유지한다.
  const socket = realtime.mode === 'socket'
  usePolling(() => void load(true), socket ? POLL_REALTIME_MS : POLL_FOCUSED_MS, socket ? POLL_REALTIME_MS : POLL_BACKGROUND_MS, active && !!channelId)

  useEffect(() => {
    if (!channelId) return
    return onEvent('messenger:activity', (a) => {
      if (a.channelId === channelId) void load(true)
    })
  }, [channelId, load])

  const loadMore = useCallback(() => {
    // 보관함에 더 오래된 것이 없으면 서버의 최대치(1000)를 한 번 받아 채운다 (limit 이 바뀌면 다시 읽는다)
    if (!backfilled.current && !hasOlder && serverFull) {
      backfilled.current = true
      wantBackfill.current = true
    }
    setLimit((s) => s + 200)
  }, [hasOlder, serverFull])

  /** 이 메시지가 보이도록 불러온다 (검색 결과·알림에서 이동할 때) */
  const ensure = useCallback((id: string | null) => setIncludeId(id), [])

  return {
    messages,
    loading,
    error,
    reload: () => load(true),
    loadMore,
    ensure,
    canLoadMore: hasOlder || (serverFull && !backfilled.current)
  }
}

function sameList(a: Message[], b: Message[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (
      x.id !== y.id ||
      x.text !== y.text ||
      x.flags !== y.flags ||
      x.thread?.totalCount !== y.thread?.totalCount ||
      x.thread?.lastUpdatedAt !== y.thread?.lastUpdatedAt
    )
      return false
  }
  return true
}
