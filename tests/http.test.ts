import { describe, expect, it, vi } from 'vitest'
import { DoorayApiError, DoorayHttp, isTrustedRedirect, NotConfiguredError, parseContentDispositionFileName } from '../src/main/dooray/http'

const TOKEN = 'test-token-not-real'
const cfg = async () => ({ apiBase: 'https://api.dooray.com', token: TOKEN })

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

describe('isTrustedRedirect', () => {
  it('같은 두레이 도메인의 https 만 믿는다', () => {
    expect(isTrustedRedirect('https://file-api.dooray.com/uploads/x', 'https://api.dooray.com')).toBe(true)
    expect(isTrustedRedirect('https://evil.example.com/x', 'https://api.dooray.com')).toBe(false)
    expect(isTrustedRedirect('https://dooray.com.evil.com/x', 'https://api.dooray.com')).toBe(false)
    expect(isTrustedRedirect('http://file-api.dooray.com/x', 'https://api.dooray.com')).toBe(false)
    expect(isTrustedRedirect('https://file-api.gov-dooray.com/x', 'https://api.gov-dooray.com')).toBe(true)
  })
})

describe('parseContentDispositionFileName', () => {
  it('RFC 5987 filename* 를 우선한다', () => {
    expect(parseContentDispositionFileName("attachment; filename=\"a.txt\"; filename*=UTF-8''%ED%95%9C%EA%B8%80.txt")).toBe('한글.txt')
    expect(parseContentDispositionFileName('attachment; filename="report.pdf"')).toBe('report.pdf')
    expect(parseContentDispositionFileName(null)).toBeNull()
  })
})

describe('DoorayHttp', () => {
  it('토큰이 없으면 NotConfiguredError', async () => {
    const http = new DoorayHttp(async () => null, vi.fn())
    await expect(http.get('/x')).rejects.toBeInstanceOf(NotConfiguredError)
  })

  it('Authorization 헤더와 쿼리를 붙이고 result 를 꺼낸다', async () => {
    const f = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      json({ header: { isSuccessful: true, resultCode: 0 }, result: [1, 2] })
    )
    const http = new DoorayHttp(cfg, f as unknown as typeof fetch)
    expect(await http.get('/messenger/v1/channels/1/logs', { size: 50, empty: undefined })).toEqual([1, 2])
    const [url, init] = f.mock.calls[0]
    expect(String(url)).toBe('https://api.dooray.com/messenger/v1/channels/1/logs?size=50')
    expect((init!.headers as Record<string, string>).Authorization).toBe(`dooray-api ${TOKEN}`)
  })

  it('isSuccessful=false 는 에러이며 메시지에 토큰이 없다', async () => {
    const f = vi.fn(async () => json({ header: { isSuccessful: false, resultCode: -1, resultMessage: '권한 없음' } }, 403))
    const http = new DoorayHttp(cfg, f as unknown as typeof fetch)
    const err = (await http.get("/x").catch((e: unknown) => e)) as DoorayApiError
    expect(err).toBeInstanceOf(DoorayApiError)
    expect(err.status).toBe(403)
    expect(String(err.message)).not.toContain(TOKEN)
  })

  it('429 면 다시 시도한다', async () => {
    let n = 0
    const f = vi.fn(async () => (n++ === 0 ? new Response('', { status: 429, headers: { 'retry-after': '0' } }) : json({ header: { isSuccessful: true }, result: 'ok' })))
    const http = new DoorayHttp(cfg, f as unknown as typeof fetch)
    expect(await http.get('/x')).toBe('ok')
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('다운로드: 307 을 직접 따라가며 file-api 에도 인증 헤더를 붙인다', async () => {
    const f = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      if (String(url).startsWith('https://api.dooray.com')) {
        return new Response(null, { status: 307, headers: { location: 'https://file-api.dooray.com/downloads/f/1' } })
      }
      return new Response('hello', { status: 200, headers: { 'content-disposition': 'attachment; filename="a.txt"' } })
    })
    const http = new DoorayHttp(cfg, f as unknown as typeof fetch)
    const file = await http.download('/messenger/v1/channels/1/files/2')
    expect(file.bytes.toString()).toBe('hello')
    expect(file.fileName).toBe('a.txt')
    expect(f).toHaveBeenCalledTimes(2)
    const [, first] = f.mock.calls[0]
    const [, second] = f.mock.calls[1]
    expect(first!.redirect).toBe('manual')
    expect((second!.headers as Record<string, string>).Authorization).toBe(`dooray-api ${TOKEN}`)
  })

  it('두레이가 아닌 곳으로의 리다이렉트는 따라가지 않는다 (토큰 유출 방지)', async () => {
    const f = vi.fn(async () => new Response(null, { status: 307, headers: { location: 'https://evil.example.com/steal' } }))
    const http = new DoorayHttp(cfg, f as unknown as typeof fetch)
    await expect(http.download('/x')).rejects.toBeInstanceOf(DoorayApiError)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('업로드: 리다이렉트 후 폼을 새로 만들어 다시 보낸다', async () => {
    const f = vi.fn(async (url: string | URL | Request) =>
      String(url).startsWith('https://api.')
        ? new Response(null, { status: 307, headers: { location: 'https://file-api.dooray.com/uploads/x' } })
        : json({ header: { isSuccessful: true }, result: { id: '9' } })
    )
    const makeForm = vi.fn(() => {
      const fd = new FormData()
      fd.append('type', 'general')
      return fd
    })
    const http = new DoorayHttp(cfg, f as unknown as typeof fetch)
    expect(await http.upload('/wiki/v1/wikis/1/pages/2/files', makeForm)).toEqual({ id: '9' })
    expect(makeForm).toHaveBeenCalledTimes(2)
  })
})
