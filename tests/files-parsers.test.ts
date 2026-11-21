import { describe, expect, it } from 'vitest'
import { cleanPrvText, columnName, imageMime, parseCsv, resolveZipPath, utf16le } from '../src/renderer/src/components/files/parsers'

describe('parseCsv', () => {
  it('따옴표 안 쉼표·줄바꿈·"" 를 처리한다', () => {
    expect(parseCsv('이름,금액\n김하나,"1,200,000"\n"박 ""세찬""","여러\n줄"\n')).toEqual([
      ['이름', '금액'],
      ['김하나', '1,200,000'],
      ['박 "세찬"', '여러\n줄']
    ])
  })
  it('CRLF, 탭 구분자 추정, 마지막 줄바꿈 없음', () => {
    expect(parseCsv('a\tb\r\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ])
    expect(parseCsv('a;b;c\n1;2;3', undefined)[1]).toEqual(['1', '2', '3'])
  })
})

describe('기타 도구', () => {
  it('엑셀식 열 이름', () => {
    expect(columnName(0)).toBe('A')
    expect(columnName(25)).toBe('Z')
    expect(columnName(26)).toBe('AA')
    expect(columnName(701)).toBe('ZZ')
  })
  it('HWP PrvText 의 <문단> 감싸기를 벗긴다', () => {
    const raw = Buffer.from('<주간 보고>\r\n<>\r\n<1. 개발>\0\0', 'utf16le')
    expect(cleanPrvText(utf16le(new Uint8Array(raw)))).toBe('주간 보고\n\n1. 개발')
  })
  it('zip 상대 경로', () => {
    expect(resolveZipPath('ppt/slides/slide1.xml', '../media/image1.png')).toBe('ppt/media/image1.png')
    expect(resolveZipPath('ppt/presentation.xml', 'slides/slide2.xml')).toBe('ppt/slides/slide2.xml')
    expect(resolveZipPath('ppt/slides/slide1.xml', '/ppt/media/a.png')).toBe('ppt/media/a.png')
  })
  it('미리보기 그림 형식', () => {
    expect(imageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBe('image/png')
    expect(imageMime(new Uint8Array([0x42, 0x4d, 0, 0]))).toBe('image/bmp')
    expect(imageMime(new Uint8Array([0, 0, 0, 0]))).toBeNull()
  })
})
