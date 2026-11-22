// 읽음 확인: 위키 페이지 본문 형식과 "안 읽은 사람 수" 계산. main·renderer·테스트가 같이 쓴다 (부작용 없음).
import type { Message } from './types'
import type { PeerReceipts, ReceiptPosition, ReceiptsSnapshot } from './types-receipts'

export const RECEIPTS_ROOT_TITLE = 'RAKM 두레이 · 읽음 확인 (앱 전용)'
export const RECEIPTS_ROOT_MARK = '<!-- rakm-dooray:read-receipts:root:v1 -->'
const memberMark = (memberId: string) => `<!-- rakm-dooray:read-receipts:member:v1:${memberId} -->`

export function memberPageTitle(name: string, memberId: string): string {
  return `읽음 위치 · ${name.replace(/[()]/g, '')} (${memberId})`
}

/** 페이지 제목에서 멤버 ID 를 꺼낸다 (목록 조회에는 본문이 없어서 제목으로 먼저 거른다) */
export function memberIdFromTitle(subject: string): string | null {
  const m = /^읽음 위치 · .*\(([^()\s]+)\)\s*$/.exec(subject)
  return m ? m[1] : null
}

export function rootPageBody(): string {
  return [
    RECEIPTS_ROOT_MARK,
    '',
    '이 페이지와 아래 페이지들은 **RAKM 두레이 데스크톱 앱**이 "읽음 확인"(상대가 내 메시지를 읽었는지)을 위해 자동으로 만들고 고칩니다.',
    '',
    '- 사람이 고치거나 옮기지 마세요. 지우면 앱이 다시 만듭니다.',
    '- 앱 설정 > 읽음 확인 을 끄면 더 이상 쓰지 않습니다.',
    '- 아래 페이지에는 대화방 ID 와 마지막으로 읽은 메시지 번호만 들어 있습니다 (메시지 내용 없음).'
  ].join('\n')
}

export function isRootBody(content: string): boolean {
  return content.includes(RECEIPTS_ROOT_MARK)
}

export interface MemberDoc {
  v: 1
  memberId: string
  /** false 면 이 사람은 기능을 껐다 (기록이 없는 것으로 본다) */
  enabled: boolean
  since: number
  updatedAt: number
  channels: Record<string, ReceiptPosition>
}

export function memberPageBody(doc: MemberDoc): string {
  return [
    memberMark(doc.memberId),
    '',
    'RAKM 두레이 앱이 자동으로 고치는 읽음 위치입니다. 고치지 마세요.',
    '',
    '```json',
    JSON.stringify(doc),
    '```'
  ].join('\n')
}

/** 표식과 멤버 ID 가 맞는 본문일 때만 읽는다. 아니면 null (이 페이지에는 쓰지도 않는다) */
export function parseMemberBody(content: string, memberId: string): MemberDoc | null {
  if (!content.includes(memberMark(memberId))) return null
  const m = /```json\s*\n([\s\S]*?)\n```/.exec(content)
  if (!m) return null
  try {
    const d = JSON.parse(m[1]) as Partial<MemberDoc>
    if (d.memberId !== memberId || typeof d.since !== 'number' || !d.channels || typeof d.channels !== 'object') return null
    const channels: Record<string, ReceiptPosition> = {}
    for (const [k, v] of Object.entries(d.channels)) {
      if (v && Number.isFinite(v.seq) && Number.isFinite(v.at)) channels[k] = { seq: v.seq, at: v.at }
    }
    return { v: 1, memberId, enabled: d.enabled !== false, since: d.since, updatedAt: Number(d.updatedAt) || 0, channels }
  } catch {
    return null
  }
}

export function hasMemberMark(content: string, memberId: string): boolean {
  return content.includes(memberMark(memberId))
}

/** 두 기록을 합친다 (방마다 더 뒤의 위치). 바뀌었으면 true */
export function mergePositions(into: Record<string, ReceiptPosition>, from: Record<string, ReceiptPosition>): boolean {
  let changed = false
  for (const [k, v] of Object.entries(from)) {
    const cur = into[k]
    if (!cur || v.seq > cur.seq) {
      into[k] = { seq: v.seq, at: v.at }
      changed = true
    }
  }
  return changed
}

/** 같은 사람들이 결정적으로 같은 곳을 고르도록: ID 를 숫자 크기로 비교 (길이 → 문자열) */
export function compareIds(a: string, b: string): number {
  return a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)
}

/**
 * 내 메시지 m 을 아직 읽지 않은 사람 ID 목록.
 * - 기록(페이지)이 없는 사람, 기능을 끈 사람, 그 사람이 기능을 켜기 전에 보낸 메시지는 세지 않는다 (틀린 '1' 을 띄우지 않기 위해)
 * - 그 사람이 이 방에서 m 보다 뒤에 메시지를 보냈으면 읽은 것으로 본다 (두레이 모바일·웹에서 읽고 답한 경우)
 * @param members 이 방(스레드면 원래 방)의 멤버
 * @param laterBy 사람별로 이 방 목록에서 보낸 가장 큰 seq
 */
export function unreadBy(
  m: Pick<Message, 'channelId' | 'seq' | 'sentAt' | 'senderId'>,
  members: readonly string[],
  snap: ReceiptsSnapshot,
  laterBy: ReadonlyMap<string, number>
): string[] {
  if (!snap.enabled || !snap.meId || m.senderId !== snap.meId) return []
  const sent = m.sentAt ? Date.parse(m.sentAt) : NaN
  if (!Number.isFinite(sent)) return []
  const out: string[] = []
  for (const id of members) {
    if (id === snap.meId) continue
    const p: PeerReceipts | undefined = snap.peers[id]
    if (!p || sent < p.since) continue
    const pos = p.channels[m.channelId]
    if (pos && pos.seq >= m.seq) continue
    if ((laterBy.get(id) ?? -Infinity) > m.seq) continue
    out.push(id)
  }
  return out
}

/** 목록에서 사람별로 보낸 가장 큰 seq */
export function lastSeqBySender(messages: readonly Pick<Message, 'senderId' | 'seq'>[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const x of messages) if (x.senderId && (out.get(x.senderId) ?? -Infinity) < x.seq) out.set(x.senderId, x.seq)
  return out
}
