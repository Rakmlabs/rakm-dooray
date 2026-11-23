// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import type { Message } from '../src/shared/types'
import { reconcileMessages } from '../src/renderer/src/lib/hooks'
import { buildRows } from '../src/renderer/src/components/MessageList'
import { albumColumns, isAlbumPhoto } from '../src/renderer/src/components/files/PhotoAlbum'
import { badReason, nameFor, retryable } from '../src/renderer/src/components/files/uploadQueue'
import { renderMarkdown } from '../src/renderer/src/lib/markdown'

const base = Date.parse('2026-11-23T03:00:00Z')
let n = 0
function msg(p: Partial<Message> & { at?: number } = {}): Message {
  n++
  const { at, ...rest } = p
  return {
    id: `m${n}`,
    channelId: 'c',
    seq: n,
    type: 'TEXT',
    senderId: 'a',
    senderType: 'member',
    sentAt: new Date(base + (at ?? n) * 1000).toISOString(),
    text: `글 ${n}`,
    flags: null,
    file: null,
    thread: null,
    ...rest
  }
}
const photo = (p: Partial<Message> & { at?: number } = {}) =>
  msg({ type: 'FILE', text: '', file: { id: `f${n + 1}`, name: `사진${n + 1}.jpg`, size: 100, mimeType: 'image/jpeg' }, ...p })

describe('reconcileMessages', () => {
  it('바뀌지 않은 메시지는 같은 객체, 전부 같으면 같은 배열', () => {
    const a = [msg(), msg()]
    const same = a.map((m) => ({ ...m }))
    expect(reconcileMessages(a, same)).toBe(a)
    const edited = [{ ...a[0] }, { ...a[1], text: '고침' }]
    const r = reconcileMessages(a, edited)
    expect(r).not.toBe(a)
    expect(r[0]).toBe(a[0])
    expect(r[1]).toBe(edited[1])
    const added = [...same, msg()]
    const r2 = reconcileMessages(a, added)
    expect(r2[0]).toBe(a[0])
    expect(r2).toHaveLength(3)
  })
  it('스레드 답글 수가 바뀌면 새 객체', () => {
    const t = msg({ thread: { channelId: 't', totalCount: 1, lastUpdatedAt: 1 } })
    const r = reconcileMessages([t], [{ ...t, thread: { channelId: 't', totalCount: 2, lastUpdatedAt: 2 } }])
    expect(r[0]).not.toBe(t)
  })
})

describe('buildRows: 앨범 묶기', () => {
  it('같은 사람이 이어 보낸 사진 2장 이상은 앨범 한 줄', () => {
    const list = [msg({ at: 0 }), photo({ at: 10 }), photo({ at: 12 }), photo({ at: 14 }), msg({ at: 20 })]
    const rows = buildRows(list, null)
    expect(rows.map((r) => r.kind)).toEqual(['msg', 'album', 'msg'])
    const album = rows[1]
    expect(album.kind === 'album' && album.ms.length).toBe(3)
  })
  it('사진 한 장은 그대로, 다른 사람·간격이 크면 나눈다', () => {
    const list = [photo({ at: 0 }), msg({ at: 5 }), photo({ at: 10 }), photo({ at: 11, senderId: 'b' }), photo({ at: 400, senderId: 'b' })]
    expect(buildRows(list, null).map((r) => r.kind)).toEqual(['msg', 'msg', 'msg', 'msg', 'msg'])
  })
  it('30장을 넘으면 다음 앨범으로', () => {
    const list = Array.from({ length: 35 }, (_, i) => photo({ at: i }))
    const rows = buildRows(list, null)
    expect(rows.map((r) => (r.kind === 'album' ? r.ms.length : 1))).toEqual([30, 5])
  })
  it('같은 사람이 이어 쓴 글은 묶음(grouped), 날짜가 바뀌면 구분선', () => {
    const a = msg({ at: 0 })
    const b = msg({ at: 30 })
    const c = msg({ at: 86_400 * 2 })
    const rows = buildRows([a, b, c], null)
    expect(rows.map((r) => r.grouped)).toEqual([false, true, false])
    expect(rows[0].day).toBeTruthy()
    expect(rows[1].day).toBeNull()
    expect(rows[2].day).toBeTruthy()
  })
  it('삭제된 사진·스레드가 달린 사진은 앨범에 넣지 않는다', () => {
    expect(isAlbumPhoto(photo({ flags: 'DELETED_ROOT' }))).toBe(false)
    expect(isAlbumPhoto(photo({ thread: { channelId: 't', totalCount: 1, lastUpdatedAt: null } }))).toBe(false)
    expect(isAlbumPhoto(photo())).toBe(true)
    expect(isAlbumPhoto(msg({ type: 'FILE', file: { id: 'x', name: '문서.pdf', size: 1, mimeType: 'application/pdf' } }))).toBe(false)
  })
})

describe('앨범 칸·업로드 도구', () => {
  it('칸 수', () => {
    expect([1, 2, 3, 4, 5, 9].map(albumColumns)).toEqual([1, 2, 3, 2, 3, 3])
  })
  it('다시 보내도 되는 실패만 자동 재시도', () => {
    expect(retryable('POST /x 실패: 서버 오류 (500)')).toBe(true)
    expect(retryable('두레이에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.')).toBe(true)
    expect(retryable('권한 없음 (403)')).toBe(false)
    expect(retryable('파일이 너무 큽니다. 한 번에 100MB 까지')).toBe(false)
    expect(retryable('request timeout')).toBe(false)
  })
  it('붙여넣은 스크린샷 이름에 시각과 순번', () => {
    const f = new File([new Uint8Array([1])], 'image.png', { type: 'image/png' })
    expect(nameFor(f, true)).toMatch(/^스크린샷 \d{4}-\d\d-\d\d \d\d\.\d\d\.\d\d\.png$/)
    expect(nameFor(f, true, 2)).toMatch(/ \(3\)\.png$/)
    expect(nameFor(f, false)).toBe('image.png')
  })
  it('빈 파일·너무 큰 파일은 보낼 수 없음', () => {
    expect(badReason(new File([], 'a.txt'))).toBe('빈 파일')
    expect(badReason(new File([new Uint8Array([1])], 'a.txt'))).toBeNull()
  })
})

describe('마크다운 캐시', () => {
  it('같은 본문은 같은 결과', () => {
    const a = renderMarkdown('**굵게** `코드`')
    expect(renderMarkdown('**굵게** `코드`')).toBe(a)
    expect(renderMarkdown('줄\n바꿈', { breaks: false })).not.toBe(renderMarkdown('줄\n바꿈'))
  })
})
