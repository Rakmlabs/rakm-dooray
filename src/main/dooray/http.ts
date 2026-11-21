/**
 * 두레이 REST 호출 공통부.
 * - 인증: `Authorization: dooray-api {토큰}`
 * - 파일 업/다운로드는 api.* 가 307 로 file-api.* 를 가리킨다. 자동 리다이렉트는 인증 헤더를 떨어뜨리므로
 *   리다이렉트를 직접 받아, 같은 두레이 도메인일 때만 인증 헤더를 붙여 다시 보낸다.
 * - 429 는 잠깐 쉬었다가 몇 번 다시 시도한다.
 * 토큰은 에러 메시지·로그에 넣지 않는다.
 */

export interface DoorayConfig {
  apiBase: string
  token: string
}

export class DoorayApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly resultCode: number | null = null
  ) {
    super(message)
    this.name = 'DoorayApiError'
  }
}

export class NotConfiguredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotConfiguredError'
  }
}

interface Envelope<T> {
  header?: { isSuccessful?: boolean; resultCode?: number; resultMessage?: string | null }
  result?: T
  totalCount?: number
}

export interface DownloadedFile {
  bytes: Buffer
  fileName: string | null
  contentType: string | null
}

type FetchLike = typeof fetch
type Query = Record<string, string | number | boolean | null | undefined>

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** HTTP 헤더에 넣을 수 있는 토큰인지 (공백·한글 등 ASCII 밖 문자가 섞이면 fetch 가 ByteString 오류를 낸다) */
export function isValidToken(token: string): boolean {
  return /^[\x21-\x7E]+$/.test(token)
}

export const INVALID_TOKEN_MESSAGE =
  '토큰에 한글이나 공백 같은 쓸 수 없는 문자가 섞였습니다. 두레이에서 발급한 토큰만 그대로 붙여 넣으세요.'

/**
 * 두레이 오류 메시지가 URL 인코딩(%EC%A1%B4...)된 채로 오는 경우가 있어 풀어서 보여준다.
 * 풀 수 없는 문자열이면 그대로 둔다.
 */
export function decodeServerMessage(msg: string): string {
  if (!/%[0-9A-Fa-f]{2}/.test(msg)) return msg
  try {
    return decodeURIComponent(msg.replace(/\+/g, ' '))
  } catch {
    return msg
  }
}

/**
 * JSON.parse 전에 16자리 이상 정수 리터럴을 문자열로 감싼다.
 * 두레이 ID 는 19자리라 숫자로 오면 JS number 정밀도를 넘어 다른 ID 가 된다(조회 시 "존재하지 않는 페이지").
 * 문자열 안의 숫자는 건드리지 않는다.
 */
export function parseJsonSafe(text: string): unknown {
  if (!/\d{16}/.test(text)) return JSON.parse(text)
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    if (ch === '"') {
      let j = i + 1
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
      out += text.slice(i, j + 1)
      i = j + 1
      continue
    }
    if ((ch >= '0' && ch <= '9') || ch === '-') {
      let j = i + 1
      while (j < n && /[0-9eE+\-.]/.test(text[j])) j++
      const num = text.slice(i, j)
      out += /^-?\d{16,}$/.test(num) && !Number.isSafeInteger(Number(num)) ? `"${num}"` : num
      i = j
      continue
    }
    out += ch
    i++
  }
  return JSON.parse(out)
}

/** api.dooray.com → dooray.com. 리다이렉트 대상이 같은 두레이 도메인 아래인지 판단하는 데 쓴다. */
export function baseDomainOf(apiBase: string): string {
  const host = new URL(apiBase).hostname
  return host.startsWith('api.') ? host.slice(4) : host
}

export function isTrustedRedirect(location: string, apiBase: string): boolean {
  let url: URL
  try {
    url = new URL(location, apiBase)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  const domain = baseDomainOf(apiBase)
  return url.hostname === domain || url.hostname.endsWith('.' + domain)
}

export function parseContentDispositionFileName(header: string | null): string | null {
  if (!header) return null
  const star = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header)
  if (star) {
    try {
      return decodeURIComponent(star[2].trim().replace(/^"|"$/g, ''))
    } catch {
      /* 아래로 */
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|([^;]+))/i.exec(header)
  if (plain) {
    const v = (plain[2] ?? plain[3] ?? '').trim()
    try {
      return decodeURIComponent(v)
    } catch {
      return v
    }
  }
  return null
}

export class DoorayHttp {
  private readonly fetchImpl: FetchLike

  constructor(
    private readonly getConfig: () => Promise<DoorayConfig | null>,
    fetchImpl?: FetchLike
  ) {
    this.fetchImpl = fetchImpl ?? fetch
  }

  private async config(): Promise<DoorayConfig> {
    const c = await this.getConfig()
    if (!c || !c.token) throw new NotConfiguredError('두레이 API 토큰이 설정되지 않았습니다. 설정 화면에서 토큰을 입력하세요.')
    const token = c.token.trim()
    if (!isValidToken(token)) throw new NotConfiguredError(INVALID_TOKEN_MESSAGE)
    return { ...c, token }
  }

  private url(apiBase: string, path: string, query?: Query): string {
    const u = new URL(path, apiBase)
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v))
      }
    }
    return u.toString()
  }

  /** 429 일 때 다시 시도하는 fetch */
  private async send(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchImpl(url, init)
      if (res.status !== 429 || attempt >= 3) return res
      const retryAfter = Number(res.headers.get('retry-after'))
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 800 * (attempt + 1))
    }
  }

  private async parse<T>(res: Response, what: string): Promise<{ result: T; totalCount?: number }> {
    let body: Envelope<T> | null = null
    const text = await res.text()
    if (text) {
      try {
        body = parseJsonSafe(text) as Envelope<T>
      } catch {
        body = null
      }
    }
    const ok = res.ok && (body?.header?.isSuccessful ?? res.ok)
    if (!ok) {
      const msg = decodeServerMessage(body?.header?.resultMessage || '') || statusMessage(res.status)
      throw new DoorayApiError(`${what} 실패: ${msg}`, res.status, body?.header?.resultCode ?? null)
    }
    return { result: (body?.result ?? null) as T, totalCount: body?.totalCount }
  }

  async json<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    opts: { query?: Query; body?: unknown } = {}
  ): Promise<{ result: T; totalCount?: number }> {
    const c = await this.config()
    const headers: Record<string, string> = { Authorization: `dooray-api ${c.token}`, Accept: 'application/json' }
    let body: string | undefined
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(opts.body)
    }
    const res = await this.send(this.url(c.apiBase, path, opts.query), { method, headers, body })
    return this.parse<T>(res, `${method} ${path}`)
  }

  async get<T>(path: string, query?: Query): Promise<T> {
    return (await this.json<T>('GET', path, { query })).result
  }

  /** 307 을 직접 따라가는 요청. form 은 재전송을 위해 매번 새로 만든다. */
  private async withRedirect(
    method: 'GET' | 'POST',
    path: string,
    makeBody?: () => FormData
  ): Promise<Response> {
    const c = await this.config()
    const auth = { Authorization: `dooray-api ${c.token}` }
    const first = await this.send(this.url(c.apiBase, path), {
      method,
      headers: auth,
      body: makeBody?.(),
      redirect: 'manual'
    })
    if (![301, 302, 303, 307, 308].includes(first.status)) return first
    const location = first.headers.get('location')
    if (!location) throw new DoorayApiError('파일 서버 주소(Location)가 응답에 없습니다.', first.status)
    if (!isTrustedRedirect(location, c.apiBase)) {
      throw new DoorayApiError('두레이 도메인이 아닌 곳으로 리다이렉트되어 요청을 중단했습니다.', first.status)
    }
    const target = new URL(location, c.apiBase).toString()
    return this.send(target, { method, headers: auth, body: makeBody?.(), redirect: 'manual' })
  }

  async download(path: string): Promise<DownloadedFile> {
    const res = await this.withRedirect('GET', path)
    if (!res.ok) throw new DoorayApiError(`파일 다운로드 실패: ${statusMessage(res.status)}`, res.status)
    return {
      bytes: Buffer.from(await res.arrayBuffer()),
      fileName: parseContentDispositionFileName(res.headers.get('content-disposition')),
      contentType: res.headers.get('content-type')
    }
  }

  async upload<T>(path: string, makeForm: () => FormData): Promise<T> {
    const res = await this.withRedirect('POST', path, makeForm)
    return (await this.parse<T>(res, `POST ${path}`)).result
  }
}

function statusMessage(status: number): string {
  switch (status) {
    case 400:
      return '잘못된 요청 (400)'
    case 401:
      return '인증 실패 — 토큰을 확인하세요 (401)'
    case 403:
      return '권한 없음 (403)'
    case 404:
      return '찾을 수 없음 (404)'
    case 409:
      return '이미 있음 (409)'
    case 429:
      return '요청이 너무 많음 — 잠시 후 다시 시도하세요 (429)'
    default:
      return `HTTP ${status}`
  }
}
