// 모의 서버 — 위키 블록 편집기 영역 경로. 이 영역 작업자만 고친다.
// 처리했으면 true 를 돌려준다. ctx: { req, res, url, p, send, ok, body, state }
// state 에는 mock-dooray.mjs 의 공용 데이터(members, channels, logs, wikis, wikiPages, comments, ME, log, iso)가 들어 있다.
//
// 이 파일이 하는 일 (위키 저장 검증용, 실제 두레이와 다를 수 있다)
// - 단건 조회: version·updatedAt 을 페이지별로 관리, files/images 포함
// - PUT .../title, .../content: 값이 바뀌면 version +1, updatedAt 갱신
// - 'pc'(충돌 재현) 페이지: 두 번째 조회부터 "다른 사람이 고친" 상태가 된다 (한 번만)
// - POST /__mock/wiki/pages/{id}/touch: 다른 사람이 지금 고친 상황을 만든다
// - POST .../pages/{id}/files (multipart), GET .../attachFiles/{id}, GET .../pages/{id}/files/{id}
// - GET /__mock/wiki/pages/{id}: 지금 본문 확인 (검증 스크립트용), 저장 요청 횟수 putCount
import { deflateSync } from 'node:zlib'

function crc32(buf) {
  let c
  const table = (crc32.t ??= Array.from({ length: 256 }, (_, n) => {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  }))
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** 단색 띠 무늬 PNG (모의 이미지) */
function makePng(w, h, [r1, g1, b1], [r2, g2, b2]) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const t = x / w
      const band = Math.floor((x + y) / 24) % 2 ? 0.92 : 1
      const o = y * (w * 3 + 1) + 1 + x * 3
      raw[o] = Math.round((r1 + (r2 - r1) * t) * band)
      raw[o + 1] = Math.round((g1 + (g2 - g1) * t) * band)
      raw[o + 2] = Math.round((b1 + (b2 - b1) * t) * band)
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const files = new Map() // attachFileId → { id, pageId, name, mime, bytes, type }
let fileSeq = 9100
files.set('9001', { id: '9001', pageId: 'p5', name: '화면구성.png', mime: 'image/png', bytes: makePng(480, 160, [74, 108, 247], [140, 92, 246]), type: 'inline_image' })

const meta = {} // pageId → { version, updatedAt, getCount, conflictDone, putCount }
const metaOf = (state, id) =>
  (meta[id] ??= { version: Number(state.wikiPages[id]?.version ?? 1), updatedAt: new Date(state.now - 3e6).toISOString(), getCount: 0, conflictDone: false, putCount: 0 })

let seeded = false
function seed(state) {
  if (seeded) return
  seeded = true
  const add = (id, parentPageId, subject, body) => {
    state.wikiPages[id] = { id, wikiId: 'w1', parentPageId, subject, root: false, version: '3', body }
  }
  add(
    'p5',
    'p1',
    '블록 편집 시험',
    '${toc}\n\n# 블록 편집 시험\n\n이 페이지는 **블록 편집**을 시험합니다. 문단을 눌러 바로 고치세요.\n\n## 할 일\n\n- [x] 요구사항 정리\n- [ ] 자동 저장 확인\n  - [ ] 저장 상태 표시\n\n## 표\n\n| 항목 | 담당 | 기한 |\n|---|---|---|\n| 릴리스 범위 | 김공동 | 3/3 |\n| QA 계획 | 박개발 | 3/8 |\n\n## 그림\n\n![화면구성.png](/wikis/w1/files/9001)\n\n<div align="center">\n  <b>HTML 블록은 원문 그대로 보존</b>\n</div>\n\n```js\nconst release = new Date(\'2026-03-15\')\n```\n\n> 질문은 창업팀 대화방 `[알파]` 스레드로.\n\n1. 첫째\n2. 둘째\n   - 섞인 글머리\n\n---\n\n끝 문단 *기울임* _밑줄 기울임_ 그리고 [링크](https://example.com).\n'
  )
  add('pc', 'p1', '충돌 재현 페이지', '# 충돌 재현\n\n이 페이지를 고쳐 저장하면, 그 사이 다른 사람이 고친 것처럼 서버 버전이 바뀌어 있습니다.\n')
  add('pw', 'p1', '윈도 줄바꿈 문서', '# 윈도에서 쓴 문서\r\n\r\n줄바꿈이 CRLF 입니다.\r\n\r\n- 항목\r\n')
}

function otherEdit(state, id) {
  const m = metaOf(state, id)
  m.version += 1
  m.updatedAt = new Date().toISOString()
  state.wikiPages[id].body = state.wikiPages[id].body.replace(/\n*$/, '') + '\n\n(김공동이 방금 이 줄을 추가했습니다)\n'
}

async function readRaw(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks)
}

/** multipart 에서 필드 순서와 file 파트를 꺼낸다 */
function parseMultipart(buf, contentType) {
  const b = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType ?? '')
  if (!b) return null
  const boundary = Buffer.from('--' + (b[1] ?? b[2]))
  const parts = []
  let i = buf.indexOf(boundary)
  while (i >= 0) {
    const start = i + boundary.length + 2
    const next = buf.indexOf(boundary, start)
    if (next < 0) break
    const part = buf.subarray(start, next - 2)
    const headEnd = part.indexOf('\r\n\r\n')
    const head = part.subarray(0, headEnd).toString('utf8')
    const name = /name="([^"]*)"/.exec(head)?.[1]
    const filename = /filename="([^"]*)"/.exec(head)?.[1]
    const type = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]
    parts.push({ name, filename, type, data: part.subarray(headEnd + 4) })
    i = next
  }
  return parts
}

export async function handle({ req, res, url, p, send, ok, body, state }) {
  seed(state)
  let m
  // 검증용: 다른 사람이 고친 상황 만들기 / 지금 상태 보기
  if ((m = p.match(/^\/__mock\/wiki\/pages\/([^/]+)\/touch$/)) && req.method === 'POST') {
    if (!state.wikiPages[m[1]]) return send(404, ok(null)), true
    otherEdit(state, m[1])
    send(200, ok({ version: String(metaOf(state, m[1]).version) }))
    return true
  }
  if ((m = p.match(/^\/__mock\/wiki\/pages\/([^/]+)$/)) && req.method === 'GET') {
    const pg = state.wikiPages[m[1]]
    const mt = metaOf(state, m[1])
    send(200, ok({ subject: pg?.subject, content: pg?.body, version: String(mt.version), putCount: mt.putCount }))
    return true
  }
  // 단건 조회
  if ((m = p.match(/^\/wiki\/v1\/pages\/([^/]+)$/)) && req.method === 'GET') {
    const pg = state.wikiPages[m[1]]
    if (!pg) {
      send(404, { header: { isSuccessful: false, resultCode: -1, resultMessage: encodeURIComponent('존재하지 않는 페이지입니다') } })
      return true
    }
    const mt = metaOf(state, pg.id)
    mt.getCount++
    if (pg.id === 'pc' && mt.getCount >= 2 && !mt.conflictDone) {
      mt.conflictDone = true
      otherEdit(state, pg.id)
    }
    const pageFiles = [...files.values()].filter((f) => f.pageId === pg.id)
    const fileOut = (f) => ({ id: f.id, attachFileId: f.id, name: f.name, size: f.bytes.length })
    send(
      200,
      ok({
        ...pg,
        version: String(mt.version),
        body: { mimeType: 'text/x-markdown', content: pg.body },
        createdAt: state.iso(9e6),
        updatedAt: mt.updatedAt,
        creator: { member: { organizationMemberId: pg.creator ?? 'm-co' } },
        files: [...(pg.id === 'p1' ? [{ id: 'wf1', name: '릴리스일정.xlsx', size: 5167 }] : []), ...pageFiles.filter((f) => f.type === 'general').map(fileOut)],
        images: pageFiles.filter((f) => f.type === 'inline_image').map(fileOut)
      })
    )
    return true
  }
  // 제목·본문 수정: 값이 바뀌면 버전 +1
  if ((m = p.match(/^\/wiki\/v1\/wikis\/[^/]+\/pages\/([^/]+)\/(title|content)$/)) && req.method === 'PUT') {
    const pg = state.wikiPages[m[1]]
    if (!pg) return send(404, ok(null)), true
    const b = await body(req)
    const mt = metaOf(state, pg.id)
    mt.putCount++
    const before = m[2] === 'title' ? pg.subject : pg.body
    if (m[2] === 'title') pg.subject = b.subject
    else pg.body = b.body?.content ?? ''
    if ((m[2] === 'title' ? pg.subject : pg.body) !== before) {
      mt.version += 1
      mt.updatedAt = new Date().toISOString()
    }
    send(200, ok(null))
    return true
  }
  // 파일 업로드 (type 이 file 보다 먼저 와야 한다)
  if ((m = p.match(/^\/wiki\/v1\/wikis\/([^/]+)\/pages\/([^/]+)\/files$/)) && req.method === 'POST') {
    const parts = parseMultipart(await readRaw(req), req.headers['content-type'])
    const typeIdx = parts?.findIndex((x) => x.name === 'type') ?? -1
    const fileIdx = parts?.findIndex((x) => x.name === 'file') ?? -1
    if (!parts || fileIdx < 0 || typeIdx < 0 || typeIdx > fileIdx) {
      send(400, { header: { isSuccessful: false, resultCode: -1, resultMessage: 'type 필드를 file 보다 먼저 보내야 합니다 (모의)' } })
      return true
    }
    const f = parts[fileIdx]
    const id = String(++fileSeq)
    const type = parts[typeIdx].data.toString('utf8')
    files.set(id, { id, pageId: m[2], name: f.filename || 'file', mime: f.type || 'application/octet-stream', bytes: Buffer.from(f.data), type })
    send(201, ok({ id, attachFileId: id, name: f.filename, mimeType: f.type, type, size: f.data.length, createdAt: new Date().toISOString() }))
    return true
  }
  // 파일 다운로드: attachFiles/{attachFileId}, pages/{pageId}/files/{fileId}
  if ((m = p.match(/^\/wiki\/v1\/wikis\/[^/]+\/(?:attachFiles|pages\/[^/]+\/files)\/([^/]+)$/)) && req.method === 'GET') {
    const f = files.get(m[1])
    if (!f) return false
    res.writeHead(200, { 'content-type': f.mime, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}` })
    res.end(f.bytes)
    return true
  }
  void url
  return false
}
