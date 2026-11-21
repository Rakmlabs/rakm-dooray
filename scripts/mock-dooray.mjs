// 개발용 두레이 모의 서버. 실제 토큰 없이 화면을 확인할 때 쓴다.
//   node scripts/mock-dooray.mjs            (기본 포트 8787)
//   DOORAY_MOCK_BASE=http://127.0.0.1:8787 npm run dev
// 응답 형태는 docs/API_RESEARCH.md 의 공식 문서·커뮤니티 실측 형태를 따른다. 실제 두레이와 다를 수 있다.
import { createServer } from 'node:http'

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
    { ...log('c-general', 'm-co', '', 120_000), type: 'FILE', file: { id: 'f1', name: '사업계획서_v3.pdf', fileSize: 1_234_567 } },
    { ...log('c-general', ME, '{"type":0,"text":"확인했습니다 **감사합니다**"}', 60_000), type: 'REPLY' }
  ],
  'c-alpha': [log('c-alpha', 'm-co', '알파 회의록 위키에 올렸어요', 3_600_000)],
  'c-dm': [log('c-dm', 'm-co', '내일 출근하세요?', 7_200_000)],
  't-alpha': [log('t-alpha', 'm-co', '3/15 목표로 가죠', 900_000), log('t-alpha', ME, '좋아요. QA는 3/10부터', 600_000)],
  't-beta': [log('t-beta', 'm-dev', '재현 방법 정리했습니다', 1_200_000)]
}

const wikiPages = {
  p1: { id: 'p1', wikiId: 'w1', parentPageId: null, subject: '홈', root: true, version: '3', body: '# 알파 위키\n\n- [ ] 릴리스 체크리스트\n- 회의록은 하위 페이지에\n\n```js\nconsole.log("hi")\n```' },
  p2: { id: 'p2', wikiId: 'w1', parentPageId: 'p1', subject: '회의록 3월', root: false, version: '1', body: '## 3월 1일\n\n| 항목 | 담당 |\n|---|---|\n| 릴리스 | 김공동 |' }
}
const comments = { p1: [{ id: 'cm1', creator: { member: { organizationMemberId: 'm-co' } }, createdAt: iso(500_000), body: { content: '체크리스트 업데이트했어요' } }] }

const ok = (result, extra = {}) => ({ header: { isSuccessful: true, resultCode: 0, resultMessage: '' }, result, ...extra })

function rawChannel(c) {
  return {
    id: c.id,
    title: c.title,
    type: c.type,
    status: 'normal',
    updatedAt: c.updatedAt,
    users: { participants: c.members.map((m) => ({ type: 'member', member: { organizationMemberId: m } })) },
    me: { type: 'member', member: { organizationMemberId: ME }, role: 'member' }
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
  if (req.headers.authorization !== 'dooray-api mock-token') return send(401, { header: { isSuccessful: false, resultCode: -1, resultMessage: '인증 실패' } })
  let m
  if (p === '/common/v1/members/me') return send(200, ok({ id: ME, name: members[ME] }))
  if ((m = p.match(/^\/common\/v1\/members\/([^/]+)$/))) return send(200, ok({ id: m[1], name: members[m[1]] ?? m[1] }))
  if (p === '/common/v1/members') return send(200, ok(Object.entries(members).filter(([, n]) => n.includes(url.searchParams.get('name') ?? '')).map(([id, name]) => ({ id, name, externalEmailAddress: `${id}@example.com` }))))
  if (p === '/common/v1/socket-mode/tokens') return send(403, { header: { isSuccessful: false, resultCode: -1, resultMessage: '에이전트 토큰 전용 (모의)' } })
  if (p === '/messenger/v1/channels' && req.method === 'GET') return send(200, ok(channels.map(rawChannel), { totalCount: channels.length }))
  if ((m = p.match(/^\/messenger\/v1\/channels\/([^/]+)\/logs$/))) {
    const id = m[1]
    if (req.method === 'GET') {
      const size = Number(url.searchParams.get('size') || 50)
      return send(200, { header: { isSuccessful: true, resultCode: 0, resultMessage: null }, result: (logs[id] ?? []).slice(-size).reverse() })
    }
    const b = await body(req)
    const l = log(id, ME, b.text, 0)
    ;(logs[id] ??= []).push(l)
    const c = channels.find((x) => x.id === id)
    if (c) c.updatedAt = new Date().toISOString()
    return send(200, ok({ id: l.id, channelId: id }))
  }
  if ((m = p.match(/^\/messenger\/v1\/channels\/([^/]+)\/threads\/create-and-send$/))) {
    const b = await body(req)
    const tid = `t-${Date.now()}`
    logs[tid] = b.threadText ? [log(tid, ME, b.threadText, 0)] : []
    ;(logs[m[1]] ??= []).push(log(m[1], ME, b.text, 0, { thread: { channelId: tid, totalCount: String(logs[tid].length), lastUpdatedAt: Date.now() } }))
    return send(200, ok({ id: 'x', channelId: tid }))
  }
  if ((m = p.match(/^\/messenger\/v1\/channels\/([^/]+)\/logs\/([^/]+)$/))) {
    const list = logs[m[1]] ?? []
    const i = list.findIndex((l) => l.id === m[2])
    if (req.method === 'DELETE' && i >= 0) list.splice(i, 1)
    if (req.method === 'PUT' && i >= 0) list[i].text = (await body(req)).text
    return send(200, ok(null))
  }
  if ((m = p.match(/^\/messenger\/v1\/channels\/([^/]+)\/logs\/([^/]+)\/reply$/))) {
    const b = await body(req)
    ;(logs[m[1]] ??= []).push({ ...log(m[1], ME, JSON.stringify({ type: 0, text: b.text }), 0), type: 'REPLY' })
    return send(200, ok({ id: 'r', channelId: m[1] }))
  }
  if (p === '/wiki/v1/wikis') return send(200, ok([{ id: 'w1', name: '알파 위키', type: 'project', scope: 'private', project: { id: 'pr1' }, home: { pageId: 'p1' } }], { totalCount: 1 }))
  if (p === '/wiki/v1/wikis/w1/pages' && req.method === 'GET') {
    const parent = url.searchParams.get('parentPageId')
    return send(200, ok(Object.values(wikiPages).filter((x) => (parent ? x.parentPageId === parent : x.root))))
  }
  if ((m = p.match(/^\/wiki\/v1\/wikis\/w1\/pages\/([^/]+)$/)) && req.method === 'GET') {
    const pg = wikiPages[m[1]]
    if (!pg) return send(404, { header: { isSuccessful: false, resultCode: -1, resultMessage: '없음' } })
    return send(200, ok({ ...pg, body: { mimeType: 'text/x-markdown', content: pg.body }, createdAt: iso(9e6), updatedAt: iso(3e6), creator: { member: { organizationMemberId: 'm-co' } }, files: [{ id: 'wf1', name: '첨부.xlsx', size: 5167 }], images: [] }))
  }
  if ((m = p.match(/^\/wiki\/v1\/wikis\/w1\/pages\/([^/]+)\/(title|content)$/))) {
    const b = await body(req)
    if (m[2] === 'title') wikiPages[m[1]].subject = b.subject
    else wikiPages[m[1]].body = b.body.content
    return send(200, ok(null))
  }
  if ((m = p.match(/^\/wiki\/v1\/wikis\/w1\/pages\/([^/]+)\/comments$/))) {
    if (req.method === 'GET') return send(200, ok(comments[m[1]] ?? []))
    const b = await body(req)
    ;(comments[m[1]] ??= []).push({ id: `cm${Date.now()}`, creator: { member: { organizationMemberId: ME } }, createdAt: new Date().toISOString(), body: b.body })
    return send(201, ok({ id: 'x' }))
  }
  send(404, { header: { isSuccessful: false, resultCode: -1, resultMessage: `모의 서버에 없는 경로: ${req.method} ${p}` } })
}).listen(PORT, '127.0.0.1', () => console.log(`mock dooray on http://127.0.0.1:${PORT}`))
