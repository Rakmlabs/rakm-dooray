// 모의 서버 — 채팅 파일 뷰어·업로드·캐시 영역 경로. 이 영역 작업자만 고친다.
// 처리했으면 true 를 돌려준다. ctx: { req, res, url, p, send, ok, body, state }
// state 에는 mock-dooray.mjs 의 공용 데이터(members, channels, logs, wikis, wikiPages, comments, ME, log, iso)가 들어 있다.
//
// 실제 두레이는 파일 다운로드·업로드가 307 로 file-api.dooray.com 을 가리키지만(http.ts 가 직접 따라감),
// 모의 서버는 바로 200 으로 응답한다. 샘플 파일은 scripts/mock/fixtures/ (make.py, make-hwp.mjs 로 만든다).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

/** fileId → { name, mime, path? | bytes? } */
const files = new Map()

// [fileId, 파일 이름, mime, 보낸 사람, 몇 ms 전]
const SAMPLES = [
  ['f-img1', '사무실_화이트보드.jpg', 'image/jpeg', 'm-co', 55_000],
  ['f-img2', '제품_목업.png', 'image/png', 'm-dev', 52_000],
  ['f-img3', '행사_현수막.jpg', 'image/jpeg', 'm-co', 50_000],
  ['f-mp4', '시연영상.mp4', 'video/mp4', 'm-dev', 47_000],
  ['f-mp3', '회의녹음.mp3', 'audio/mpeg', 'm-co', 45_000],
  ['f-docx', '회의록_0301.docx', null, 'm-co', 42_000],
  ['f-xlsx', '릴리스_예산.xlsx', null, 'm-dev', 40_000],
  ['f-pptx', '데모데이_발표.pptx', null, 'm-co', 38_000],
  ['f-hwp', '주간보고.hwp', null, 'm-dev', 36_000],
  ['f-hwpx', '투자제안서.hwpx', null, 'm-co', 34_000],
  ['f-txt', '메모.txt', 'text/plain', 'm-me', 32_000],
  ['f-md', 'README.md', null, 'm-dev', 30_000],
  ['f-csv', '고객목록.csv', 'text/csv', 'm-co', 28_000],
  ['f-json', 'config.json', 'application/json', 'm-dev', 26_000],
  ['f-ts', 'server.ts', null, 'm-dev', 24_000],
  ['f-zip', '압축본.zip', 'application/zip', 'm-co', 22_000],
  ['f-img4', 'screenshot.png', 'image/png', 'm-me', 20_000]
]

files.set('f1', { name: '사업계획서_v3.pdf', mime: 'application/pdf', path: join(FIXTURES, '사업계획서_v3.pdf') })
for (const [id, name, mime] of SAMPLES) files.set(id, { name, mime: mime ?? 'application/octet-stream', path: join(FIXTURES, name) })

// 카톡처럼 연달아 보낸 사진 묶음 (앨범 표시 확인용): 같은 사진 파일을 다른 id 로 7장
const ALBUM = ['사무실_화이트보드.jpg', '제품_목업.png', '행사_현수막.jpg', 'screenshot.png', '사무실_화이트보드.jpg', '제품_목업.png', '행사_현수막.jpg']
ALBUM.forEach((name, i) => files.set(`f-alb${i + 1}`, { name: `워크숍_${i + 1}.${name.split('.').pop()}`, mime: name.endsWith('png') ? 'image/png' : 'image/jpeg', path: join(FIXTURES, name) }))

const UPLOAD_DELAY_MS = Number(process.env.MOCK_UPLOAD_DELAY_MS || 0)
const UPLOAD_FAIL_EVERY = Number(process.env.MOCK_UPLOAD_FAIL_EVERY || 0)
let uploadCount = 0

let seeded = false
function seed(state) {
  if (seeded) return
  seeded = true
  const list = (state.logs['c-general'] ??= [])
  list.push(state.log('c-general', 'm-co', '자료 몇 개 올려요. 앱 안에서 바로 열리는지 봐 주세요', 58_000))
  for (const [id, name, mime, sender, ago] of SAMPLES) {
    const size = fileBytes(files.get(id)).length
    // 실제 응답처럼 mimeType 이 없을 수도 있다 (null 이면 넣지 않는다)
    const file = { id, name, fileSize: size, ...(mime ? { mimeType: mime } : {}) }
    list.push({ ...state.log('c-general', sender === 'm-me' ? (state.BASE_ME ?? state.ME) : sender, '', ago), type: 'FILE', file })
  }
  list.push(state.log('c-general', 'm-co', '워크숍 사진 올립니다', 19_000))
  ALBUM.forEach((_, i) => {
    const id = `f-alb${i + 1}`
    const f = files.get(id)
    list.push({ ...state.log('c-general', 'm-co', '', 18_000 - i * 200), type: 'FILE', file: { id, name: f.name, fileSize: fileBytes(f).length, mimeType: f.mime } })
  })
}

function fileBytes(f) {
  if (!f.bytes) f.bytes = readFileSync(f.path)
  return f.bytes
}

export async function handle(ctx) {
  const { req, res, p, send, ok, state } = ctx
  seed(state)
  let m
  if ((m = p.match(/^\/messenger\/v1\/channels\/([^/]+)\/files\/([^/]+)$/)) && req.method === 'GET') {
    const f = files.get(decodeURIComponent(m[2]))
    if (!f) {
      send(404, { header: { isSuccessful: false, resultCode: -1, resultMessage: encodeURIComponent('파일을 찾을 수 없습니다') } })
      return true
    }
    const bytes = fileBytes(f)
    await new Promise((r) => setTimeout(r, 120)) // 로딩 표시를 볼 수 있게 살짝 늦춘다
    res.writeHead(200, {
      'content-type': f.mime,
      'content-length': bytes.length,
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`
    })
    res.end(bytes)
    return true
  }
  if ((m = p.match(/^\/messenger\/v1\/channels\/([^/]+)\/files$/)) && req.method === 'POST') {
    const channelId = decodeURIComponent(m[1])
    // 시험용: MOCK_UPLOAD_DELAY_MS 만큼 늦추고, MOCK_UPLOAD_FAIL_EVERY 번째마다 500 으로 실패 (자동 재시도·다시 보내기 확인)
    uploadCount++
    if (UPLOAD_DELAY_MS) await new Promise((r) => setTimeout(r, UPLOAD_DELAY_MS))
    if (UPLOAD_FAIL_EVERY && uploadCount % UPLOAD_FAIL_EVERY === 0) {
      for await (const _ of req) void _
      send(500, { header: { isSuccessful: false, resultCode: -1, resultMessage: encodeURIComponent('모의 업로드 실패') } })
      return true
    }
    const form = await new Request('http://mock/upload', {
      method: 'POST',
      headers: { 'content-type': req.headers['content-type'] ?? '' },
      body: Readable.toWeb(req),
      duplex: 'half'
    }).formData()
    const attach = form.get('attach')
    if (!attach || typeof attach === 'string') {
      send(400, { header: { isSuccessful: false, resultCode: -1, resultMessage: 'attach 없음' } })
      return true
    }
    const name = String(form.get('fileName') || attach.name || 'upload')
    const mime = String(form.get('mimeType') || attach.type || 'application/octet-stream')
    const bytes = Buffer.from(await attach.arrayBuffer())
    const id = `f-up-${Date.now()}-${files.size}`
    files.set(id, { name, mime, bytes })
    const l = { ...state.log(channelId, state.ME, '', 0), type: 'FILE', file: { id, name, fileSize: bytes.length, mimeType: mime } }
    ;(state.logs[channelId] ??= []).push(l)
    const c = state.channels.find((x) => x.id === channelId)
    if (c) c.updatedAt = new Date().toISOString()
    console.log(`[mock] 업로드 ${channelId}: ${bytes.length} bytes`)
    send(200, ok({ id }))
    return true
  }
  return false
}
