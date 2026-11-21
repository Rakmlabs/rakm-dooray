import { describe, expect, it, vi } from 'vitest'
import { decodeServerMessage, DoorayApiError, DoorayHttp, isValidToken, NotConfiguredError, parseJsonSafe } from '../src/main/dooray/http'
import { WikiApi } from '../src/main/dooray/wiki'

const ok = (result: unknown) => ({ header: { isSuccessful: true, resultCode: 0 }, result })

describe('토큰 검사 (ByteString 오류 방지)', () => {
  it('ASCII 인쇄 문자만 허용한다', () => {
    expect(isValidToken('abc123:XYZ-_.')).toBe(true)
    expect(isValidToken('abc 123')).toBe(false)
    expect(isValidToken('abc한글')).toBe(false)
    expect(isValidToken('')).toBe(false)
  })

  it('한글이 섞인 토큰이면 fetch 를 부르지 않고 한국어 안내 오류를 낸다', async () => {
    const f = vi.fn()
    const http = new DoorayHttp(async () => ({ apiBase: 'https://api.dooray.com', token: 'abcd한글' }), f as unknown as typeof fetch)
    const err = (await http.get('/x').catch((e: unknown) => e)) as Error
    expect(err).toBeInstanceOf(NotConfiguredError)
    expect(err.message).toContain('토큰')
    expect(err.message).not.toContain('abcd')
    expect(f).not.toHaveBeenCalled()
  })

  it('앞뒤 공백·줄바꿈은 잘라서 쓴다', async () => {
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => new Response(JSON.stringify(ok(1))))
    const http = new DoorayHttp(async () => ({ apiBase: 'https://api.dooray.com', token: '  tok:en\n' }), f as unknown as typeof fetch)
    await http.get('/x')
    expect((f.mock.calls[0][1]!.headers as Record<string, string>).Authorization).toBe('dooray-api tok:en')
  })
})

describe('서버 오류 메시지 디코딩', () => {
  it('URL 인코딩된 메시지를 푼다', () => {
    expect(decodeServerMessage(encodeURIComponent('존재하지 않는 페이지입니다'))).toBe('존재하지 않는 페이지입니다')
    expect(decodeServerMessage('그냥 메시지 100%')).toBe('그냥 메시지 100%')
    expect(decodeServerMessage('%E0%A4%A')).toBe('%E0%A4%A')
  })

  it('DoorayApiError 메시지에 디코딩된 문장이 들어간다', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ header: { isSuccessful: false, resultCode: -1, resultMessage: encodeURIComponent('존재하지 않는 페이지입니다') } }), { status: 404 }))
    const http = new DoorayHttp(async () => ({ apiBase: 'https://api.dooray.com', token: 't' }), f as unknown as typeof fetch)
    const err = (await http.get('/x').catch((e: unknown) => e)) as DoorayApiError
    expect(err.message).toContain('존재하지 않는 페이지입니다')
    expect(err.message).not.toContain('%EC')
  })
})

describe('큰 정수 ID 보존', () => {
  it('16자리 이상 정수는 문자열로 바꿔 정밀도를 지킨다', () => {
    const r = parseJsonSafe('{"id":3617610205158345977,"n":42,"t":1700000000000,"s":"x 3617610205158345977 \\" y","f":-1.5e3,"a":[1234567890123456789]}') as Record<string, unknown>
    expect(r.id).toBe('3617610205158345977')
    expect(r.n).toBe(42)
    expect(r.t).toBe(1700000000000)
    expect(r.s).toBe('x 3617610205158345977 " y')
    expect(r.f).toBe(-1500)
    expect(r.a).toEqual(['1234567890123456789'])
  })
})

describe('위키 페이지 조회', () => {
  it('공식 단건 조회 GET /wiki/v1/pages/{pageId} 를 쓰고 응답의 wikiId 를 돌려준다', async () => {
    const f = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) =>
      new Response('{"header":{"isSuccessful":true},"result":{"id":3617610205158345999,"wikiId":3617610205158345977,"subject":"홈","root":true,"body":{"mimeType":"text/x-markdown","content":"# 홈"}}}')
    )
    const wiki = new WikiApi(new DoorayHttp(async () => ({ apiBase: 'https://api.dooray.com', token: 't' }), f as unknown as typeof fetch))
    const p = await wiki.page('3617610203123698120', '3617610205158345999')
    expect(String(f.mock.calls[0][0])).toBe('https://api.dooray.com/wiki/v1/pages/3617610205158345999')
    expect(p.id).toBe('3617610205158345999')
    expect(p.wikiId).toBe('3617610205158345977')
    expect(p.content).toBe('# 홈')
  })
})
