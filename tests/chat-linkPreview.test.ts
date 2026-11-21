import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkUrl, decodeEntities, fetchLinkPreview, isBlockedIp, parseMeta } from '../src/main/chat/linkPreview'

describe('링크 미리보기 — 내부 주소 차단', () => {
  it('사설·루프백·링크로컬·메타데이터 주소를 막는다', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '224.0.0.1'])
      expect(isBlockedIp(ip), ip).toBe(true)
  })
  it('공인 주소는 통과', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111']) expect(isBlockedIp(ip), ip).toBe(false)
  })
  it('URL 검사: http(s) 만, 자격 증명·localhost·점 없는 이름·내부 IP 리터럴 금지', () => {
    expect(checkUrl('https://example.com/a')).not.toBeNull()
    expect(checkUrl('ftp://example.com')).toBeNull()
    expect(checkUrl('file:///etc/passwd')).toBeNull()
    expect(checkUrl('http://user:pw@example.com')).toBeNull()
    expect(checkUrl('http://localhost:3000')).toBeNull()
    expect(checkUrl('http://intranet/')).toBeNull()
    expect(checkUrl('http://127.0.0.1:8080/')).toBeNull()
    expect(checkUrl('http://[::1]/')).toBeNull()
    expect(checkUrl('http://2130706433/')).toBeNull() // 정수 표기 127.0.0.1 → URL 이 127.0.0.1 로 바꾼다
    expect(checkUrl('http://127.0.0.1:8813/x', ['127.0.0.1:8813'])).not.toBeNull()
    expect(checkUrl('http://127.0.0.1:9999/x', ['127.0.0.1:8813'])).toBeNull()
  })
})

describe('링크 미리보기 — HTML 해석', () => {
  it('og 태그를 우선, 없으면 title/description', () => {
    const m = parseMeta(`<html><head><title>제목 &amp; 부제</title>
      <meta name="description" content="설명입니다">
      <meta content="OG 제목" property="og:title">
      <meta property='og:image' content='/img.png'></head></html>`)
    expect(m.title).toBe('OG 제목')
    expect(m.description).toBe('설명입니다')
    expect(m.image).toBe('/img.png')
    expect(parseMeta('<title>그냥 &#54620;글</title>').title).toBe('그냥 한글')
  })
  it('엔티티 풀기', () => {
    expect(decodeEntities('&lt;a&gt; &quot;x&quot; &#x41;')).toBe('<a> "x" A')
  })
})

describe('링크 미리보기 — 실제 요청 (로컬 서버)', () => {
  let server: Server
  let host = ''
  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/page') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        return res.end('<meta property="og:title" content="안녕"><meta property="og:image" content="/i.png"><meta property="og:description" content="설명">')
      }
      if (req.url === '/i.png') {
        res.writeHead(200, { 'content-type': 'image/png' })
        return res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      }
      if (req.url === '/svg') {
        res.writeHead(200, { 'content-type': 'text/html' })
        return res.end('<meta property="og:title" content="t"><meta property="og:image" content="/x.svg">')
      }
      if (req.url === '/x.svg') {
        res.writeHead(200, { 'content-type': 'image/svg+xml' })
        return res.end('<svg/>')
      }
      if (req.url === '/redir') {
        res.writeHead(302, { location: '/page' })
        return res.end()
      }
      if (req.url === '/to-private') {
        res.writeHead(302, { location: 'http://10.0.0.1/' })
        return res.end()
      }
      if (req.url === '/big') {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.write('<meta property="og:title" content="큰 문서">')
        return res.end('x'.repeat(2 * 1024 * 1024))
      }
      if (req.url === '/cookie') {
        res.writeHead(200, { 'content-type': 'text/html' })
        return res.end(`<meta property="og:title" content="cookie=${req.headers.cookie ?? 'none'} auth=${req.headers.authorization ?? 'none'}">`)
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    host = `127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => new Promise<void>((r) => server.close(() => r())))

  it('허용 목록이 없으면 로컬 주소는 요청조차 하지 않는다', async () => {
    expect(await fetchLinkPreview(`http://${host}/page`)).toBeNull()
  })
  it('제목·설명·이미지(data URL)', async () => {
    const p = await fetchLinkPreview(`http://${host}/page`, { allowHosts: [host] })
    expect(p?.title).toBe('안녕')
    expect(p?.description).toBe('설명')
    expect(p?.image).toMatch(/^data:image\/png;base64,/)
  })
  it('SVG 이미지는 받지 않는다', async () => {
    const p = await fetchLinkPreview(`http://${host}/svg`, { allowHosts: [host] })
    expect(p?.title).toBe('t')
    expect(p?.image).toBeNull()
  })
  it('리다이렉트를 따라가되, 내부 주소로의 리다이렉트는 막는다', async () => {
    expect((await fetchLinkPreview(`http://${host}/redir`, { allowHosts: [host] }))?.title).toBe('안녕')
    expect(await fetchLinkPreview(`http://${host}/to-private`, { allowHosts: [host] })).toBeNull()
  })
  it('큰 응답은 잘라서 읽는다', async () => {
    expect((await fetchLinkPreview(`http://${host}/big`, { allowHosts: [host] }))?.title).toBe('큰 문서')
  })
  it('쿠키·인증 헤더를 보내지 않는다', async () => {
    expect((await fetchLinkPreview(`http://${host}/cookie`, { allowHosts: [host] }))?.title).toBe('cookie=none auth=none')
  })
})
