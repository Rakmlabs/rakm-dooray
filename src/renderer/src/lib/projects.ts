import type { Channel, Message, ProjectGroup, ThreadInfo, UiState } from '@shared/types'
import type { ChannelSummary, ShellLayout } from '@shared/types-shell'

/**
 * "한 대화방에 여러 프로젝트 얘기가 섞인다" 문제를 위한 규칙.
 * 1) 대화방을 프로젝트 그룹에 넣는다 (각자 컴퓨터에만 저장).
 * 2) 스레드 첫 메시지를 "[프로젝트] 제목" 형식으로 쓴다. 이 접두어는 메시지 본문이라
 *    상대방(공동창업자)의 앱에서도 똑같이 프로젝트별로 묶인다. 서버가 없어도 둘이 같은 구조를 본다.
 */

export interface Topic {
  project: string | null
  title: string
}

const TOPIC_RE = /^\s*\[([^\]\n]{1,40})\]\s*([\s\S]*)$/

export function parseTopic(text: string): Topic {
  const m = TOPIC_RE.exec(text)
  if (!m) return { project: null, title: firstLine(text) }
  return { project: m[1].trim(), title: firstLine(m[2]) || '(제목 없음)' }
}

export function formatTopic(project: string | null, title: string): string {
  const t = title.trim()
  return project ? `[${project}] ${t}` : t
}

function firstLine(s: string): string {
  return (s.split('\n').find((l) => l.trim()) ?? '').trim().slice(0, 120)
}

export function sameProject(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

export interface ThreadEntry {
  root: Message
  thread: ThreadInfo
  topic: Topic
  parentChannelId: string
}

/** 대화방 메시지 중 스레드가 달린 것만 모아 최근 활동 순으로 */
export function collectThreads(messages: Message[]): ThreadEntry[] {
  return messages
    .filter((m): m is Message & { thread: ThreadInfo } => !!m.thread)
    .map((m) => ({ root: m, thread: m.thread, topic: parseTopic(m.text), parentChannelId: m.channelId }))
    .sort((a, b) => threadTime(b) - threadTime(a))
}

export function threadTime(t: ThreadEntry): number {
  return t.thread.lastUpdatedAt ?? (t.root.sentAt ? Date.parse(t.root.sentAt) : 0)
}

export interface ChannelSection {
  key: string
  title: string
  project: ProjectGroup | null
  channels: Channel[]
}

export function channelTitle(c: Channel, nameOf: (id: string) => string | null): string {
  if (c.title) return c.title
  if (c.type === 'me') return '나와의 대화'
  const others = c.participantIds.filter((id) => id !== c.meId)
  const names = others.map((id) => nameOf(id) ?? '…')
  return names.length ? names.join(', ') : '(이름 없는 대화방)'
}

function byRecent(a: Channel, b: Channel): number {
  return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
}

/** 사용자가 끌어서 정한 순서를 먼저, 나머지는 최근 순으로 */
export function applyOrder(channels: Channel[], order: string[] | undefined): Channel[] {
  const recent = [...channels].sort(byRecent)
  if (!order?.length) return recent
  const pos = new Map(order.map((id, i) => [id, i]))
  const ordered = recent.filter((c) => pos.has(c.id)).sort((a, b) => pos.get(a.id)! - pos.get(b.id)!)
  return [...ordered, ...recent.filter((c) => !pos.has(c.id))]
}

/**
 * 즐겨찾기 → 프로젝트 폴더 → 1:1 → 미분류 순. 숨긴 대화방은 마지막 '숨김' 섹션으로.
 * layout 이 있으면 즐겨찾기 섹션을 만들고(그 방은 다른 섹션에서 빠진다) 섹션마다 사용자가 정한 순서를 쓴다.
 */
export function groupChannels(channels: Channel[], ui: UiState, layout?: Pick<ShellLayout, 'favorites' | 'order'>): ChannelSection[] {
  const live = channels.filter((c) => c.status !== 'deleted')
  const hidden = new Set(ui.hiddenChannels)
  const fav = new Set(layout?.favorites ?? [])
  const projectIds = new Set(ui.projects.map((p) => p.id))
  const order = layout?.order ?? {}
  const visible = live.filter((c) => !hidden.has(c.id) && !fav.has(c.id))
  const sections: ChannelSection[] = []
  if (layout) {
    const byId = new Map(live.map((c) => [c.id, c]))
    const favList = layout.favorites.map((id) => byId.get(id)).filter((c): c is Channel => !!c && !hidden.has(c.id))
    sections.push({ key: 'fav', title: '즐겨찾기', project: null, channels: favList })
  }
  for (const p of ui.projects) {
    const key = `p:${p.id}`
    sections.push({ key, title: p.name, project: p, channels: applyOrder(visible.filter((c) => ui.channelProject[c.id] === p.id), order[key]) })
  }
  const unassigned = visible.filter((c) => !projectIds.has(ui.channelProject[c.id] ?? ''))
  sections.push({
    key: 'direct',
    title: '1:1 대화',
    project: null,
    channels: applyOrder(unassigned.filter((c) => c.type === 'direct' || c.type === 'me'), order.direct)
  })
  sections.push({
    key: 'other',
    title: '미분류 대화방',
    project: null,
    channels: applyOrder(unassigned.filter((c) => c.type !== 'direct' && c.type !== 'me'), order.other)
  })
  const hiddenList = live.filter((c) => hidden.has(c.id)).sort(byRecent)
  if (hiddenList.length) sections.push({ key: 'hidden', title: '숨김', project: null, channels: hiddenList })
  return sections
}

/** 끌어 놓기: 섹션 안에서 dragged 를 target 앞(after 면 뒤)으로 옮긴 새 순서 */
export function moveInOrder(ids: string[], dragged: string, target: string, after = false): string[] {
  if (dragged === target) return ids
  const rest = ids.filter((id) => id !== dragged)
  const i = rest.indexOf(target)
  if (i < 0) return [...rest, dragged]
  rest.splice(after ? i + 1 : i, 0, dragged)
  return rest
}

/** 1:1 방의 상대 (나 말고 첫 번째 참가자) */
export function directPartner(c: Channel): string | null {
  if (c.type !== 'direct') return null
  return c.participantIds.find((id) => id !== c.meId) ?? null
}

/** 그 사람과의 기존 1:1 방 */
export function findDirectChannel(channels: Channel[], memberId: string): Channel | null {
  return (
    channels.find(
      (c) => c.type === 'direct' && c.status !== 'deleted' && c.participantIds.includes(memberId) && c.participantIds.length <= 2
    ) ?? null
  )
}

/** 로컬 보관함 기준 안 읽은 수 (보는 중인 방은 0) */
export function unreadCount(summaries: Record<string, ChannelSummary>, channelId: string, viewing: string | null): number {
  if (channelId === viewing) return 0
  return summaries[channelId]?.unread ?? 0
}

export function isUnread(c: Channel, ui: UiState, activity: Set<string>): boolean {
  if (activity.has(c.id)) return true
  const seen = ui.lastSeenAt[c.id]
  if (!seen || !c.updatedAt) return false
  return c.updatedAt > seen
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b']
export function nextColor(existing: ProjectGroup[]): string {
  return COLORS[existing.length % COLORS.length]
}
