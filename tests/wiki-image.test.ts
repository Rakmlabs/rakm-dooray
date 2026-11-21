import { describe, expect, it } from 'vitest'
import { parseWikiImageSrc } from '../src/main/dooray/wiki'

describe('본문 이미지 경로 → 두레이 파일', () => {
  it('공식 형식 /wikis/{wikiId}/files/{attachFileId}', () => {
    expect(parseWikiImageSrc('/wikis/123/files/456')).toEqual({ kind: 'attach', wikiId: '123', attachFileId: '456' })
    expect(parseWikiImageSrc('https://rakm.dooray.com/wikis/123/files/456?x=1')).toEqual({ kind: 'attach', wikiId: '123', attachFileId: '456' })
  })
  it('웹 화면 경로(불확실)', () => {
    expect(parseWikiImageSrc('/page-files/789')).toEqual({ kind: 'pageFile', fileId: '789' })
  })
  it('두레이가 아닌 주소에는 토큰을 보내지 않는다', () => {
    expect(parseWikiImageSrc('https://evil.example.com/wikis/1/files/2')).toBeNull()
    expect(parseWikiImageSrc('http://rakm.dooray.com/wikis/1/files/2')).toBeNull()
    expect(parseWikiImageSrc('https://dooray.com.evil.io/wikis/1/files/2')).toBeNull()
    expect(parseWikiImageSrc('data:image/png;base64,xx')).toBeNull()
    expect(parseWikiImageSrc('/wikis/1/files/2/../../x')).toBeNull()
    expect(parseWikiImageSrc('images/a.png')).toBeNull()
  })
})
