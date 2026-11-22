// 개발용 두레이 모의 서버. 실제 토큰 없이 화면을 확인할 때 쓴다.
//   node scripts/mock-dooray.mjs            (기본 포트 8787)
//   DOORAY_MOCK_BASE=http://127.0.0.1:8787 npm run dev
// 응답 형태는 docs/API_RESEARCH.md 의 공식 문서·커뮤니티 실측 형태를 따른다. 실제 두레이와 다를 수 있다.
import { createServer } from 'node:http'
import * as wikiArea from './mock/wiki.mjs'
import * as filesArea from './mock/files.mjs'
import * as chatArea from './mock/chat.mjs'
import * as shellArea from './mock/shell.mjs'

const PORT = Number(process.env.PORT || 8787)
const ME = 'm-me'
const members = {
  'm-me': '나소유',
  'm-co': '김공동',
  'm-dev': '박개발'
}
const now = Date.now()
const iso = (msAgo) => new Date(now - msAgo).toISOString()
let seq = 100

function log(channelId, sender, text, msAgo, extra = {}) {
  return { id: String(++seq * 1000), seq, type: 'TEXT', sender: { type: 'member', member: { organizationMemberId: sender } }, sentAt: iso(msAgo), text, flags: null, ...extra, channelId }
}

const channels = [
  { id: 'c-general', title: '창업팀', type: 'private', members: [ME, 'm-co', 'm-dev'], updatedAt: iso(60_000) },
  { id: 'c-alpha', title: '알파 프로젝트', type: 'private', members: [ME, 'm-co'], updatedAt: iso(3_600_000) },
  { id: 'c-dm', title: '', type: 'direct', members: [ME, 'm-co'], updatedAt: iso(7_200_000) }
]

const logs = {
  'c-general': [
    log('c-general', 'm-co', '오늘 오후에 투자사 미팅 있어요', 86_400_000),
    log('c-general', ME, '네 2시에 같이 들어가요', 86_000_000),
    log('c-general', 'm-co', '[알파] 3월 릴리스 일정', 7_000_000, { thread: { channelId: 't-alpha', totalCount: '2', lastUpdatedAt: now - 600_000 } }),
    log('c-general', 'm-dev', '[베타] 결제 모듈 버그', 5_000_000, { thread: { channelId: 't-beta', totalCount: '1', lastUpdatedAt: now - 1_200_000 } }),
    log('c-general', 'm-dev', '점심 뭐 드실래요?', 300_000),
    log('c-general', 'm-dev', '배포 전에 `npm run typecheck` 먼저 돌려 주세요. 검사 스크립트는 이렇게 바꿨어요\n```ts\nexport async function preflight(env: Env): Promise<void> {\n  const missing = REQUIRED.filter((k) => !env[k])\n  if (missing.length) throw new Error(`빠진 값: ${missing.join(\', \')}`)\n  await run(\'npm\', [\'test\'])\n}\n```', 240_000),
    { ...log('c-general', 'm-co', '', 120_000), type: 'FILE', file: { id: 'f1', name: '사업계획서_v3.pdf', fileSize: 1_234_567 } },
    { ...log('c-general', ME, '{"type":0,"text":"확인했습니다 **감사합니다**"}', 60_000), type: 'REPLY' }
  ],
  'c-alpha': [log('c-alpha', 'm-co', '알파 회의록 위키에 올렸어요', 3_600_000)],
  'c-dm': [log('c-dm', 'm-co', '내일 출근하세요?', 7_200_000)],
  't-alpha': [log('t-alpha', 'm-co', '3/15 목표로 가죠', 900_000), log('t-alpha', ME, '좋아요. QA는 3/10부터', 600_000)],
  't-beta': [log('t-beta', 'm-dev', '재현 방법 정리했습니다', 1_200_000)]
}

const wikis = [
  { id: 'w1', name: '알파 프로젝트', type: 'project', scope: 'private', project: { id: 'pr1' }, home: { pageId: 'p1' } },
  { id: 'w2', name: '창업팀 공용', type: 'project', scope: 'private', project: { id: 'pr2' }, home: { pageId: 'q1' } },
  { id: 'w3', name: '베타 결제 모듈', type: 'project', scope: 'private', project: { id: 'pr3' }, home: { pageId: 'r1' } }
]
const page = (id, wikiId, parentPageId, subject, body) => ({ id, wikiId, parentPageId, subject, root: !parentPageId, version: '3', body })
const wikiPages = Object.fromEntries(
  [
    page('p1', 'w1', null, '알파 프로젝트 홈', '# 알파 프로젝트\n\n3월 릴리스를 목표로 하는 알파 프로젝트 위키입니다.\n\n## 이번 주 할 일\n\n- [x] 요구사항 정리\n- [ ] 릴리스 체크리스트 확정\n- [ ] QA 일정 공유\n\n## 링크\n\n- 회의록은 **회의록** 아래에 날짜별로 둡니다.\n- 설계 문서는 **설계** 아래에 둡니다.\n\n```js\nconst release = new Date(\'2026-03-15\')\n```\n\n> 질문은 창업팀 대화방 `[알파]` 스레드로 남겨 주세요.'),
    page('p2', 'w1', 'p1', '회의록', '# 회의록\n\n날짜별 회의록 모음입니다.'),
    page('p21', 'w1', 'p2', '3월 1일 킥오프', '## 3월 1일\n\n| 항목 | 담당 | 기한 |\n|---|---|---|\n| 릴리스 범위 | 김공동 | 3/3 |\n| QA 계획 | 박개발 | 3/8 |'),
    page('p22', 'w1', 'p2', '3월 8일 점검', '## 3월 8일\n\n- QA 3/10 시작 확정'),
    page('p3', 'w1', 'p1', '설계', '# 설계\n\n아키텍처와 API 설계.'),
    page('p31', 'w1', 'p3', 'API 명세', '## API 명세\n\n`GET /v1/items`'),
    page('p4', 'w1', 'p1', '릴리스 체크리스트', '- [ ] 버전 태그\n- [ ] 공지'),
    page('q1', 'w2', null, '창업팀 공용 홈', '# 창업팀 공용\n\n공용 문서와 규칙.'),
    page('q2', 'w2', 'q1', '온보딩', '# 온보딩\n\n첫 주에 할 일.'),
    page('r1', 'w3', null, '베타 결제 모듈', '# 베타 결제 모듈\n\n결제 연동 문서.')
  ].map((x) => [x.id, x])
)
const comments = { p1: [{ id: 'cm1', creator: { member: { organizationMemberId: 'm-co' } }, createdAt: iso(500_000), body: { content: '체크리스트 업데이트했어요' } }] }

const ok = (result, extra = {}) => ({ header: { isSuccessful: true, resultCode: 0, resultMessage: '' }, result, ...extra })

function rawChannel(c, actor = ME) {
  return {
    id: c.id,
    title: c.title,
    type: c.type,
    status: 'normal',
    updatedAt: c.updatedAt,
    users: { participants: c.members.map((m) => ({ type: 'member', member: { organizationMemberId: m } })) },
    me: { type: 'member', member: { organizationMemberId: actor }, role: 'member' }
  }
}

async function body(req) {
  let s = ''
  for await (const chunk of req) s += chunk
  try {
    return JSON.parse(s || '{}')
  } catch {
    return {}
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const p = url.pathname
  const send = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json' })
    res.end(JSON.stringify(obj))
  }
  // 두 번째 사용자(김공동)로 쓰려면 토큰 'mock-token-co' (읽음 확인을 두 앱으로 시험할 때)
  const USERS = { 'dooray-api mock-token': ME, 'dooray-api mock-token-co': 'm-co' }
  const actor = USERS[req.headers.authorization]
  if (!actor) return send(401, { header: { isSuccessful: false, resultCode: -1, resultMessage: '인증 실패' } })
  const state = { members, channels, logs, wikis, wikiPages, comments, ME: actor, BASE_ME: ME, log, iso, now }
  // 영역별 경로가 먼저 (각 영역 작업자가 scripts/mock/*.mjs 에서만 고친다)
  for (const area of [wikiArea, filesArea, chatArea, shellArea]) {
    if (await area.handle({ req, res, url, p, send, ok, body, state })) return
  }
  let m
  if (p === '/common/v1/members/me') return send(200, ok({ id: actor, name: members[actor] }))
  if ((m = p.match(/^\/common\/v1\/members\/([^/]+)$/))) return send(200, ok({ id: m[1], name: members[m[1]] ?? m[1] }))
  if (p === '/common/v1/members') return send(200, ok(Object.entries(members).filter(([, n]) => n.includes(url.searchParams.get('name') ?? '')).map(([id, name]) => ({ id, name, externalEmailAddress: `${id}@example.com` }))))
  if (p === '/common/v1/socket-mode/tokens') return send(403, { header: { isSuccessful: false, resultCode: -1, resultMessage: '에이전트 토큰 전용 (모의)' } })
  if (p === '/messenger/v1/channels' && req.method === 'GET') {
    const mine = channels.filter((c) => c.members.includes(actor))
    return send(200, ok(mine.map((c) => rawChannel(c, actor)), { totalCount: mine.length }))
  }
  if ((m = p.match(/^\/messenger\/v1\/channels\/([^/]+)\/logs$/))) {
    const id = m[1]
    if (req.method === 'GET') {
      const size = Number(url.searchParams.get('size') || 50)
      return send(200, { header: { isSuccessful: true, resultCode: 0, resultMessage: null }, result: (logs[id] ?? []).slice(-size).reverse() })
    }
    const b = await body(req)
    const l = log(id, actor, b.text, 0)
    ;(logs[id] ??= []).push(l)
    const c = channels.find((x) => x.id === id)
    if (c) c.updatedAt = new Date().toISOString()
    return send(200, ok({ id: l.id, channelId: id }))
  }
  if ((m = p.match(/^\/messenger\/v1\/channels\/([^/]+)\/threads\/create-and-send$/))) {
    const b = await body(req)
    const tid = `t-${Date.now()}`
    logs[tid] = b.threadText ? [log(tid, actor, b.threadText, 0)] : []
    ;(logs[m[1]] ??= []).push(log(m[1], actor, b.text, 0, { thread: { channelId: tid, totalCount: String(logs[tid].length), lastUpdatedAt: Date.now() } }))
    return send(200, ok({ id: 'x', channelId: tid }))
  }
  if ((m = p.match(/^\/messenger\/v1\/channels\/([^/]+)\/logs\/([^/]+)$/))) {
    const list = logs[m[1]] ?? []
    const i = list.findIndex((l) => l.id === m[2])
    // 실제 두레이처럼 조직 설정 "메시지 삭제 가능 시간"(기본 5분)이 지나면 거절한다 (두레이 웹 번들의 CHANNEL_LOG_EXPIRED_DELETE_TIME_ERROR)
    if (req.method === 'DELETE' && i >= 0 && Date.now() - Date.parse(list[i].sentAt) > 5 * 60_000) {
      return send(400, { header: { isSuccessful: false, resultCode: -300107, resultMessage: encodeURIComponent('작성 후, 5분 이내에만 삭제할 수 있습니다.') }, result: null })
    }
    if (req.method === 'DELETE' && i >= 0) list.splice(i, 1)
    if (req.method === 'PUT' && i >= 0) list[i].text = (await body(req)).text
    return send(200, ok(null))
  }
  if ((m = p.match(/^\/messenger\/v1\/channels\/([^/]+)\/logs\/([^/]+)\/reply$/))) {
    const b = await body(req)
    ;(logs[m[1]] ??= []).push({ ...log(m[1], actor, JSON.stringify({ type: 0, text: b.text }), 0), type: 'REPLY' })
    return send(200, ok({ id: 'r', channelId: m[1] }))
  }
  if (p === '/wiki/v1/wikis') return send(200, ok(wikis, { totalCount: wikis.length }))
  if ((m = p.match(/^\/wiki\/v1\/wikis\/([^/]+)\/pages$/)) && req.method === 'GET') {
    const parent = url.searchParams.get('parentPageId')
    return send(200, ok(Object.values(wikiPages).filter((x) => x.wikiId === m[1] && (parent ? x.parentPageId === parent : x.root)).map(({ body: _b, ...rest }) => rest)))
  }
  // 공식 단건 조회 (위키 ID 없이)
  if ((m = p.match(/^\/wiki\/v1\/pages\/([^/]+)$/)) && req.method === 'GET') {
    const pg = wikiPages[m[1]]
    if (!pg) return send(404, { header: { isSuccessful: false, resultCode: -1, resultMessage: encodeURIComponent('존재하지 않는 페이지입니다') } })
    return send(200, ok({ ...pg, body: { mimeType: 'text/x-markdown', content: pg.body }, createdAt: iso(9e6), updatedAt: iso(3e6), creator: { member: { organizationMemberId: 'm-co' } }, files: pg.id === 'p1' ? [{ id: 'wf1', name: '릴리스일정.xlsx', size: 5167 }] : [], images: [] }))
  }
  // 실사용에서 실패했던 경로를 흉내 낸다 (URL 인코딩된 오류 메시지)
  if ((m = p.match(/^\/wiki\/v1\/wikis\/([^/]+)\/pages\/([^/]+)$/)) && req.method === 'GET') {
    return send(404, { header: { isSuccessful: false, resultCode: -100, resultMessage: encodeURIComponent('존재하지 않는 페이지입니다') } })
  }
  if ((m = p.match(/^\/wiki\/v1\/wikis\/[^/]+\/pages\/([^/]+)\/(title|content)$/))) {
    const b = await body(req)
    if (m[2] === 'title') wikiPages[m[1]].subject = b.subject
    else wikiPages[m[1]].body = b.body.content
    return send(200, ok(null))
  }
  // 페이지 만들기 (읽음 확인 저장 페이지 등)
  if ((m = p.match(/^\/wiki\/v1\/wikis\/([^/]+)\/pages$/)) && req.method === 'POST') {
    const b = await body(req)
    const id = `np${Date.now()}${Math.floor(Math.random() * 1000)}`
    wikiPages[id] = { ...page(id, m[1], b.parentPageId ?? null, b.subject ?? '', b.body?.content ?? ''), creator: actor }
    return send(200, ok({ id }))
  }
  if ((m = p.match(/^\/wiki\/v1\/wikis\/[^/]+\/pages\/([^/]+)\/comments$/))) {
    if (req.method === 'GET') return send(200, ok(comments[m[1]] ?? []))
    const b = await body(req)
    ;(comments[m[1]] ??= []).push({ id: `cm${Date.now()}`, creator: { member: { organizationMemberId: actor } }, createdAt: new Date().toISOString(), body: b.body })
    return send(201, ok({ id: 'x' }))
  }
  send(404, { header: { isSuccessful: false, resultCode: -1, resultMessage: `모의 서버에 없는 경로: ${req.method} ${p}` } })
}).listen(PORT, '127.0.0.1', () => console.log(`mock dooray on http://127.0.0.1:${PORT}`))
