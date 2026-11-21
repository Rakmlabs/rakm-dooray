import { describe, expect, it } from 'vitest'
import type { Channel, Message, UiState } from '../src/shared/types'
import { channelTitle, collectThreads, formatTopic, groupChannels, isUnread, parseTopic, sameProject } from '../src/renderer/src/lib/projects'

const ch = (id: string, type: string, updatedAt: string, extra: Partial<Channel> = {}): Channel => ({
  id,
  title: `방${id}`,
  type,
  status: 'normal',
  updatedAt,
  participantIds: [],
  meId: null,
  ...extra
})

const msg = (id: string, text: string, thread?: { channelId: string; lastUpdatedAt: number }): Message => ({
  id,
  channelId: 'c',
  seq: Number(id),
  type: 'TEXT',
  senderId: 'u',
  senderType: 'member',
  sentAt: '2026-01-01T00:00:00+09:00',
  text,
  flags: null,
  file: null,
  thread: thread ? { ...thread, totalCount: 1 } : null
})

describe('주제 접두어', () => {
  it('[프로젝트] 제목 을 나눈다', () => {
    expect(parseTopic('[알파] 3월 릴리스\n본문')).toEqual({ project: '알파', title: '3월 릴리스' })
    expect(parseTopic('그냥 대화')).toEqual({ project: null, title: '그냥 대화' })
    expect(formatTopic('알파', ' 제목 ')).toBe('[알파] 제목')
    expect(sameProject('Alpha', 'alpha ')).toBe(true)
  })
})

describe('스레드 모으기', () => {
  it('스레드 있는 메시지만, 최근 활동 순', () => {
    const list = collectThreads([
      msg('1', '[A] 오래된', { channelId: 't1', lastUpdatedAt: 100 }),
      msg('2', '스레드 없음'),
      msg('3', '[B] 최근', { channelId: 't3', lastUpdatedAt: 300 })
    ])
    expect(list.map((t) => t.thread.channelId)).toEqual(['t3', 't1'])
    expect(list[0].topic.project).toBe('B')
  })
})

describe('대화방 묶기', () => {
  const ui: UiState = {
    projects: [{ id: 'p1', name: '알파', color: '#000' }],
    channelProject: { a: 'p1', gone: 'deleted-project' },
    lastSeenAt: { b: '2026-01-02' },
    hiddenChannels: ['h']
  }
  const channels = [
    ch('a', 'private', '2026-01-03'),
    ch('b', 'private', '2026-01-05'),
    ch('d', 'direct', '2026-01-04'),
    ch('h', 'private', '2026-01-01'),
    ch('gone', 'private', '2026-01-01')
  ]

  it('프로젝트 → 1:1 → 미분류 → 숨김 순서', () => {
    const s = groupChannels(channels, ui)
    expect(s.map((x) => x.key)).toEqual(['p:p1', 'direct', 'other', 'hidden'])
    expect(s[0].channels.map((c) => c.id)).toEqual(['a'])
    expect(s[1].channels.map((c) => c.id)).toEqual(['d'])
    // 없어진 프로젝트에 묶였던 대화방은 미분류로
    expect(s[2].channels.map((c) => c.id)).toEqual(['b', 'gone'])
    expect(s[3].channels.map((c) => c.id)).toEqual(['h'])
  })

  it('안 읽음: updatedAt 이 마지막으로 본 시점보다 뒤', () => {
    expect(isUnread(channels[1], ui, new Set())).toBe(true)
    expect(isUnread(channels[0], ui, new Set())).toBe(false)
    expect(isUnread(channels[0], ui, new Set(['a']))).toBe(true)
  })

  it('제목 없는 1:1 은 상대 이름', () => {
    const c = ch('x', 'direct', '', { title: '', participantIds: ['me', 'you'], meId: 'me' })
    expect(channelTitle(c, (id) => (id === 'you' ? '김공동' : null))).toBe('김공동')
  })
})
