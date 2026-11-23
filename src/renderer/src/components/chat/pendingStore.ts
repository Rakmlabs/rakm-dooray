// 보내는 중인 메시지 (낙관적 전송).
// 입력창은 Enter 를 누르자마자 비우고, 보낼 글은 여기 넣어 목록 맨 아래에 "보내는 중" 으로 먼저 그린다.
// 서버에 들어가고 목록을 다시 받으면 지운다. 실패하면 "보내지 못함 · 다시 보내기 · 지우기" 로 남는다.
// 대화방(또는 스레드) 키별로 둔다. 이 컴퓨터의 이번 실행 동안만 (앱을 끄면 사라진다 — 실패한 글은 입력창으로 되돌릴 수 있다).
import { useSyncExternalStore } from 'react'
import { errorText } from '../../api'

export interface PendingSend {
  id: number
  key: string
  text: string
  status: 'sending' | 'failed'
  error?: string
  /** 처음 보낸 시각 (ms) */
  at: number
  retry: () => Promise<void>
}

let seq = 0
let all: PendingSend[] = []
const listeners = new Set<() => void>()
const EMPTY: PendingSend[] = []
const byKeyCache = new Map<string, PendingSend[]>()

function emit(): void {
  byKeyCache.clear()
  for (const l of listeners) l()
}

function patch(id: number, p: Partial<PendingSend>): void {
  all = all.map((x) => (x.id === id ? { ...x, ...p } : x))
  emit()
}

export function removePending(id: number): void {
  all = all.filter((x) => x.id !== id)
  emit()
}

export function pendingFor(key: string): PendingSend[] {
  let v = byKeyCache.get(key)
  if (!v) {
    const list = all.filter((x) => x.key === key)
    v = list.length ? list : EMPTY
    byKeyCache.set(key, v)
  }
  return v
}

export function usePending(key: string | null | undefined): PendingSend[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => (key ? pendingFor(key) : EMPTY)
  )
}

function errText(e: unknown): string {
  return errorText(e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/**
 * 글을 보내는 중으로 넣고 보낸다. send 가 끝나면(목록을 다시 받은 뒤) 지운다.
 * 실패하면 남겨 두고, 다시 보내기는 같은 send 를 부른다.
 */
export function sendOptimistic(key: string, text: string, send: (text: string) => Promise<void>): Promise<void> {
  const id = ++seq
  const run = async () => {
    patch(id, { status: 'sending', error: undefined })
    try {
      await send(text)
      removePending(id)
    } catch (e) {
      patch(id, { status: 'failed', error: errText(e) })
    }
  }
  all = [...all, { id, key, text, status: 'sending', at: Date.now(), retry: run }]
  emit()
  return run()
}
