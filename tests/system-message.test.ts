import { describe, expect, it } from 'vitest'
import { parseSystem, systemText } from '../src/shared/system-message'

const names: Record<string, string> = { '1': '나소유', '2': '김공동', '3': '박개발' }
const nameOf = (id: string) => names[id] ?? null
const sys = (inner: unknown) => ({ type: 'SYSTEM', senderId: null, text: JSON.stringify(inner) })

describe('시스템 메시지', () => {
  it('참여: 초대한 사람과 들어온 사람', () => {
    const e = parseSystem(sys({ type: 'joinMember', joinMember: { host: '1', members: ['2', '3'] } }))!
    expect(systemText(e, nameOf)).toBe('나소유님이 김공동, 박개발님을 초대했습니다')
  })
  it('참여: 스스로 들어옴', () => {
    const e = parseSystem(sys({ type: 'joinMember', joinMember: { host: '2', members: ['2'] } }))!
    expect(systemText(e, nameOf)).toBe('김공동님이 참여했습니다')
  })
  it('나감', () => {
    expect(systemText(parseSystem(sys({ type: 'leaveMember', leaveMember: { members: ['3'] } }))!, nameOf)).toBe('박개발님이 나갔습니다')
  })
  it('대화방 만들기', () => {
    const e = parseSystem(sys({ type: 'createChannel', createChannel: { host: '1', title: '창업팀' } }))!
    expect(systemText(e, nameOf)).toBe('나소유님이 대화방 "창업팀"을(를) 만들었습니다')
  })
  it('이름을 모르면 "멤버", 모르는 종류는 일반 문구, 원문 JSON 은 안 보인다', () => {
    expect(systemText(parseSystem(sys({ type: 'joinMember', joinMember: { host: '9', members: ['9'] } }))!)).toBe('멤버님이 참여했습니다')
    const odd = systemText(parseSystem(sys({ type: 'somethingNew', somethingNew: { x: 1 } }))!, nameOf)
    expect(odd).toBe('알림 메시지')
    expect(systemText(parseSystem({ type: 'SYSTEM', senderId: null, text: 'not json' })!)).toBe('알림 메시지')
  })
  it('넷 이상이면 "외 N명"', () => {
    const e = parseSystem(sys({ type: 'joinMember', joinMember: { members: ['1', '2', '3', '4', '5'] } }))!
    expect(systemText(e, nameOf)).toBe('나소유, 김공동, 박개발 외 2명님이 참여했습니다')
  })
  it('보통 메시지는 시스템 메시지가 아니다 (JSON 처럼 보여도 보낸 사람이 있으면)', () => {
    expect(parseSystem({ type: 'NORMAL', senderId: '1', text: '{"type":"joinMember"}' })).toBeNull()
    expect(parseSystem({ type: 'NORMAL', senderId: '1', text: '안녕하세요' })).toBeNull()
  })
})
