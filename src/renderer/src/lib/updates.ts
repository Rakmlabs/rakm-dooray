// 자동 업데이트 상태: main 이 보내는 것을 들고 있다가 화면 위 띠·설정 화면이 같이 쓴다.
import { useSyncExternalStore } from 'react'
import type { UpdateStatus } from '@shared/types-updates'
import { call, onEvent } from '../api'

let status: UpdateStatus | null = null
const listeners = new Set<() => void>()
let started = false

function set(next: UpdateStatus) {
  status = next
  for (const l of listeners) l()
}

function start() {
  if (started) return
  started = true
  void call('updates:status')
    .then(set)
    .catch(() => {})
  onEvent('updates:status', set)
}

export function useUpdates(): UpdateStatus | null {
  start()
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => status
  )
}

export const checkUpdates = () => call('updates:check').then(set)
export const restartToUpdate = () => call('updates:restart')
