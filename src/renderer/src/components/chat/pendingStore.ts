// 보내는 중인 메시지 (낙관적 전송).
// 입력창은 Enter 를 누르자마자 비우고, 보낼 글은 여기 넣어 목록 맨 아래에 진짜 메시지와 똑같은 모양으로 먼저 그린다.
// 표시 원칙 (슬랙·카카오톡과 같음): 줄을 더하거나 빼지 않는다. 금방(1초 안) 들어가면 아무 표시도 없다.
// 오래 걸릴 때만 흐리게 + 오른쪽 아래(읽음 숫자 자리)에 작은 시계, 실패하면 같은 자리에 빨간 아이콘 + 다시 보내기·지우기.
// 서버가 메시지 ID 를 돌려주면 적어 두고, 목록에 그 메시지가 들어온 그 렌더에서 바로 바꿔 끼운다 (같은 줄 키를 이어 써서 깜빡이지 않는다).
// 대화방(또는 스레드) 키별로 둔다. 이 컴퓨터의 이번 실행 동안만 (앱을 끄면 사라진다).
import { useSyncExternalStore } from 'react'
import { errorText } from '../../api'

export interface PendingSend {
  id: number
  key: string
  text: string
  /** sending: 보내는 중(표시 없음) · slow: 1초 넘게 걸림 · failed: 보내지 못함 */
  status: 'sending' | 'slow' | 'failed'
  error?: string
  /** 처음 보낸 시각 (ms) */
  at: number
  /** 서버가 돌려준 메시지 ID (들어갔음). 목록에 보이면 이 항목 대신 진짜 메시지를 그린다 */
  serverId?: string
  retry: () => Promise<void>
}

/** 이보다 빨리 들어가면 아무 표시도 하지 않는다 */
export const SLOW_MS = 1000
/** 서버 ID 를 받았는데 목록에 이만큼 안 나타나면 그냥 지운다 (목록 갱신이 늦거나 다른 곳에서 지워진 경우) */
const CONFIRM_TIMEOUT_MS = 20_000

let seq = 0
let all: PendingSend[] = []
const listeners = new Set<() => void>()
const EMPTY: PendingSend[] = []
const byKeyCache = new Map<string, PendingSend[]>()
/** 서버 메시지 ID → 보내는 중일 때 쓰던 줄 키 (바꿔 끼울 때 줄을 새로 만들지 않게) */
const rowKeys = new Map<string, string>()

function emit(): void {
  byKeyCache.clear()
  for (const l of listeners) l()
}

function patch(id: number, p: Partial<PendingSend>): void {
  all = all.map((x) => (x.id === id ? { ...x, ...p } : x))
  emit()
}

export function removePending(id: number): void {
  if (!all.some((x) => x.id === id)) return
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

/** 보내는 중 항목의 메시지 ID·줄 키 */
export const localId = (p: Pick<PendingSend, 'id'>): string => `local:${p.id}`

/** 진짜 메시지의 줄 키: 이 앱에서 보낸 것이면 보내는 중일 때 쓰던 키를 이어 쓴다 */
export function rowKeyOf(messageId: string): string {
  return rowKeys.get(messageId) ?? messageId
}

function errText(e: unknown): string {
  return errorText(e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/**
 * 글을 보내는 중으로 넣고 보낸다.
 * send 는 서버가 메시지 ID 를 주면 곧바로 confirm(id) 를 부른다 (목록을 다시 받기 전에).
 * 그러면 목록에 그 메시지가 들어오는 순간 바꿔 끼우고 지운다. ID 를 못 받으면 send 가 끝날 때(목록을 다시 받은 뒤) 지운다.
 * 실패하면 남겨 두고, 다시 보내기는 같은 send 를 부른다.
 */
export function sendOptimistic(key: string, text: string, send: (text: string, confirm: (serverId: string) => void) => Promise<void>): Promise<void> {
  const id = ++seq
  let timer: ReturnType<typeof setTimeout> | undefined
  const run = async () => {
    patch(id, { status: 'sending', error: undefined })
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (all.find((x) => x.id === id)?.status === 'sending') patch(id, { status: 'slow' })
    }, SLOW_MS)
    let confirmed = false
    try {
      await send(text, (serverId) => {
        if (!serverId) return
        confirmed = true
        clearTimeout(timer)
        rowKeys.set(serverId, localId({ id }))
        if (rowKeys.size > 500) rowKeys.delete(rowKeys.keys().next().value!)
        patch(id, { serverId, status: 'sending' })
        setTimeout(() => removePending(id), CONFIRM_TIMEOUT_MS)
      })
      clearTimeout(timer)
      if (!confirmed) removePending(id)
    } catch (e) {
      clearTimeout(timer)
      patch(id, { status: 'failed', error: errText(e) })
    }
  }
  all = [...all, { id, key, text, status: 'sending', at: Date.now(), retry: run }]
  emit()
  return run()
}

/**
 * 목록에 이미 들어온 보내는 중 항목을 고른다 (그 렌더에서 바로 숨겨 둘이 함께 보이지 않게).
 * 서버 ID 가 있으면 ID 로, 없으면(목록이 먼저 갱신된 경우) 보낸 뒤 들어온 같은 글의 내 메시지로 짝짓는다.
 */
export function arrivedPending(
  pending: PendingSend[],
  messages: { id: string; senderId: string | null; sentAt: string | null; text: string }[],
  meId: string | null
): Set<number> {
  const out = new Set<number>()
  if (!pending.length || !messages.length) return out
  const ids = new Set<string>()
  // 최근 것만 본다 (보내는 중 항목은 늘 맨 아래 근처)
  const tail = messages.slice(-200)
  for (const m of tail) ids.add(m.id)
  const claimed = new Set<string>()
  for (const p of pending) if (p.serverId) claimed.add(p.serverId)
  for (const p of pending) {
    if (p.serverId) {
      if (ids.has(p.serverId)) out.add(p.id)
      continue
    }
    if (p.status === 'failed' || !meId) continue
    const hit = tail.find(
      (m) => !claimed.has(m.id) && (rowKeys.get(m.id) ?? localId(p)) === localId(p) && m.senderId === meId && m.text === p.text && !!m.sentAt && Date.parse(m.sentAt) >= p.at - 30_000
    )
    if (hit) {
      claimed.add(hit.id)
      rowKeys.set(hit.id, localId(p))
      out.add(p.id)
    }
  }
  return out
}
