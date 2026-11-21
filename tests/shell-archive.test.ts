import { describe, expect, it } from 'vitest'
import type { Message } from '../src/shared/types'
import { LocalArchive, previewText, snippet, stripMarkdown } from '../src/main/local/archive'

const T0 = Date.parse('2026-11-01T00:00:00Z')
const msg = (seq: number, extra: Partial<Message> = {}): Message => ({
  id: `m${seq}`,
  channelId: 'c1',
  seq,
  type: 'TEXT',
  senderId: seq % 2 ? 'other' : 'me',
  senderType: 'member',
  sentAt: new Date(T0 + seq * 60_000).toISOString(),
  text: `메시지 ${seq}`,
  flags: null,
  file: null,
  thread: null,
  ...extra
})
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => msg(a + i))
const db = () => new LocalArchive(':memory:')

describe('로컬 보관함: 쌓기·병합', () => {
  it('서버 창(최신 N개)이 밀려나도 예전 것은 보관함에 남아 이어서 보인다', () => {
    const a = db()
    a.ingest('c1', range(1, 1000), 1000)
    // 300개가 새로 와서 1..300 은 서버의 1000개 창 밖으로 밀려났다
    a.ingest('c1', range(301, 1300), 1000)
    expect(a.count('c1')).toBe(1300)
    const page = a.page('c1', 100)
    expect(page.messages.map((m) => m.seq)).toEqual(range(1201, 1300).map((m) => m.seq))
    expect(page.hasOlder).toBe(true)
    const all = a.page('c1', 2000)
    expect(all.messages[0].seq).toBe(1)
    expect(all.hasOlder).toBe(false)
  })

  it('같은 메시지를 다시 받아도 중복되지 않고, 처음 본 것만 added', () => {
    const a = db()
    expect(a.ingest('c1', range(1, 10), 50).added).toHaveLength(10)
    const r = a.ingest('c1', range(1, 12), 50)
    expect(r.added.map((m) => m.seq)).toEqual([11, 12])
    expect(r.changed).toBe(0)
    expect(a.count('c1')).toBe(12)
  })

  it('수정된 메시지는 같은 id 로 갱신된다 (스레드 답글 수 포함)', () => {
    const a = db()
    a.ingest('c1', range(1, 5), 50)
    const edited = range(1, 5)
    edited[2] = { ...edited[2], text: '고친 내용' }
    edited[3] = { ...edited[3], thread: { channelId: 't9', totalCount: 3, lastUpdatedAt: T0 } }
    const r = a.ingest('c1', edited, 50)
    expect(r.changed).toBe(2)
    const page = a.page('c1', 10).messages
    expect(page[2].text).toBe('고친 내용')
    expect(page[3].thread?.totalCount).toBe(3)
    expect(a.parentOf('t9')).toBe('c1')
  })

  it('서버 창 안에서 사라진 메시지는 지운 것으로 보고 뺀다. 창 밖(오래된 것)은 남긴다', () => {
    const a = db()
    a.ingest('c1', range(1, 20), 10) // 요청 10개인데 20개? 실제론 없지만 보관만 확인
    // 최신 10개 요청 → 11..20 중 15 가 삭제됨
    const latest = range(11, 20).filter((m) => m.seq !== 15)
    // 응답이 요청보다 적지만 seq 11 이전은 "창 밖"이 아니다: 요청 크기 10, 응답 9 → 대화방 전체를 받은 것으로 판단
    const r = a.ingest('c1', latest, 10)
    expect(r.removed).toBe(11) // 1..10(전체 판단) + 15
    const b = db()
    b.ingest('c1', range(1, 20), 1000)
    const r2 = b.ingest('c1', range(6, 20).filter((m) => m.seq !== 15), 14)
    expect(r2.removed).toBe(1) // 15 만. 1..5 는 창 밖이라 남긴다
    expect(b.count('c1')).toBe(19)
  })

  it('빈 응답·seq 없는 응답으로는 아무것도 지우지 않는다', () => {
    const a = db()
    a.ingest('c1', range(1, 5), 50)
    expect(a.ingest('c1', [], 50).removed).toBe(0)
    expect(a.ingest('c1', [msg(0, { id: 'x' })], 50).removed).toBe(0)
    expect(a.count('c1')).toBe(6)
  })

  it('includeId 가 있으면 그 메시지까지 보이게 늘린다', () => {
    const a = db()
    a.ingest('c1', range(1, 500), 1000)
    const p = a.page('c1', 50, 'm100')
    expect(p.messages.some((m) => m.id === 'm100')).toBe(true)
    expect(p.messages.at(-1)?.seq).toBe(500)
  })
})

describe('안 읽음 (로컬 추정)', () => {
  it('읽은 시각 이후 다른 사람 메시지만 센다. 처음 보는 방은 0', () => {
    const a = db()
    a.ingest('c1', range(1, 10), 50)
    expect(a.summary('c1', 'me').unread).toBe(0) // 읽음 기록 없음
    a.markRead('c1', T0 + 4 * 60_000)
    // 5..10 중 other(홀수) = 5, 7, 9
    expect(a.summary('c1', 'me').unread).toBe(3)
    a.markRead('c1')
    expect(a.summary('c1', 'me').unread).toBe(0)
  })

  it('읽음 시각은 뒤로 가지 않는다', () => {
    const a = db()
    a.ingest('c1', range(1, 10), 50)
    a.markRead('c1')
    const v = a.readMs('c1')
    a.markRead('c1', T0)
    expect(a.readMs('c1')).toBe(v)
  })

  it('요약에 마지막 메시지 미리보기가 들어간다', () => {
    const a = db()
    a.ingest('c1', [msg(1, { text: '**굵게** 와 `코드`' })], 50)
    const s = a.summary('c1', 'me')
    expect(s.lastText).toBe('굵게 와 코드')
    expect(s.lastSenderId).toBe('other')
  })
})

describe('검색', () => {
  it('여러 단어는 모두 포함된 것만, 최신 순. 스레드 메시지는 부모 방을 알려 준다', () => {
    const a = db()
    a.ingest('c1', [msg(1, { text: '알파 릴리스 일정', thread: { channelId: 't1', totalCount: 1, lastUpdatedAt: null } }), msg(2, { text: '베타 릴리스' })], 50)
    a.ingest('t1', [msg(3, { channelId: 't1', text: '릴리스는 알파 먼저' })], 50)
    const hits = a.searchMessages('알파 릴리스', null)
    expect(hits.map((h) => h.message.seq)).toEqual([3, 1])
    expect(hits[0].parentChannelId).toBe('c1')
    // 대화방 안 검색은 그 방의 스레드까지
    expect(a.searchMessages('릴리스', 'c1')).toHaveLength(3)
    expect(a.searchMessages('릴리스', 'c2')).toHaveLength(0)
  })

  it('LIKE 특수문자를 글자 그대로 찾는다', () => {
    const a = db()
    a.ingest('c1', [msg(1, { text: '할인 50% 적용' }), msg(2, { text: '할인 500 적용' })], 50)
    expect(a.searchMessages('50%', null).map((h) => h.message.seq)).toEqual([1])
  })

  it('위키: 제목 색인과 열어 본 본문에서 찾고, 경로를 만든다', () => {
    const a = db()
    a.upsertWikiPages('w1', '알파 위키', [
      { id: 'p1', parentPageId: null, subject: '홈' },
      { id: 'p2', parentPageId: 'p1', subject: '회의록' },
      { id: 'p3', parentPageId: 'p2', subject: '3월 킥오프' }
    ])
    a.setWikiBody('p1', '홈\n릴리스 체크리스트는 회의록 아래에', null)
    const byTitle = a.searchWiki('킥오프')
    expect(byTitle[0].id).toBe('p3')
    expect(byTitle[0].path).toBe('알파 위키 › 홈 › 회의록')
    const byBody = a.searchWiki('체크리스트')
    expect(byBody[0].id).toBe('p1')
    expect(byBody[0].snippet).toContain('체크리스트')
  })

  it('다시 훑은 위키에서 안 보인 페이지는 지운다', () => {
    const a = db()
    a.upsertWikiPages('w1', 'W', [{ id: 'p1', parentPageId: null, subject: 'A' }, { id: 'p2', parentPageId: null, subject: 'B' }], 1000)
    a.upsertWikiPages('w1', 'W', [{ id: 'p1', parentPageId: null, subject: 'A' }], 2000)
    a.pruneWiki('w1', 2000)
    expect(a.wikiEntries().map((e) => e.id)).toEqual(['p1'])
  })
})

describe('미리보기 문자열', () => {
  it('snippet 은 검색어 주변만', () => {
    const long = 'ㄱ'.repeat(200) + '찾는말' + 'ㄴ'.repeat(200)
    const s = snippet(long, ['찾는말'], 10)
    expect(s.startsWith('…')).toBe(true)
    expect(s).toContain('찾는말')
    expect(s.length).toBeLessThan(40)
  })
  it('파일·삭제 메시지', () => {
    expect(previewText(msg(1, { type: 'FILE', file: { id: 'f', name: 'a.pdf', size: 1, mimeType: null } }))).toBe('[파일] a.pdf')
    expect(previewText(msg(1, { flags: 'DELETED_ROOT' }))).toBe('(삭제된 메시지)')
    expect(stripMarkdown('# 제목\n> 인용 [링크](http://x)')).toBe('제목\n인용 링크')
  })
})
