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
 * 대화방(또는 스레드 채널) 메시지. 두레이에는 메시지 조회용 공식 API 가 없어
 * 비공식 GET .../logs?size=N (최신 N개, 최대 1000) 을 쓴다. 실시간 이벤트가 없으면 주기적으로 다시 읽는다.
 */
export function useChannelLogs(channelId: string | null, active: boolean, initialSize = 100) {
  const { settings, realtime } = useApp()
  const [messages, setMessages] = useState<Message[]>([])
  const [size, setSize] = useState(initialSize)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inflight = useRef(false)
  const current = useRef(channelId)
  current.current = channelId

  const load = useCallback(
    async (quiet = false) => {
      if (!channelId || inflight.current) return
      inflight.current = true
      if (!quiet) setLoading(true)
      try {
        const list = await call('messenger:logs', channelId, size)
        if (current.current === channelId) {
          setMessages((prev) => (sameList(prev, list) ? prev : list))
          setError(null)
        }
      } catch (e) {
        if (current.current === channelId) setError(errorText(e))
      } finally {
        inflight.current = false
        if (!quiet) setLoading(false)
      }
    },
    [channelId, size]
  )

  useEffect(() => {
    setMessages([])
    setError(null)
    setSize(initialSize)
  }, [channelId, initialSize])

  useEffect(() => {
    void load()
  }, [load])

  // 실시간 연결이 되어 있으면 이벤트로, 아니면 폴링으로. 실시간이어도 놓친 것을 위해 느린 폴링은 유지한다.
  const pollMs = (settings?.dooray.pollSeconds ?? 4) * 1000 * (realtime.mode === 'socket' ? 8 : 1)
  useInterval(() => void load(true), pollMs, active && !!channelId)

  useEffect(() => {
    if (!channelId) return
    return onEvent('messenger:activity', (a) => {
      if (a.channelId === channelId) void load(true)
    })
  }, [channelId, load])

  const loadMore = useCallback(() => setSize((s) => Math.min(1000, s + 200)), [])

  return { messages, loading, error, reload: () => load(true), loadMore, canLoadMore: size < 1000 && messages.length >= size }
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
