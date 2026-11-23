// 낙관적 전송: 줄을 더하지 않고, 빨리 들어가면 표시 없음, 서버 확정 때 같은 줄 키로 바꿔 끼움
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../src/renderer/src/api', () => ({ errorText: (e: unknown) => (e instanceof Error ? e.message : String(e)) }))

const S = await import('../src/renderer/src/components/chat/pendingStore')

let n = 0
const key = () => `room${++n}`
const me = 'me'
const msg = (id: string, text: string, at: number, senderId = me) => ({ id, senderId, sentAt: new Date(at).toISOString(), text })

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('보내는 상태', () => {
  it('1초 안에 들어가면 상태가 sending 그대로 (표시 없음)', async () => {
    const k = key()
    let resolve!: () => void
    const done = S.sendOptimistic(k, '안녕', (_t, confirm) => new Promise<void>((r) => (resolve = () => (confirm('s1'), r()))))
    expect(S.pendingFor(k)[0].status).toBe('sending')
    await vi.advanceTimersByTimeAsync(900)
    resolve()
    await done
    const p = S.pendingFor(k)[0]
    expect(p.status).toBe('sending')
    expect(p.serverId).toBe('s1')
    await vi.advanceTimersByTimeAsync(2000)
    expect(S.pendingFor(k)[0].status).toBe('sending') // 확정 뒤에는 느림 표시가 붙지 않는다
  })

  it('1초가 넘으면 slow, 실패하면 failed + 다시 보내기', async () => {
    const k = key()
    let fail = true
    let reject!: (e: Error) => void
    const send = vi.fn((_t: string, confirm: (id: string) => void) =>
      fail ? new Promise<void>((_r, j) => (reject = j)) : (confirm('s2'), Promise.resolve())
    )
    const done = S.sendOptimistic(k, '느림', send)
    await vi.advanceTimersByTimeAsync(1100)
    expect(S.pendingFor(k)[0].status).toBe('slow')
    reject(new Error('네트워크'))
    await done
    expect(S.pendingFor(k)[0]).toMatchObject({ status: 'failed', error: '네트워크' })
    fail = false
    await S.pendingFor(k)[0].retry()
    expect(send).toHaveBeenCalledTimes(2)
    expect(S.pendingFor(k)[0]).toMatchObject({ status: 'sending', serverId: 's2' })
  })
})

describe('서버 확정 때 바꿔 끼우기', () => {
  it('서버 ID 가 목록에 들어온 그 렌더에서 고르고, 줄 키를 이어 쓴다', async () => {
    const k = key()
    await S.sendOptimistic(k, '확정', (_t, c) => (c('s3'), Promise.resolve()))
    const p = S.pendingFor(k)[0]
    expect(S.arrivedPending([p], [msg('x', '다른 글', Date.now())], me).size).toBe(0)
    expect([...S.arrivedPending([p], [msg('s3', '확정', Date.now())], me)]).toEqual([p.id])
    expect(S.rowKeyOf('s3')).toBe(S.localId(p))
    expect(S.rowKeyOf('x')).toBe('x')
  })

  it('ID 를 받기 전에 목록이 먼저 갱신돼도 같은 글의 내 메시지로 짝짓는다 (두 번 그려지지 않게)', () => {
    const k = key()
    void S.sendOptimistic(k, '먼저 옴', () => new Promise<void>(() => {}))
    const p = S.pendingFor(k)[0]
    const list = [msg('old', '먼저 옴', p.at - 120_000), msg('other', '먼저 옴', p.at + 10, 'you'), msg('s4', '먼저 옴', p.at + 50)]
    expect([...S.arrivedPending([p], list, me)]).toEqual([p.id])
    expect(S.rowKeyOf('s4')).toBe(S.localId(p))
    expect(S.rowKeyOf('old')).toBe('old')
    // 다음 렌더에서도 계속 같은 짝 (지워지기 전까지 다시 나타나지 않게)
    expect([...S.arrivedPending([p], list, me)]).toEqual([p.id])
  })

  it('같은 글을 두 번 보내도 메시지 하나에 하나씩만 짝짓는다', () => {
    const k = key()
    void S.sendOptimistic(k, 'ㅇㅇ', () => new Promise<void>(() => {}))
    void S.sendOptimistic(k, 'ㅇㅇ', () => new Promise<void>(() => {}))
    const [a, b] = S.pendingFor(k)
    const got = S.arrivedPending([a, b], [msg('m1', 'ㅇㅇ', a.at + 5)], me)
    expect([...got]).toEqual([a.id])
  })

  it('목록에 끝내 안 나타나면 잠시 뒤 지운다', async () => {
    const k = key()
    await S.sendOptimistic(k, '사라짐', (_t, c) => (c('s5'), Promise.resolve()))
    expect(S.pendingFor(k)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(21_000)
    expect(S.pendingFor(k)).toHaveLength(0)
  })
})
