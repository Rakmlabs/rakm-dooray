// 이모지 반응.
// 두레이 공개 API 에는 메시지 반응이 없다. 그래서 반응을 짧은 메시지 한 줄로 보낸다:
//   👍 박서연 「메신저 화면 시안 올렸어요…」
// 두레이 웹·모바일에서는 이 한 줄이 그대로 보이고 (누가 어떤 말에 반응했는지 읽힌다),
// 이 앱은 이런 줄을 목록에서 빼고 대상 메시지 아래 칩(👍 3)으로 모아 그린다.
// 대상은 「」 안 글(메시지 앞부분, 파일이면 파일 이름)이 같은, 반응보다 앞선 가장 가까운 메시지다.
// 반응 빼기 = 내 반응 메시지 삭제 (두레이의 수정·삭제 시간 제한을 따른다).
import type { Message } from '@shared/types'
import { parseReaction } from '@shared/reaction'

export { parseReaction }

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '✅', '👀']

/** 「」 안에 넣는 대상 글 길이 (글자 수) */
const LABEL_LEN = 20

export interface ReactionGroup {
  emoji: string
  /** 누른 사람 (멤버 ID, 누른 순서) */
  by: string[]
  /** 내가 보낸 반응 메시지 ID (빼기 = 이것들 삭제) */
  mine: string[]
}

/** 반응이 가리킬 대상 글: 메시지 앞부분(멘션은 @이름) 또는 파일 이름. 반응을 달 수 없으면 '' */
export function reactionLabel(m: Pick<Message, 'text' | 'file'>): string {
  const src = m.text?.trim() ? m.text : (m.file?.name ?? '')
  const flat = src
    .replace(/\[@([^\]]+)\]\(dooray:\/\/[^)]*\)/g, '@$1')
    .replace(/[「」]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const chars = Array.from(flat)
  return chars.length > LABEL_LEN ? chars.slice(0, LABEL_LEN).join('') + '…' : flat
}

/** 보낼 반응 글 */
export function reactionText(emoji: string, targetSenderName: string, target: Pick<Message, 'text' | 'file'>): string {
  const name = targetSenderName.replace(/[「」\n]/g, '').trim() || '…'
  return `${emoji} ${name} 「${reactionLabel(target)}」`
}

export interface Folded {
  /** 반응 줄을 뺀 목록 */
  list: Message[]
  /** 목록에서 뺀 반응 메시지 ID */
  hidden: Set<string>
  byTarget: Map<string, ReactionGroup[]>
}

const canTarget = (m: Message) => m.flags !== 'DELETED_ROOT' && m.type !== 'SYSTEM' && !!reactionLabel(m)

/** 반응 줄을 대상 메시지의 칩으로 모은다. 대상을 못 찾은 반응은 보통 메시지로 둔다 */
export function foldReactions(messages: Message[], meId: string | null): Folded {
  let hidden: Set<string> | null = null
  const byTarget = new Map<string, ReactionGroup[]>()
  const kept: Message[] = []
  for (const m of messages) {
    const r = m.senderId && !m.file && m.text ? parseReaction(m.text) : null
    let target: Message | undefined
    if (r) {
      for (let i = kept.length - 1; i >= 0 && i >= kept.length - 300; i--) {
        const k = kept[i]
        if (canTarget(k) && reactionLabel(k) === r.label) {
          target = k
          break
        }
      }
    }
    if (!r || !target) {
      kept.push(m)
      continue
    }
    ;(hidden ??= new Set()).add(m.id)
    let groups = byTarget.get(target.id)
    if (!groups) byTarget.set(target.id, (groups = []))
    let g = groups.find((x) => x.emoji === r.emoji)
    if (!g) groups.push((g = { emoji: r.emoji, by: [], mine: [] }))
    if (!g.by.includes(m.senderId!)) g.by.push(m.senderId!)
    if (meId && m.senderId === meId) g.mine.push(m.id)
  }
  if (!hidden) return { list: messages, hidden: EMPTY, byTarget }
  return { list: kept, hidden, byTarget }
}

const EMPTY = new Set<string>()

/** 누르는 즉시 보이게: 서버에 반영되기 전 내 반응을 덧씌운다 */
export interface OptimisticReaction {
  target: string
  emoji: string
  op: 'add' | 'remove'
  at: number
}

export function applyOptimistic(groups: ReactionGroup[] | undefined, ops: OptimisticReaction[], target: string, meId: string | null): ReactionGroup[] | undefined {
  if (!meId) return groups
  const mineOps = ops.filter((o) => o.target === target)
  if (!mineOps.length) return groups
  let out = (groups ?? []).map((g) => ({ ...g, by: [...g.by], mine: [...g.mine] }))
  for (const o of mineOps) {
    const g = out.find((x) => x.emoji === o.emoji)
    if (o.op === 'add') {
      if (!g) out.push({ emoji: o.emoji, by: [meId], mine: [] })
      else if (!g.by.includes(meId)) g.by.push(meId)
    } else if (g) {
      g.by = g.by.filter((x) => x !== meId)
      g.mine = []
    }
  }
  out = out.filter((g) => g.by.length > 0)
  return out.length ? out : undefined
}

/** 서버 목록이 덧씌운 상태를 따라잡았나 */
export function settled(o: OptimisticReaction, groups: ReactionGroup[] | undefined, meId: string | null): boolean {
  const has = !!meId && !!groups?.some((g) => g.emoji === o.emoji && g.by.includes(meId))
  return o.op === 'add' ? has : !has
}
