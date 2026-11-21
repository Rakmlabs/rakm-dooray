import { describe, expect, it } from 'vitest'
import { fileKind, fileUrl, mimeFromName, parseFileUrl, thumbUrl } from '@shared/types-files'

describe('fileKind', () => {
  it('확장자로 분류한다 (mimeType 이 없어도)', () => {
    expect(fileKind('사진.JPG')).toBe('image')
    expect(fileKind('a.mp4')).toBe('video')
    expect(fileKind('녹음.m4a')).toBe('audio')
    expect(fileKind('사업계획서_v3.pdf')).toBe('pdf')
    expect(fileKind('a.docx')).toBe('docx')
    expect(fileKind('a.xlsx')).toBe('xlsx')
    expect(fileKind('a.pptx')).toBe('pptx')
    expect(fileKind('a.hwp')).toBe('hwp')
    expect(fileKind('a.hwpx')).toBe('hwpx')
    expect(fileKind('README.md')).toBe('markdown')
    expect(fileKind('a.csv')).toBe('csv')
    expect(fileKind('a.json')).toBe('json')
    expect(fileKind('server.ts')).toBe('code')
    expect(fileKind('Dockerfile')).toBe('code')
    expect(fileKind('메모.txt')).toBe('text')
    expect(fileKind('a.zip')).toBe('other')
    expect(fileKind('a.doc')).toBe('other')
  })
  it('확장자가 없으면 mime 으로', () => {
    expect(fileKind('image', 'image/png')).toBe('image')
    expect(fileKind('clip', 'video/mp4')).toBe('video')
    expect(fileKind('x', 'text/plain')).toBe('text')
    expect(fileKind('x', null)).toBe('other')
  })
  it('mimeFromName', () => {
    expect(mimeFromName('a.png')).toBe('image/png')
    expect(mimeFromName('a.ts')).toBe('text/plain')
    expect(mimeFromName('a.unknown')).toBe('application/octet-stream')
  })
})

describe('rakm-file 주소', () => {
  it('만든 주소를 그대로 되읽는다', () => {
    const u = parseFileUrl(fileUrl('c-general', 'f/1', '사진 1.jpg'))
    expect(u).toEqual({ host: 'file', parts: ['c-general', 'f/1'], name: '사진 1.jpg' })
    expect(parseFileUrl(thumbUrl('c', 'f', 'a.png'))?.host).toBe('thumb')
  })
  it('경로 탐색·다른 호스트·다른 스킴은 거절한다', () => {
    // URL 이 점 세그먼트를 먼저 정리하므로 '..' 가 ID 로 남지 않는다 (ID 는 경로로 쓰이지 않는다)
    expect(parseFileUrl('rakm-file://file/c/../../etc/passwd')?.parts.includes('..')).toBeFalsy()
    expect(parseFileUrl('rakm-file://file/c/%2E%2E')).toBeNull()
    expect(parseFileUrl('rakm-file://file/c/a/b')).toBeNull()
    expect(parseFileUrl('rakm-file://disk/c/a')).toBeNull()
    expect(parseFileUrl('file:///etc/passwd')).toBeNull()
    expect(parseFileUrl('rakm-file://pdfjs/cmaps/UniKS-UCS2-H.bcmap')?.parts).toEqual(['cmaps', 'UniKS-UCS2-H.bcmap'])
    expect(parseFileUrl('rakm-file://pdfjs/../package.json')).toBeNull()
    expect(parseFileUrl('rakm-file://pdfjs/web/viewer.mjs')).toBeNull()
  })
})
