import { describe, expect, it, vi } from 'vitest'
import type { Member, Wiki, WikiPage, WikiPageSummary } from '../src/shared/types'
import type { ReceiptsSnapshot } from '../src/shared/types-receipts'
import {
  RECEIPTS_ROOT_TITLE,
  lastSeqBySender,
  memberIdFromTitle,
  memberPageBody,
  memberPageTitle,
  parseMemberBody,
  unreadBy
} from '../src/shared/receipts'

// 저장 파일은 메모리로
vi.mock('../src/main/store', () => {
  const files = new Map<string, unknown>()
  let n = 0
  return {
    jsonStore: <T,>(_file: string, fallback: T) => {
      const key = `s${n++}`
      return { read: () => (files.get(key) as T) ?? fallback, write: (v: T) => void files.set(key, JSON.parse(JSON.stringify(v))) }
    }
  }
})
const { ReceiptsService } = await import('../src/main/receipts/service')

const T0 = Date.parse('2026-11-22T00:00:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

describe('읽음 확인: 페이지 본문 형식', () => {
  it('표식과 멤버가 맞아야 읽는다', () => {
    const body = memberPageBody({ v: 1, memberId: 'a', enabled: true, since: T0, updatedAt: T0, channels: { c1: { seq: 5, at: T0 } } })
    expect(parseMemberBody(body, 'a')?.channels.c1.seq).toBe(5)
    expect(parseMemberBody(body, 'b')).toBeNull()
    expect(parseMemberBody('그냥 위키 페이지\n```json\n{"memberId":"a","since":1,"channels":{}}\n```', 'a')).toBeNull()
  })
  it('제목에서 멤버 ID', () => {
    expect(memberIdFromTitle(memberPageTitle('김(공)동', '123'))).toBe('123')
    expect(memberIdFromTitle('회의록 (3월)')).toBeNull()
  })
})

describe('읽음 확인: 안 읽은 사람 수', () => {
  const snap = (peers: ReceiptsSnapshot['peers']): ReceiptsSnapshot => ({ enabled: true, meId: 'me', peers })
  const mine = (seq: number, at = T0 + seq * 1000) => ({ channelId: 'c1', seq, sentAt: iso(at), senderId: 'me' })
  const none = new Map<string, number>()

  it('상대 기록이 없으면 숫자를 띄우지 않는다', () => {
    expect(unreadBy(mine(10), ['me', 'co'], snap({}), none)).toEqual([])
  })
  it('기록이 있고 그 위치 뒤의 내 메시지면 1, 읽으면 0', () => {
    const s = snap({ co: { memberId: 'co', since: T0, updatedAt: T0, channels: { c1: { seq: 9, at: 0 } } } })
    expect(unreadBy(mine(10), ['me', 'co'], s, none)).toEqual(['co'])
    s.peers.co.channels.c1.seq = 10
    expect(unreadBy(mine(10), ['me', 'co'], s, none)).toEqual([])
  })
  it('상대가 기능을 켜기 전 메시지에는 띄우지 않는다', () => {
    const s = snap({ co: { memberId: 'co', since: T0 + 60_000, updatedAt: T0, channels: {} } })
    expect(unreadBy(mine(10), ['me', 'co'], s, none)).toEqual([])
    expect(unreadBy(mine(100), ['me', 'co'], s, none)).toEqual(['co'])
  })
  it('상대가 그 뒤에 보낸 메시지가 있으면 읽은 것으로 (모바일·웹에서 읽고 답한 경우)', () => {
    const s = snap({ co: { memberId: 'co', since: T0, updatedAt: T0, channels: {} } })
    const later = lastSeqBySender([{ senderId: 'co', seq: 11 }])
    expect(unreadBy(mine(10), ['me', 'co'], s, later)).toEqual([])
    expect(unreadBy(mine(12), ['me', 'co'], s, later)).toEqual(['co'])
  })
  it('세 명 이상 방은 기록 있는 사람만 센다', () => {
    const s = snap({
      co: { memberId: 'co', since: T0, updatedAt: T0, channels: {} },
      dev: { memberId: 'dev', since: T0, updatedAt: T0, channels: {} }
    })
    expect(unreadBy(mine(10), ['me', 'co', 'dev', 'design'], s, none)).toEqual(['co', 'dev'])
  })
  it('남의 메시지에는 띄우지 않는다', () => {
    const s = snap({ co: { memberId: 'co', since: T0, updatedAt: T0, channels: {} } })
    expect(unreadBy({ ...mine(10), senderId: 'co' }, ['me', 'co'], s, none)).toEqual([])
  })
})

/** 두레이 위키를 흉내 내는 메모리 저장소 (두 앱이 함께 쓴다) */
function fakeDooray() {
  const pages = new Map<string, WikiPage & { creator: string }>()
  const counts = { create: 0, update: 0, get: 0, list: 0 }
  let id = 1000
  const wikis: Wiki[] = [
    { id: '20', name: '나중 위키', projectId: 'p2', homePageId: 'h20', type: 'project', scope: 'private' },
    { id: '3', name: '첫 위키', projectId: 'p1', homePageId: 'h3', type: 'project', scope: 'private' },
    { id: '1', name: '개인', projectId: 'p0', homePageId: 'h1', type: 'private', scope: 'private' }
  ]
  const mk = (wikiId: string, parent: string | null, subject: string, content: string, creator: string) => {
    const pid = String(id++)
    pages.set(pid, { id: pid, wikiId, parentPageId: parent, subject, root: false, version: '1', content, mimeType: 'text/x-markdown', createdAt: null, updatedAt: null, creatorId: creator, files: [], images: [], creator })
    return pid
  }
  const api = (me: Member) => ({
    messenger: { me: async () => me } as never,
    wiki: {
      wikis: async () => wikis,
      pages: async (wikiId: string, parent: string | null): Promise<WikiPageSummary[]> => {
        counts.list++
        return [...pages.values()].filter((p) => p.wikiId === wikiId && p.parentPageId === parent)
      },
      page: async (_w: string, pid: string) => {
        counts.get++
        const p = pages.get(pid)
        if (!p) throw new Error('없음')
        return { ...p }
      },
      create: async (wikiId: string, parent: string | null, subject: string, content: string) => {
        counts.create++
        return { id: mk(wikiId, parent, subject, content, me.id) }
      },
      updateContent: async (_w: string, pid: string, content: string) => {
        counts.update++
        pages.get(pid)!.content = content
      }
    } as never
  })
  return { pages, counts, api, mk }
}

function app(d: ReturnType<typeof fakeDooray>, me: Member, clock: { t: number }) {
  const events: ReceiptsSnapshot[] = []
  const s = new ReceiptsService({
    ...d.api(me),
    emit: ((e: string, p: unknown) => e === 'receipts:snapshot' && events.push(p as ReceiptsSnapshot)) as never,
    windowState: () => 'focused',
    now: () => clock.t,
    sleep: async () => {}
  })
  const tick = () => (s as unknown as { tick: () => Promise<void> }).tick()
  return { s, tick, events }
}

describe('읽음 확인: 두 앱이 위키로 주고받기', () => {
  it('같은 저장 위치를 고르고, A 가 보낸 것을 B 가 읽으면 A 쪽 기록에 반영된다', async () => {
    const d = fakeDooray()
    const clock = { t: T0 }
    const A = app(d, { id: 'a', name: '나소유' } as Member, clock)
    const B = app(d, { id: 'b', name: '김공동' } as Member, clock)
    await A.tick()
    await B.tick()
    // 개인 위키(1)는 빼고, ID 가 가장 작은 위키(3) 의 홈 아래에 저장 페이지 하나
    const roots = [...d.pages.values()].filter((p) => p.subject === RECEIPTS_ROOT_TITLE)
    expect(roots).toHaveLength(1)
    expect(roots[0].wikiId).toBe('3')
    expect(A.s.status().location?.rootPageId).toBe(B.s.status().location?.rootPageId)

    // B 가 c1 의 seq 10 까지 읽음 → 30초 묶음 뒤 기록
    clock.t += 31_000
    B.s.seen('c1', 10, T0)
    clock.t += 2_000
    await B.tick()
    clock.t += 31_000
    await A.tick()
    expect(A.s.snapshot().peers.b.channels.c1.seq).toBe(10)
    expect(A.s.snapshot().peers.b.since).toBe(T0)
  })

  it('읽은 위치가 그대로면 쓰지 않고, 표식이 없는 페이지에는 쓰지 않는다', async () => {
    const d = fakeDooray()
    const clock = { t: T0 }
    const A = app(d, { id: 'a', name: '나소유' } as Member, clock)
    await A.tick()
    const before = d.counts.update
    clock.t += 60_000
    A.s.seen('c1', 3, T0)
    A.s.seen('c1', 2, T0) // 뒤로 가지 않는다
    clock.t += 2_000
    await A.tick()
    expect(d.counts.update).toBe(before + 1)
    clock.t += 60_000
    await A.tick()
    expect(d.counts.update).toBe(before + 1)
    // 누가 내 페이지 본문을 바꿔 표식이 사라지면 쓰지 않는다
    const myPage = A.s.status().location!.myPageId!
    d.pages.get(myPage)!.content = '사람이 고친 내용'
    A.s.seen('c1', 9, T0)
    clock.t += 60_000
    await A.tick()
    expect(d.pages.get(myPage)!.content).toBe('사람이 고친 내용')
  })

  it('끄면 "껐음"을 기록해 상대 화면에서 숫자가 사라진다', async () => {
    const d = fakeDooray()
    const clock = { t: T0 }
    const A = app(d, { id: 'a', name: '나소유' } as Member, clock)
    const B = app(d, { id: 'b', name: '김공동' } as Member, clock)
    await A.tick()
    await B.tick()
    clock.t += 31_000
    await A.tick()
    expect(A.s.snapshot().peers.b).toBeTruthy()
    await B.s.setEnabled(false)
    clock.t += 11_000
    await A.tick()
    expect(A.s.snapshot().peers.b).toBeUndefined()
  })
})
