// 읽음 확인: main 이 보내는 상대 기록을 들고 있고, 화면에 보이는 대화방의 마지막 메시지를 main 에 알린다.
import { useEffect, useSyncExternalStore } from 'react'
import type { Message } from '@shared/types'
import type { ReceiptsSnapshot } from '@shared/types-receipts'
import { call, onEvent } from '../api'

let snap: ReceiptsSnapshot = { enabled: false, meId: null, peers: {} }
const listeners = new Set<() => void>()
let started = false

/** 대화방 ID → 멤버 (메신저 화면이 채널 목록을 받을 때 채운다). 스레드는 원래 방의 멤버를 쓴다 */
const members = new Map<string, string[]>()

function set(next: ReceiptsSnapshot) {
  snap = next
  for (const l of listeners) l()
}

function start() {
  if (started) return
  started = true
  void call('receipts:snapshot')
    .then(set)
    .catch(() => {})
  onEvent('receipts:snapshot', set)
  // 화면이 앞에 있는지 main 에 알린다 (앞에 있을 때만 상대 기록을 자주 읽는다)
  const sendFocus = () => void call('receipts:focus', document.hasFocus() && document.visibilityState === 'visible').catch(() => {})
  window.addEventListener('focus', sendFocus)
  window.addEventListener('blur', sendFocus)
  document.addEventListener('visibilitychange', sendFocus)
  sendFocus()
}

export function useReceipts(): ReceiptsSnapshot {
  start()
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => snap
  )
}

export function setChannelMembers(list: { id: string; participantIds: string[] }[]): void {
  for (const c of list) members.set(c.id, c.participantIds)
}

export function membersOf(channelId: string | null | undefined): string[] {
  return (channelId && members.get(channelId)) || []
}

const reported = new Map<string, number>()

/**
 * 창이 앞에 있고 이 목록이 실제로 보일 때, 목록의 마지막 메시지까지 읽은 것으로 main 에 알린다.
 * (스레드 목록도 같은 방식. 스레드는 스레드 채널 ID 로 따로 센다)
 */
export function useReportSeen(channelId: string | null, messages: Message[], visible: boolean): void {
  useEffect(() => {
    if (!channelId || !visible) return
    const report = () => {
      if (!document.hasFocus() || document.visibilityState !== 'visible') return
      let last: Message | null = null
      for (const m of messages) if (!last || m.seq > last.seq) last = m
      if (!last || (reported.get(channelId) ?? -Infinity) >= last.seq) return
      const at = last.sentAt ? Date.parse(last.sentAt) : Date.now()
      reported.set(channelId, last.seq)
      void call('receipts:seen', channelId, last.seq, Number.isFinite(at) ? at : Date.now()).catch(() => reported.delete(channelId))
    }
    report()
    window.addEventListener('focus', report)
    document.addEventListener('visibilitychange', report)
    return () => {
      window.removeEventListener('focus', report)
      document.removeEventListener('visibilitychange', report)
    }
  }, [channelId, messages, visible])
}
