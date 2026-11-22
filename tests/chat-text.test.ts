import { describe, expect, it } from 'vitest'
import { firstPreviewUrl, highlightCode, mentionMarkup, parseWikiUrl, replaceMentions, wikiPageUrl } from '../src/renderer/src/lib/markdown'
import { activeMention, applyFormat, applyMentions, autoCloseFence, closeOpenFence, indentCode, insideCodeFence } from '../src/renderer/src/components/chat/composerText'
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

describe('코드 서식 넣기', () => {
  it('인라인 코드: 선택을 감싸고, 이미 감싼 것은 벗긴다', () => {
    expect(applyFormat('run npm i now', 4, 9, 'inline')).toEqual({ text: 'run `npm i` now', selStart: 5, selEnd: 10 })
    expect(applyFormat('run `npm i` now', 5, 10, 'inline')).toEqual({ text: 'run npm i now', selStart: 4, selEnd: 9 })
    expect(applyFormat('ab', 1, 1, 'inline')).toEqual({ text: 'a``b', selStart: 2, selEnd: 2 })
  })
  it('여러 줄 선택은 코드 블록으로, ``` 는 각자 한 줄에', () => {
    const r = applyFormat('보세요 a\nb 끝', 4, 7, 'inline')
    expect(r.text).toBe('보세요 \n```\na\nb\n``` 끝'.replace('``` 끝', '```\n 끝'))
    const e = applyFormat('', 0, 0, 'block')
    expect(e.text).toBe('```\n\n```')
    expect(e.selStart).toBe(4)
  })
  it('링크', () => {
    expect(applyFormat('문서', 0, 2, 'link').text).toBe('[문서](https://)')
    expect(applyFormat('https://a.com', 0, 13, 'link')).toEqual({ text: '[](https://a.com)', selStart: 1, selEnd: 1 })
  })
  it('```언어 줄에서 Enter 면 닫는 ``` 를 미리 넣는다', () => {
    expect(autoCloseFence('```js', 5)).toEqual({ text: '```js\n\n```', selStart: 6, selEnd: 6 })
    expect(autoCloseFence('hi\n```', 6)?.text).toBe('hi\n```\n\n```')
    // 닫는 줄이거나, 뒤에 이미 닫는 ``` 가 있거나, 평범한 줄이면 하지 않음
    expect(autoCloseFence('```\na\n```', 9)).toBeNull()
    expect(autoCloseFence('```\n\n```', 3)).toBeNull()
    expect(autoCloseFence('그냥', 2)).toBeNull()
  })
  it('코드 블록 안 Tab 들여쓰기/내어쓰기', () => {
    expect(indentCode('```\nab\n```', 5, 5, false).text).toBe('```\na  b\n```')
    expect(indentCode('```\na\nb\n```', 4, 7, false).text).toBe('```\n  a\n  b\n```')
    expect(indentCode('```\n  a\n  b\n```', 6, 11, true).text).toBe('```\na\nb\n```')
  })
  it('닫지 않은 코드 블록은 보낼 때 닫는다', () => {
    expect(closeOpenFence('```js\nconst a = 1')).toBe('```js\nconst a = 1\n```')
    expect(closeOpenFence('```\na\n```')).toBe('```\na\n```')
  })
})
