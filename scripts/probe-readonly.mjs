// 읽기 전용 실호출 점검. .env 의 토큰·메일 계정으로 "읽기" 호출만 해 보고 결과의 형태와 개수만 출력한다.
// 메시지 본문·메일 제목 같은 내용은 출력하지 않는다. 토큰·비밀번호도 출력하지 않는다.
//   npm run probe              두레이 API + IMAP 점검
//   npm run probe -- --socket  Socket Mode 토큰 발급(POST, 콘텐츠를 바꾸지 않음)까지 시도
import { readFileSync, existsSync } from 'node:fs'
import { ImapFlow } from 'imapflow'
import nodemailer from 'nodemailer'

const env = {}
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m && m[2]) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
const BASE = 'https://api.dooray.com' // 앱과 같이 고정
const TOKEN = env.DOORAY_TOKEN
const results = []
const report = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function get(path) {
  const res = await fetch(BASE + path, { headers: { Authorization: `dooray-api ${TOKEN}` } })
  let body = null
  try {
    body = await res.json()
  } catch {
    /* 무시 */
  }
  return { status: res.status, body, rate: res.headers.get('x-ratelimit-remaining') }
}

const keys = (o) => (o && typeof o === 'object' ? Object.keys(o).sort().join(',') : String(o))

if (!TOKEN) {
  console.log('DOORAY_TOKEN 이 .env 에 없어 두레이 API 점검을 건너뜁니다.')
} else {
  const me = await get('/common/v1/members/me')
  report('GET /common/v1/members/me', me.status === 200 && me.body?.header?.isSuccessful, `HTTP ${me.status}, rate-remaining=${me.rate}`)

  const ch = await get('/messenger/v1/channels')
  const list = ch.body?.result ?? []
  const byType = list.reduce((a, c) => ((a[c.type] = (a[c.type] ?? 0) + 1), a), {})
  report('GET /messenger/v1/channels', ch.status === 200, `HTTP ${ch.status}, ${list.length}개, 종류별 ${JSON.stringify(byType)}`)

  for (const type of ['direct', 'private']) {
    const c = list.find((x) => x.type === type && x.status !== 'deleted')
    if (!c) {
      report(`GET .../logs (${type})`, false, '해당 종류의 대화방이 없음')
      continue
    }
    const logs = await get(`/messenger/v1/channels/${c.id}/logs?size=20`)
    const items = logs.body?.result ?? []
    const withThread = items.filter((m) => m.thread).length
    report(
      `GET /messenger/v1/channels/{id}/logs (${type}, 비공식)`,
      logs.status === 200 && Array.isArray(logs.body?.result),
      `HTTP ${logs.status}, ${items.length}개, 스레드 달린 메시지 ${withThread}개, 필드: ${keys(items[0])}`
    )
    const t = items.find((m) => m.thread?.channelId)
    if (t) {
      const tl = await get(`/messenger/v1/channels/${t.thread.channelId}/logs?size=5`)
      report('GET 스레드 채널 logs (비공식)', tl.status === 200, `HTTP ${tl.status}, ${(tl.body?.result ?? []).length}개`)
    }
  }

  const wikis = await get('/wiki/v1/wikis?page=0&size=20')
  const w = wikis.body?.result?.[0]
  report('GET /wiki/v1/wikis', wikis.status === 200, `HTTP ${wikis.status}, ${wikis.body?.totalCount ?? '?'}개`)
  if (w) {
    const pages = await get(`/wiki/v1/wikis/${w.id}/pages`)
    report('GET /wiki/v1/wikis/{id}/pages', pages.status === 200, `HTTP ${pages.status}, 최상위 ${(pages.body?.result ?? []).length}개`)
    const p = pages.body?.result?.[0]
    if (p) {
      // 앱이 쓰는 공식 단건 조회. 응답 원문에서 ID 가 따옴표 없는 숫자로 오는지도 본다 (19자리면 JS 정밀도를 넘는다).
      const page = await get(`/wiki/v1/pages/${p.id}`)
      report('GET /wiki/v1/pages/{pageId}', page.status === 200, `HTTP ${page.status}, mimeType=${page.body?.result?.body?.mimeType}, wikiId 일치=${String(page.body?.result?.wikiId) === String(w.id)}`)
      const raw = await (await fetch(`${BASE}/wiki/v1/wikis/${w.id}/pages`, { headers: { Authorization: `dooray-api ${TOKEN}` } })).text()
      report('페이지 목록 ID 형식', true, /"id"\s*:\s*\d{16,}/.test(raw) ? '숫자(정밀도 손실 위험)' : '문자열')
      const old = await get(`/wiki/v1/wikis/${w.id}/pages/${p.id}`)
      report('(참고) GET /wiki/v1/wikis/{id}/pages/{id}', true, `HTTP ${old.status}`)
      const cm = await get(`/wiki/v1/wikis/${page.body?.result?.wikiId ?? w.id}/pages/${p.id}/comments?page=0&size=5`)
      report('GET 위키 페이지 댓글', cm.status === 200, `HTTP ${cm.status}, ${(cm.body?.result ?? []).length}개`)
    }
  }

  if (process.argv.includes('--socket')) {
    const res = await fetch(BASE + '/common/v1/socket-mode/tokens', { method: 'POST', headers: { Authorization: `dooray-api ${TOKEN}` } })
    let b = null
    try {
      b = await res.json()
    } catch {
      /* 무시 */
    }
    report('POST /common/v1/socket-mode/tokens (개인 토큰)', res.status === 200 && b?.header?.isSuccessful, `HTTP ${res.status} ${b?.header?.resultMessage ?? ''}`)
  }
}

if (!env.MAIL_ADDRESS || !env.MAIL_PASSWORD) {
  console.log('MAIL_ADDRESS / MAIL_PASSWORD 가 .env 에 없어 메일 점검을 건너뜁니다.')
} else {
  const imapPort = Number(env.MAIL_IMAP_PORT || 993)
  const client = new ImapFlow({
    host: env.MAIL_IMAP_HOST || 'imap.dooray.com',
    port: imapPort,
    secure: imapPort === 993,
    auth: { user: env.MAIL_ADDRESS, pass: env.MAIL_PASSWORD },
    logger: false
  })
  try {
    await client.connect()
    const folders = await client.list()
    const lock = await client.getMailboxLock('INBOX')
    const exists = client.mailbox ? client.mailbox.exists : 0
    lock.release()
    await client.logout()
    report('IMAP 로그인 + 폴더 목록', true, `폴더 ${folders.length}개, 받은편지함 ${exists}통`)
  } catch (e) {
    report('IMAP 로그인', false, e.message)
  }
  const smtpPort = Number(env.MAIL_SMTP_PORT || 465)
  try {
    await nodemailer
      .createTransport({ host: env.MAIL_SMTP_HOST || 'smtp.dooray.com', port: smtpPort, secure: smtpPort === 465, auth: { user: env.MAIL_ADDRESS, pass: env.MAIL_PASSWORD } })
      .verify()
    report('SMTP 인증 (발송하지 않음)', true, '')
  } catch (e) {
    report('SMTP 인증', false, e.message)
  }
}

process.exitCode = results.some((r) => !r.ok) ? 1 : 0
