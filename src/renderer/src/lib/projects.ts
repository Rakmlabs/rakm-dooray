import type { Channel, Message, ProjectGroup, ThreadInfo, UiState } from '@shared/types'

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

/** 프로젝트 그룹 → 1:1 → 미분류 순. 숨긴 대화방은 마지막 '숨김' 섹션으로. */
export function groupChannels(channels: Channel[], ui: UiState): ChannelSection[] {
  const live = channels.filter((c) => c.status !== 'deleted')
  const hidden = new Set(ui.hiddenChannels)
  const projectIds = new Set(ui.projects.map((p) => p.id))
  const sections: ChannelSection[] = ui.projects.map((p) => ({
    key: `p:${p.id}`,
    title: p.name,
    project: p,
    channels: live.filter((c) => !hidden.has(c.id) && ui.channelProject[c.id] === p.id).sort(byRecent)
  }))
  const unassigned = live.filter((c) => !hidden.has(c.id) && !projectIds.has(ui.channelProject[c.id] ?? ''))
  sections.push({
    key: 'direct',
    title: '1:1 대화',
    project: null,
    channels: unassigned.filter((c) => c.type === 'direct' || c.type === 'me').sort(byRecent)
  })
  sections.push({
    key: 'other',
    title: '미분류 대화방',
    project: null,
    channels: unassigned.filter((c) => c.type !== 'direct' && c.type !== 'me').sort(byRecent)
  })
  const hiddenList = live.filter((c) => hidden.has(c.id)).sort(byRecent)
  if (hiddenList.length) sections.push({ key: 'hidden', title: '숨김', project: null, channels: hiddenList })
  return sections
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
