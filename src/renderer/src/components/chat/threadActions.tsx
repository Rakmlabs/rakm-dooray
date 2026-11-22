// 스레드 숨기기·삭제.
//
// 두레이에는 "스레드(스레드 채널) 삭제" API 가 없다. 공개 API 에도, 두레이 웹 메신저가 쓰는 내부 API 에도 없다
// (웹 번들에 있는 스레드 관련 호출은 만들기·목록·상태·업무 연결뿐). 두레이 웹에서 스레드를 없애는 방법도
// 결국 메시지를 지우는 것이다: 첫 메시지를 지우면 답글이 남은 동안 "(삭제된 메시지)" 로 남는다(flags=DELETED_ROOT).
// 그래서 여기서 하는 "스레드 삭제"는
//   1) 스레드 안의 **내** 답글을 하나씩 지우고 (DELETE /messenger/v1/channels/{스레드 채널}/logs/{id})
//   2) 첫 메시지가 내 것이면 원래 대화방에서 지운다.
// 남의 답글은 지울 수 없다 (메시지 삭제는 보낸 사람만). 그런 답글이 남으면 스레드도 남으므로,
// 내 화면에서만 치우는 "목록에서 숨기기"를 같이 둔다 (이 컴퓨터에만 저장).
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Message } from '@shared/types'
import { call, errorText } from '../../api'
import { Modal } from '../Modal'

// ---------- 숨긴 스레드 (localStorage) ----------

const HIDDEN_KEY = 'rakm.chat.hiddenThreads'
const listeners = new Set<() => void>()
let hiddenCache: Set<string> | null = null

function readHidden(): Set<string> {
  if (hiddenCache) return hiddenCache
  try {
    const raw = window.localStorage.getItem(HIDDEN_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    hiddenCache = new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    hiddenCache = new Set()
  }
  return hiddenCache
}

export function setThreadHidden(threadChannelId: string, hidden: boolean): void {
  const next = new Set(readHidden())
  if (hidden) next.add(threadChannelId)
  else next.delete(threadChannelId)
  hiddenCache = next
  try {
    window.localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]))
  } catch {
    /* 저장 못 하면 이번 실행 동안만 숨긴다 */
  }
  for (const l of listeners) l()
}

export function useHiddenThreads(): Set<string> {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    readHidden
  )
}

// ---------- 삭제 ----------

export interface ThreadTarget {
  threadChannelId: string
  parentChannelId: string
  root: Message | null
}

export interface DeletePlan {
  mine: Message[]
  others: number
  rootMine: boolean
}

/** 지울 수 있는 것과 남는 것을 센다 (스레드 최신 1000개 기준) */
export async function planThreadDelete(t: ThreadTarget, meId: string): Promise<DeletePlan> {
  const logs = await call('messenger:logs', t.threadChannelId, 1000)
  const live = logs.filter((m) => m.flags !== 'DELETED_ROOT' && (!m.senderType || m.senderType === 'member' || m.senderType === 'app'))
  const mine = live.filter((m) => m.senderId === meId)
  const others = live.filter((m) => m.senderId !== meId).length
  const rootMine = !!t.root && t.root.senderId === meId && t.root.flags !== 'DELETED_ROOT'
  return { mine, others, rootMine }
}

export async function runThreadDelete(t: ThreadTarget, plan: DeletePlan, onProgress: (done: number) => void): Promise<{ deleted: number; failed: number }> {
  let deleted = 0
  let failed = 0
  // 요청 제한을 생각해 하나씩
  for (const m of plan.mine) {
    try {
      await call('messenger:delete', t.threadChannelId, m.id)
      deleted++
    } catch {
      failed++
    }
    onProgress(deleted + failed)
  }
  if (plan.rootMine && t.root) {
    try {
      await call('messenger:delete', t.parentChannelId, t.root.id)
      deleted++
    } catch {
      failed++
    }
    onProgress(deleted + failed)
  }
  return { deleted, failed }
}

/** 스레드 삭제 확인 창. 먼저 지울 수 있는 것을 세어 보여주고, 확인을 받은 뒤 지운다. */
export function ThreadDeleteDialog({
  target,
  meId,
  title,
  onClose,
  onDone
}: {
  target: ThreadTarget
  meId: string | null
  title: string
  onClose: () => void
  /** removedAll: 남은 메시지가 없어 스레드가 사라졌을 것으로 보이는지 */
  onDone: (r: { deleted: number; failed: number; hidden: boolean }) => void
}) {
  const [plan, setPlan] = useState<DeletePlan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [hideToo, setHideToo] = useState(true)

  useEffect(() => {
    if (!meId) return setError('내 계정 정보를 아직 불러오지 못했습니다.')
    let alive = true
    planThreadDelete(target, meId)
      .then((p) => alive && setPlan(p))
      .catch((e) => alive && setError(errorText(e)))
    return () => {
      alive = false
    }
  }, [target, meId])

  const total = plan ? plan.mine.length + (plan.rootMine ? 1 : 0) : 0
  const leftover = plan ? plan.others + (!plan.rootMine && target.root && target.root.flags !== 'DELETED_ROOT' ? 1 : 0) : 0

  async function go() {
    if (!plan) return
    setBusy(true)
    try {
      const r = await runThreadDelete(target, plan, setProgress)
      const hidden = leftover > 0 && hideToo
      if (hidden) setThreadHidden(target.threadChannelId, true)
      onDone({ ...r, hidden })
    } finally {
      setBusy(false)
    }
  }

  function hideOnly() {
    setThreadHidden(target.threadChannelId, true)
    onDone({ deleted: 0, failed: 0, hidden: true })
  }

  return (
    <Modal title="스레드 삭제" onClose={busy ? () => undefined : onClose}>
      <div className="thread-delete">
        <p>
          <b>{title || '(제목 없음)'}</b>
        </p>
        {error && <div className="banner banner-err">{error}</div>}
        {!plan && !error && <p className="muted">스레드 메시지를 세는 중…</p>}
        {plan && (
          <>
            <ul className="thread-delete-list">
              <li>
                지울 내 메시지: <b>{total}개</b>
                {plan.rootMine ? ' (첫 메시지 포함)' : ''}
              </li>
              <li>
                남는 다른 사람 메시지: <b>{leftover}개</b>
              </li>
            </ul>
            {leftover > 0 ? (
              <p className="muted small">
                두레이는 스레드를 통째로 지우는 기능이 없고(웹·API 모두), 메시지는 보낸 사람만 지울 수 있습니다. 다른 사람 메시지가 남으면
                스레드도 남고, 첫 메시지를 지운 경우 "(삭제된 메시지)"로 보입니다.
              </p>
            ) : (
              <p className="muted small">모두 내 메시지라 지우면 스레드가 비게 됩니다. 되돌릴 수 없습니다.</p>
            )}
            {leftover > 0 && (
              <label className="check-row small">
                <input type="checkbox" checked={hideToo} onChange={(e) => setHideToo(e.target.checked)} /> 지운 뒤 내 스레드 목록에서도 숨기기 (이 컴퓨터만)
              </label>
            )}
            {busy && (
              <p className="muted small">
                지우는 중… {progress}/{total}
              </p>
            )}
          </>
        )}
        <div className="row end">
          <button className="small" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button className="small" onClick={hideOnly} disabled={busy} title="지우지 않고 내 스레드 목록에서만 뺍니다">
            숨기기만
          </button>
          <button className="small danger-btn" onClick={() => void go()} disabled={busy || !plan || total === 0}>
            {total === 0 && plan ? '지울 내 메시지 없음' : `내 메시지 ${total}개 삭제`}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** 스레드 우클릭/⋯ 메뉴. 화면 좌표(x, y)에 뜬다. */
export function ThreadMenu({
  x,
  y,
  hidden,
  onOpen,
  onToggleHidden,
  onDelete,
  onClose
}: {
  x: number
  y: number
  hidden: boolean
  onOpen?: () => void
  onToggleHidden: () => void
  onDelete: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest?.('.thread-menu')) onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])
  const left = Math.min(x, window.innerWidth - 200)
  const top = Math.min(y, window.innerHeight - 130)
  const act = (f: () => void) => () => {
    onClose()
    f()
  }
  return (
    <div className="thread-menu" role="menu" style={{ left, top }}>
      {onOpen && (
        <button role="menuitem" onClick={act(onOpen)}>
          스레드 열기
        </button>
      )}
      <button role="menuitem" onClick={act(onToggleHidden)}>
        {hidden ? '숨김 해제' : '목록에서 숨기기'}
      </button>
      <button role="menuitem" className="danger" onClick={act(onDelete)}>
        스레드 삭제…
      </button>
    </div>
  )
}

export function threadDeleteMessage(r: { deleted: number; failed: number; hidden: boolean }): string {
  if (r.deleted === 0 && r.failed === 0) return r.hidden ? '스레드를 목록에서 숨겼습니다. "숨긴 스레드"에서 다시 볼 수 있습니다.' : '지운 메시지가 없습니다.'
  const parts = [`내 메시지 ${r.deleted}개를 지웠습니다.`]
  if (r.failed) parts.push(`${r.failed}개는 지우지 못했습니다.`)
  if (r.hidden) parts.push('다른 사람 메시지가 남아 스레드는 목록에서 숨겼습니다.')
  return parts.join(' ')
}
