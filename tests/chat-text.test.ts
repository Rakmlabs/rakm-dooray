import { describe, expect, it } from 'vitest'
import { firstPreviewUrl, highlightCode, mentionMarkup, parseWikiUrl, replaceMentions, wikiPageUrl } from '../src/renderer/src/lib/markdown'
import { activeMention, applyMentions, insideCodeFence } from '../src/renderer/src/components/chat/composerText'
import { appendToContent, messageToWikiBlock } from '../src/renderer/src/components/chat/wikiText'
import { initialsOf, avatarTone } from '../src/renderer/src/components/people/Avatar'
import { toProfile } from '../src/main/chat/profile'
import type { Message } from '../src/shared/types'

describe('멘션', () => {
  it('두레이 멘션을 클릭 가능한 span 으로', () => {
    const html = replaceMentions('안녕 [@김공동](dooray://123/members/m-co "member") 님')
    expect(html).toContain('data-member-id="m-co"')
    expect(html).toContain('@김공동')
    expect(replaceMentions('[@Channel](dooray://123/channels/c1 "channel")')).toContain('@모두')
  })
  it('이름에 HTML 이 있어도 이스케이프', () => {
    expect(replaceMentions('[@<b>x</b>](dooray://1/members/2 "member")')).toContain('&lt;b&gt;')
  })
  it('보낼 형식', () => {
    expect(mentionMarkup('김공동', 'm-co', '123')).toBe('[@김공동](dooray://123/members/m-co "member")')
    expect(mentionMarkup('김공동', 'm-co', null)).toBe('@김공동')
  })
  it('입력 중인 @검색어 찾기', () => {
    expect(activeMention('안녕 @김', 5)).toEqual({ start: 3, query: '김' })
    expect(activeMention('@', 1)).toEqual({ start: 0, query: '' })
    expect(activeMention('mail@foo', 8)).toBeNull()
    expect(activeMention('@김공동 하이', 8)).toBeNull()
  })
  it('남아 있는 @이름 만 멘션 형식으로', () => {
    const out = applyMentions('@김공동 확인 부탁, @박개발님 도', { 김공동: 'm-co', 박개발: 'm-dev' }, '9')
    expect(out).toBe('[@김공동](dooray://9/members/m-co "member") 확인 부탁, @박개발님 도')
    expect(applyMentions('@김공동 hi', { 김공동: 'm-co' }, null)).toBe('@김공동 hi')
  })
})

describe('코드 블록 입력', () => {
  it('닫히지 않은 ``` 안이면 true', () => {
    expect(insideCodeFence('```js\nconst a', 13)).toBe(true)
    expect(insideCodeFence('```js\na\n```\n', 12)).toBe(false)
    expect(insideCodeFence('그냥 글', 4)).toBe(false)
  })
  it('문법 강조', () => {
    const r = highlightCode('const a = 1 // c', 'ts')
    expect(r.language).toBe('ts')
    expect(r.html).toContain('hljs-keyword')
    expect(highlightCode('<b>', 'nope').html).toBe('&lt;b&gt;')
  })
})

describe('위키 링크', () => {
  it('주소 만들기·해석', () => {
    const url = wikiPageUrl('rakm.dooray.com', 'w1', 'p1')
    expect(url).toBe('https://rakm.dooray.com/wiki/w1/p1')
    expect(parseWikiUrl(url)).toEqual({ wikiId: 'w1', pageId: 'p1' })
    expect(parseWikiUrl('https://rakm.dooray.com/project/wiki/123/456')).toEqual({ wikiId: '123', pageId: '456' })
    expect(parseWikiUrl('https://evil.com/wiki/1/2')).toBeNull()
    expect(parseWikiUrl('https://rakm.dooray.com/wiki/1/pages')).toBeNull()
  })
  it('미리보기 대상 링크: 두레이 주소·코드 안 링크 제외', () => {
    expect(firstPreviewUrl('봐요 https://example.com/a. 끝')).toBe('https://example.com/a')
    expect(firstPreviewUrl('`https://x.com` https://rakm.dooray.com/wiki/1/2')).toBeNull()
    expect(firstPreviewUrl('[@a](dooray://1/members/2 "member") http://y.example/')).toBe('http://y.example/')
  })
})

describe('위키로 보내기', () => {
  const m = { text: '[@김공동](dooray://1/members/m "member") 회의 **정리**', sentAt: '2026-03-01T05:02:00Z', file: null } as unknown as Message
  it('멘션 링크를 @이름 으로', () => {
    const b = messageToWikiBlock(m, '나소유')
    expect(b).toContain('#### 나소유')
    expect(b).toContain('@김공동 회의 **정리**')
    expect(b).not.toContain('dooray://')
  })
  it('덧붙이기는 기존 본문을 그대로 두고 끝에만 추가', () => {
    const old = '# 제목\n\n본문  \n끝'
    const out = appendToContent(old, 'X\n')
    expect(out.startsWith(old)).toBe(true)
    expect(out.slice(old.length)).toBe('\n\n---\n\nX\n')
    expect(appendToContent('a\n', 'X')).toBe('a\n\n---\n\nX')
    expect(appendToContent('', 'X')).toBe('X')
  })
})

describe('아바타·프로필', () => {
  it('이니셜', () => {
    expect(initialsOf('김공동')).toBe('김')
    expect(initialsOf('Jane Doe')).toBe('JD')
    expect(initialsOf('  ')).toBe('?')
  })
  it('같은 사람은 같은 색', () => {
    expect(avatarTone('m-co')).toBe(avatarTone('m-co'))
    expect(avatarTone('m-co')).toBeGreaterThanOrEqual(0)
  })
  it('공식 멤버 상세 응답 → 프로필', () => {
    const p = toProfile('x', { id: '1', name: '김', externalEmailAddress: 'a@b.c', userCode: 'kim', englishName: '', defaultOrganization: { id: 99 } })
    expect(p).toEqual({ id: '1', name: '김', email: 'a@b.c', userCode: 'kim', englishName: null, nickname: null, organizationId: '99' })
  })
})
