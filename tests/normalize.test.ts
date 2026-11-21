import { describe, expect, it } from 'vitest'
import { normalizeChannel, normalizeLog, unwrapText } from '../src/main/dooray/messenger'
import { extractChannelId } from '../src/main/dooray/realtime'
import { splitAddresses } from '../src/main/mail/service'
import { parseDotEnv } from '../src/main/dotenv'

describe('메신저 응답 정규화', () => {
  it('채널: 공식 문서 예시 형태', () => {
    const c = normalizeChannel({
      id: '2138186748229007787',
      title: '',
      type: 'direct',
      users: {
        participants: [{ member: { organizationMemberId: 'a' } }, { member: { organizationMemberId: 'b' } }]
      },
      me: { member: { organizationMemberId: 'a' } },
      status: 'normal',
      updatedAt: '2020-08-25T12:30:00+09:00'
    })
    expect(c).toMatchObject({ id: '2138186748229007787', type: 'direct', participantIds: ['a', 'b'], meId: 'a' })
  })

  it('답장 text 의 JSON 을 푼다', () => {
    expect(unwrapText('REPLY', '{"type":0,"text":"네 확인했습니다"}')).toBe('네 확인했습니다')
    expect(unwrapText('TEXT', '그냥 메시지')).toBe('그냥 메시지')
    expect(unwrapText('REPLY', '{깨진 json')).toBe('{깨진 json')
  })

  it('스레드·파일 정보를 꺼낸다 (숫자 ID 도 문자열로)', () => {
    const m = normalizeLog('c1', {
      id: 123,
      seq: '7',
      type: 'FILE',
      sender: { type: 'member', member: { organizationMemberId: 'u1' } },
      text: '',
      file: { id: 55, name: '견적서.pdf', fileSize: 2048 },
      thread: { channelId: 999, totalCount: '3', lastUpdatedAt: 1700000000000 }
    })
    expect(m).toMatchObject({
      id: '123',
      seq: 7,
      senderId: 'u1',
      file: { id: '55', name: '견적서.pdf', size: 2048 },
      thread: { channelId: '999', totalCount: 3, lastUpdatedAt: 1700000000000 }
    })
  })
})

describe('Socket Mode 이벤트', () => {
  it('channelLog 의 channelId 를 꺼낸다', () => {
    expect(extractChannelId({ type: 'channelLog', action: 'create', content: { channelId: '42' } })).toBe('42')
    expect(extractChannelId({ type: 'channelLog', channelId: 7, content: {} })).toBe('7')
    expect(extractChannelId({ type: 'sessionInfo' })).toBeNull()
  })
})

describe('기타', () => {
  it('메일 주소 나누기', () => {
    expect(splitAddresses('a@x.com, b@y.com;\n c@z.com ,')).toEqual(['a@x.com', 'b@y.com', 'c@z.com'])
  })
  it('.env 파싱', () => {
    expect(parseDotEnv('# 주석\nA=1\nB="두 단어"\nEMPTY=\n')).toEqual({ A: '1', B: '두 단어' })
  })
})
