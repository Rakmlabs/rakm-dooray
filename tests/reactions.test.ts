// 이모지 반응: 두레이에는 메시지 한 줄로 가고, 이 앱은 대상 아래 칩으로 모은다
import { describe, expect, it } from 'vitest'
import type { Message } from '../src/shared/types'
import { applyOptimistic, foldReactions, parseReaction, reactionLabel, reactionText, settled } from '../src/renderer/src/components/chat/reactions'

let seq = 0
const m = (id: string, senderId: string, text: string, file: Message['file'] = null): Message => ({
  id,
  channelId: 'c',
  seq: ++seq,
  type: file ? 'FILE' : 'TEXT',
  senderId,
  senderType: 'member',
  sentAt: new Date(1_700_000_000_000 + seq * 1000).toISOString(),
  text,
  flags: null,
  file,
  thread: null
})

describe('반응 글', () => {
  it('두레이에서 읽히는 한 줄로 만들고 다시 읽는다', () => {
    const t = reactionText('👍', '박서연', m('1', 'a', '메신저 화면 시안 올렸어요. 확인 부탁드려요!'))
    expect(t).toBe('👍 박서연 「메신저 화면 시안 올렸어요. 확인 부…」')
    expect(parseReaction(t)).toEqual({ emoji: '👍', label: '메신저 화면 시안 올렸어요. 확인 부…' })
  })
  it('여러 글자 이모지(❤️, 🫡)도 된다', () => {
    expect(parseReaction(reactionText('❤️', '김', m('1', 'a', '좋아요')))?.emoji).toBe('❤️')
    expect(parseReaction(reactionText('🫡', '김', m('1', 'a', '좋아요')))?.emoji).toBe('🫡')
  })
  it('보통 글은 반응이 아니다', () => {
    expect(parseReaction('안녕 하세요 「인용」')).toBeNull()
    expect(parseReaction('👍')).toBeNull()
    expect(parseReaction('👍 좋아요')).toBeNull()
  })
  it('멘션은 @이름, 파일은 파일 이름, 「」 는 뺀다', () => {
    expect(reactionLabel(m('1', 'a', '[@김우람](dooray://1/members/2 "member") 확인'))).toBe('@김우람 확인')
    expect(reactionLabel(m('1', 'a', '', { id: 'f', name: 'a.png', size: 1, mimeType: 'image/png' }))).toBe('a.png')
    expect(reactionLabel(m('1', 'a', '「인용」'))).toBe('인용')
  })
})

describe('칩으로 모으기', () => {
  it('반응 줄은 목록에서 빠지고 대상 메시지에 모인다', () => {
    const target = m('t', 'a', '점심 뭐 먹을까요')
    const list = [target, m('x', 'b', '저는 아무거나'), m('r1', 'b', reactionText('👍', 'A', target)), m('r2', 'me', reactionText('👍', 'A', target)), m('r3', 'c', reactionText('😂', 'A', target))]
    const f = foldReactions(list, 'me')
    expect(f.list.map((x) => x.id)).toEqual(['t', 'x'])
    expect(f.hidden).toEqual(new Set(['r1', 'r2', 'r3']))
    expect(f.byTarget.get('t')).toEqual([
      { emoji: '👍', by: ['b', 'me'], mine: ['r2'] },
      { emoji: '😂', by: ['c'], mine: [] }
    ])
  })
  it('같은 글이 여러 번이면 반응 바로 앞의 가장 가까운 것', () => {
    const a = m('a', 'x', '네')
    const b = m('b', 'y', '네')
    const f = foldReactions([a, b, m('r', 'z', reactionText('✅', 'Y', b))], null)
    expect([...f.byTarget.keys()]).toEqual(['b'])
  })
  it('대상이 목록에 없으면 보통 메시지로 둔다', () => {
    const list = [m('r', 'z', '👍 누군가 「불러오지 않은 옛 메시지」')]
    const f = foldReactions(list, null)
    expect(f.list).toBe(list)
    expect(f.byTarget.size).toBe(0)
  })
  it('같은 사람이 같은 이모지를 두 번 보내도 한 명으로 센다', () => {
    const t = m('t', 'a', '배포 완료')
    const f = foldReactions([t, m('r1', 'me', reactionText('🎉', 'A', t)), m('r2', 'me', reactionText('🎉', 'A', t))], 'me')
    expect(f.byTarget.get('t')).toEqual([{ emoji: '🎉', by: ['me'], mine: ['r1', 'r2'] }])
  })
})

describe('누르는 즉시 보이기', () => {
  it('더하기·빼기를 덧씌우고, 서버가 따라오면 걷힌다', () => {
    const add = { target: 't', emoji: '👍', op: 'add' as const, at: 0 }
    expect(applyOptimistic(undefined, [add], 't', 'me')).toEqual([{ emoji: '👍', by: ['me'], mine: [] }])
    expect(settled(add, undefined, 'me')).toBe(false)
    expect(settled(add, [{ emoji: '👍', by: ['me'], mine: ['r'] }], 'me')).toBe(true)
    const remove = { target: 't', emoji: '👍', op: 'remove' as const, at: 0 }
    expect(applyOptimistic([{ emoji: '👍', by: ['me'], mine: ['r'] }], [remove], 't', 'me')).toBeUndefined()
    expect(applyOptimistic([{ emoji: '👍', by: ['b', 'me'], mine: ['r'] }], [remove], 't', 'me')).toEqual([{ emoji: '👍', by: ['b'], mine: [] }])
  })
})
