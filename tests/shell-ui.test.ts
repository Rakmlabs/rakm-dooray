import { describe, expect, it } from 'vitest'
import type { Channel, Message, UiState } from '../src/shared/types'
import { chosung, findMatch, matchScore, snippetParts } from '../src/renderer/src/shell/match'
import { NavHistory } from '../src/renderer/src/shell/history'
import { pushRecent } from '../src/renderer/src/shell/recent'
import { applyOrder, findDirectChannel, groupChannels, moveInOrder, unreadCount } from '../src/renderer/src/lib/projects'
import { normalizeState, notifiable, visibleOn } from '../src/main/local/rules'

const ch = (id: string, type: string, updatedAt: string, extra: Partial<Channel> = {}): Channel => ({
  id,
  title: `방${id}`,
  type,
  status: 'normal',
  updatedAt,
  participantIds: [],
  meId: 'me',
  ...extra
})

describe('초성·섞어 쓰기 검색', () => {
  it('초성을 뽑는다', () => {
    expect(chosung('알파 프로젝트')).toBe('ㅇㅍ ㅍㄹㅈㅌ')
    expect(chosung('RAKM 팀')).toBe('RAKM ㅌ')
  })
  it('초성, 섞어 쓰기, 공백 무시, 대소문자 무시', () => {
    expect(findMatch('알파 프로젝트', 'ㅇㅍ')).toBe(0)
    expect(findMatch('알파 프로젝트', '알ㅍ')).toBe(0)
    expect(findMatch('알파 프로젝트', 'ㅍㄹㅈ')).toBe(2)
    expect(findMatch('알파 프로젝트', '파프')).toBe(1)
    expect(findMatch('RAKM Labs', 'labs')).toBe(4)
    expect(findMatch('알파', 'ㅂ')).toBe(-1)
  })
  it('앞부분 일치가 중간 일치보다, 글자 일치가 초성 일치보다 높다', () => {
    expect(matchScore('알파 프로젝트', '알파')).toBeGreaterThan(matchScore('베타 알파', '알파'))
    expect(matchScore('베타 알파', '알파')).toBeGreaterThan(matchScore('가나 다라 알파', '파'))
    expect(matchScore('알파', '알파')).toBeGreaterThan(matchScore('알파', 'ㅇㅍ'))
    expect(matchScore('알파', '')).toBe(1)
    expect(matchScore('알파', '감마')).toBe(0)
  })
  it('snippetParts 는 검색어를 따로 돌려준다', () => {
    const p = snippetParts('오늘 회의는 3시에 합니다', '회의')
    expect(p.hit).toBe('회의')
    expect(p.before + p.hit + p.after).toContain('오늘 회의는')
  })
})

describe('대화방 묶기·순서', () => {
  const ui: UiState = { projects: [{ id: 'a', name: '알파', color: '#000' }], channelProject: { c2: 'a', c3: 'a' }, lastSeenAt: {}, hiddenChannels: ['c5'] }
  const list = [
    ch('c1', 'private', '2026-01-05'),
    ch('c2', 'private', '2026-01-04'),
    ch('c3', 'private', '2026-01-06'),
    ch('c4', 'direct', '2026-01-03', { participantIds: ['me', 'kim'] }),
    ch('c5', 'private', '2026-01-02'),
    ch('c6', 'private', '2026-01-07')
  ]
  it('즐겨찾기가 맨 위, 그 방은 다른 섹션에서 빠진다. 섹션 순서는 사용자가 정한 대로', () => {
    const s = groupChannels(list, ui, { favorites: ['c6'], order: { 'p:a': ['c2', 'c3'] } })
    expect(s.map((x) => x.key)).toEqual(['fav', 'p:a', 'direct', 'other', 'hidden'])
    expect(s[0].channels.map((c) => c.id)).toEqual(['c6'])
    expect(s[1].channels.map((c) => c.id)).toEqual(['c2', 'c3'])
    expect(s[3].channels.map((c) => c.id)).toEqual(['c1'])
    expect(s[4].channels.map((c) => c.id)).toEqual(['c5'])
  })
  it('layout 없이 부르면 예전과 같다 (즐겨찾기 섹션 없음)', () => {
    expect(groupChannels(list, ui).map((x) => x.key)).toEqual(['p:a', 'direct', 'other', 'hidden'])
  })
  it('순서에 없는 새 방은 최근 순으로 뒤에 붙는다', () => {
    expect(applyOrder(list.slice(0, 3), ['c2']).map((c) => c.id)).toEqual(['c2', 'c3', 'c1'])
  })
  it('끌어 놓기 순서 계산', () => {
    expect(moveInOrder(['a', 'b', 'c', 'd'], 'd', 'b')).toEqual(['a', 'd', 'b', 'c'])
    expect(moveInOrder(['a', 'b', 'c', 'd'], 'a', 'c', true)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveInOrder(['a', 'b'], 'x', 'a')).toEqual(['x', 'a', 'b'])
    expect(moveInOrder(['a', 'b'], 'a', 'a')).toEqual(['a', 'b'])
  })
  it('사람 → 기존 1:1 방', () => {
    expect(findDirectChannel(list, 'kim')?.id).toBe('c4')
    expect(findDirectChannel(list, 'lee')).toBeNull()
  })
  it('보고 있는 방은 안 읽음 0', () => {
    const s = { c1: { unread: 3, lastAt: null, lastText: '', lastSenderId: null, readAt: null } }
    expect(unreadCount(s, 'c1', null)).toBe(3)
    expect(unreadCount(s, 'c1', 'c1')).toBe(0)
    expect(unreadCount(s, 'c9', null)).toBe(0)
  })
})

describe('최근·이동 기록', () => {
  it('최근 목록은 같은 대상을 하나만, 최신이 앞', () => {
    let r = pushRecent([], { label: 'A', target: { kind: 'channel', channelId: 'a' } }, 30, 1)
    r = pushRecent(r, { label: 'B', target: { kind: 'wikiPage', wikiId: 'w', pageId: 'p' } }, 30, 2)
    r = pushRecent(r, { label: 'A', target: { kind: 'channel', channelId: 'a', messageId: 'm' } }, 30, 3)
    expect(r.map((x) => x.key)).toEqual(['c:a', 'w:p'])
    expect(r[0].target).toEqual({ kind: 'channel', channelId: 'a' })
  })
  it('뒤로·앞으로, 새로 가면 앞쪽 기록은 버린다', () => {
    const h = new NavHistory()
    h.push({ kind: 'channel', channelId: 'a' })
    h.push({ kind: 'channel', channelId: 'b' })
    h.push({ kind: 'channel', channelId: 'b', messageId: 'x' }) // 같은 방은 한 번만
    h.push({ kind: 'wikiPage', wikiId: 'w', pageId: 'p' })
    expect(h.back()).toEqual({ kind: 'channel', channelId: 'b' })
    expect(h.back()).toEqual({ kind: 'channel', channelId: 'a' })
    expect(h.back()).toBeNull()
    expect(h.forward()).toEqual({ kind: 'channel', channelId: 'b' })
    h.push({ kind: 'channel', channelId: 'c' })
    expect(h.canForward).toBe(false)
    h.silently(() => h.push({ kind: 'channel', channelId: 'z' }))
    expect(h.back()).toEqual({ kind: 'channel', channelId: 'b' })
  })
})

describe('main 규칙', () => {
  const now = Date.parse('2026-11-22T10:00:00Z')
  const m = (id: string, sender: string | null, minsAgo: number, extra: Partial<Message> = {}): Message => ({
    id,
    channelId: 'c',
    seq: 1,
    type: 'TEXT',
    senderId: sender,
    senderType: 'member',
    sentAt: new Date(now - minsAgo * 60_000).toISOString(),
    text: id,
    flags: null,
    file: null,
    thread: null,
    ...extra
  })
  const base = { meId: 'me', readMsBefore: now - 30 * 60_000, now, muted: false, watching: false }
  it('알림: 남이 보낸, 읽은 시각 이후의, 10분 안 메시지만', () => {
    const list = [m('mine', 'me', 1), m('old', 'kim', 20), m('new', 'kim', 1), m('sys', null, 1), m('bot', 'b', 1, { senderType: 'system' })]
    expect(notifiable(list, base).map((x) => x.id)).toEqual(['new'])
    expect(notifiable(list, { ...base, muted: true })).toEqual([])
    expect(notifiable(list, { ...base, watching: true })).toEqual([])
    expect(notifiable(list, { ...base, readMsBefore: null })).toEqual([])
    expect(notifiable(list, { ...base, readMsBefore: now - 30_000 })).toEqual([])
  })
  it('설정 파일이 깨졌거나 예전 형식이어도 기본값으로 채운다', () => {
    const s = normalizeState({ prefs: { theme: 'neon', notify: { muted: ['c1', 3] } }, layout: { favorites: 'x', order: { fav: ['a', 1] } } })
    expect(s.prefs.theme).toBe('system')
    expect(s.prefs.notify.muted).toEqual(['c1'])
    expect(s.prefs.notify.enabled).toBe(true)
    expect(s.prefs.tray).toBe(false)
    expect(s.prefs.openAtLogin).toBe(false)
    expect(s.layout.favorites).toEqual([])
    expect(s.layout.order).toEqual({ fav: ['a'] })
    expect(s.layout.last.tab).toBe('messenger')
    expect(normalizeState(null).layout.collapsed).toEqual(['hidden'])
  })
  it('창 위치가 연결된 화면 밖이면 버린다', () => {
    const d = [{ x: 0, y: 0, width: 1440, height: 900 }]
    expect(visibleOn({ x: 100, y: 100, width: 800, height: 600 }, d)).toBe(true)
    expect(visibleOn({ x: 2000, y: 100, width: 800, height: 600 }, d)).toBe(false)
    expect(visibleOn({ x: 100, y: -500, width: 800, height: 600 }, d)).toBe(false)
  })
})
