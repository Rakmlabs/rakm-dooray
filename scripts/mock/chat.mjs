// 모의 서버 — 메시지 표시·프로필·입력 편의 영역 경로. 이 영역 작업자만 고친다.
// 처리했으면 true 를 돌려준다. ctx: { req, res, url, p, send, ok, body, state }
// state 에는 mock-dooray.mjs 의 공용 데이터(members, channels, logs, wikis, wikiPages, comments, ME, log, iso)가 들어 있다.
//
// 링크 미리보기 확인용 페이지는 본 모의 서버(인증 헤더 필수)와 따로 PORT+1000 에서 인증 없이 준다.
// 앱은 개발 모드 + DOORAY_MOCK_BASE 일 때만 그 두 포트(127.0.0.1)를 사설 주소 차단의 예외로 둔다 (src/main/handlers/chat.ts).
import { createServer } from 'node:http'
import { deflateSync, crc32 } from 'node:zlib'

const PORT = Number(process.env.PORT || 8787)
const OG_PORT = PORT + 1000
const ORG = '1708537451674140147'

// 공식 GET /common/v1/members/{id} 응답 형태 (사진·부서·직책 필드는 없다)
const DETAILS = {
  'm-me': { userCode: 'owner', email: 'owner@rakm.example', englishName: 'Na Soyu', nickname: '' },
  'm-co': { userCode: 'cofounder', email: 'cofounder@rakm.example', englishName: 'Kim Gongdong', nickname: '공동대표' },
  'm-dev': { userCode: 'dev', email: 'dev@rakm.example', englishName: 'Park Gaebal', nickname: '' },
  'm-design': { userCode: 'design', email: 'design@partner.example', englishName: 'Lee Dija', nickname: '외주 디자이너' }
}

function memberDetail(state, id) {
  const d = DETAILS[id] ?? {}
  return {
    id,
    idProviderType: 'service',
    idProviderUserId: '',
    name: state.members[id] ?? id,
    userCode: d.userCode ?? id,
    externalEmailAddress: d.email ?? `${id}@rakm.example`,
    defaultOrganization: { id: ORG },
    locale: 'ko_KR',
    timezoneName: 'Asia/Seoul',
    englishName: d.englishName ?? '',
    nativeName: state.members[id] ?? '',
    nickname: d.nickname ?? '',
    displayMemberId: d.userCode ?? id
  }
}

const mention = (name, id) => `[@${name}](dooray://${ORG}/members/${id} "member")`

let seeded = false
function seed(state) {
  if (seeded) return
  seeded = true
  const { logs, log, ME, members } = state
  members['m-design'] = '이디자'
  const min = 60_000
  const extra = [
    log('c-general', 'm-co', '자료 정리하면서 본 글인데 참고해 주세요', 50 * min),
    log('c-general', 'm-co', `http://127.0.0.1:${OG_PORT}/og/launch`, 49.5 * min),
    log('c-general', 'm-co', `${mention('박개발', 'm-dev')} 이 부분은 결제 모듈 쪽이랑 겹칠 것 같아요`, 49 * min),
    log(
      'c-general',
      'm-dev',
      '네 확인했습니다. 재시도 로직은 이렇게 바꿔 볼게요\n\n```ts\nasync function retry<T>(fn: () => Promise<T>, times = 3): Promise<T> {\n  for (let i = 0; i < times; i++) {\n    try {\n      return await fn()\n    } catch (e) {\n      if (i === times - 1) throw e\n      await sleep(2 ** i * 500) // 지수 백오프\n    }\n  }\n  throw new Error("unreachable")\n}\n```',
      40 * min
    ),
    log('c-general', 'm-dev', '`sleep` 은 utils 에 있는 거 씁니다', 39 * min),
    log('c-general', ME, `좋아요 ${mention('김공동', 'm-co')} 내일 오전에 같이 보죠. 체크리스트는 **위키**에 올려 둘게요`, 20 * min),
    log('c-general', 'm-co', '넵 👍', 19.5 * min)
  ]
  logs['c-general'].push(...extra)
  // 시간순으로 다시 정렬하고 seq 를 다시 매긴다 (앱은 seq 로 정렬한다)
  logs['c-general'].sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt))
  logs['c-general'].forEach((l, i) => (l.seq = 1 + i))
}

// ---------- 링크 미리보기용 로컬 페이지 ----------

function png(w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td) >>> 0)
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const rows = []
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3)
    for (let x = 0; x < w; x++) {
      const t = (x + y) / (w + h)
      row[1 + x * 3] = Math.round(47 + 60 * t)
      row[2 + x * 3] = Math.round(107 + 90 * t)
      row[3 + x * 3] = 255
      if ((x - w / 2) ** 2 + (y - h / 2) ** 2 < (w / 5) ** 2) row.fill(255, 1 + x * 3, 4 + x * 3)
    }
    rows.push(row)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const OG_HTML = `<!doctype html><html><head><meta charset="utf-8">
<title>예비 창업자를 위한 출시 체크리스트</title>
<meta property="og:site_name" content="스타트업 노트">
<meta property="og:title" content="작은 팀이 첫 출시 전에 꼭 점검할 12가지">
<meta property="og:description" content="결제·로그·백업·문의 창구까지, 두 사람이 나눠 맡기 좋은 출시 전 점검 목록과 실제 사례를 정리했습니다.">
<meta property="og:image" content="/og/image.png">
</head><body><h1>출시 체크리스트</h1></body></html>`

try {
  createServer((req, res) => {
    const p = new URL(req.url, `http://127.0.0.1:${OG_PORT}`).pathname
    if (p === '/og/launch') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      return res.end(OG_HTML)
    }
    if (p === '/og/image.png') {
      res.writeHead(200, { 'content-type': 'image/png' })
      return res.end(png(120, 120))
    }
    if (p === '/og/redirect') {
      res.writeHead(302, { location: '/og/launch' })
      return res.end()
    }
    // 리다이렉트로 내부 주소에 가려는 경우 (앱이 막아야 한다)
    if (p === '/og/to-private') {
      res.writeHead(302, { location: 'http://10.0.0.1/' })
      return res.end()
    }
    res.writeHead(404)
    res.end()
  })
    .on('error', (e) => console.error(`[mock/chat] 미리보기 서버 실패: ${e.message}`))
    .listen(OG_PORT, '127.0.0.1', () => console.log(`mock link-preview pages on http://127.0.0.1:${OG_PORT}/og/launch`))
} catch (e) {
  console.error(`[mock/chat] 미리보기 서버 실패: ${e.message}`)
}

export async function handle(ctx) {
  const { req, p, send, ok, body, state } = ctx
  seed(state)
  let m
  if (p === '/common/v1/members/me' && req.method === 'GET') return send(200, ok(memberDetail(state, state.ME))), true
  if ((m = p.match(/^\/common\/v1\/members\/([^/]+)$/)) && req.method === 'GET') {
    if (!state.members[m[1]]) return send(404, { header: { isSuccessful: false, resultCode: -1, resultMessage: '없는 멤버' } }), true
    return send(200, ok(memberDetail(state, m[1]))), true
  }
  // 기존 메시지에 스레드 만들기 (공식 POST .../logs/{logId}/threads/create-and-send)
  if ((m = p.match(/^\/messenger\/v1\/channels\/([^/]+)\/logs\/([^/]+)\/threads\/create-and-send$/)) && req.method === 'POST') {
    const b = await body(req)
    const list = state.logs[m[1]] ?? []
    const root = list.find((l) => l.id === m[2])
    if (!root) return send(404, { header: { isSuccessful: false, resultCode: -1, resultMessage: '없는 메시지' } }), true
    const tid = `t-${Date.now()}`
    state.logs[tid] = [state.log(tid, state.ME, b.text ?? '', 0)]
    root.thread = { channelId: tid, totalCount: '1', lastUpdatedAt: Date.now() }
    return send(200, ok({ id: state.logs[tid][0].id, channelId: tid })), true
  }
  // 답장: 응답에 새 메시지 ID 를 준다 (기본 모의 경로는 고정값 'r' 을 줘서 답장 인용 확인이 안 된다)
  if ((m = p.match(/^\/messenger\/v1\/channels\/([^/]+)\/logs\/([^/]+)\/reply$/)) && req.method === 'POST') {
    const b = await body(req)
    const l = { ...state.log(m[1], state.ME, JSON.stringify({ type: 0, text: b.text }), 0), type: 'REPLY' }
    ;(state.logs[m[1]] ??= []).push(l)
    return send(200, ok({ id: l.id, channelId: m[1] })), true
  }
  return false
}
