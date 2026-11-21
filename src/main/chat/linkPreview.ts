// 링크 미리보기 (채팅 영역). 외부 사이트에 직접 요청하므로 안전장치를 둔다.
// - 쿠키·인증 헤더 없이 요청한다 (Node http 요청이라 브라우저 쿠키가 실리지 않는다).
// - 사설·루프백·링크로컬 등 내부 주소로 가는 요청은 막는다. DNS 결과도 검사하고(재바인딩 대비 연결 시점 lookup 에서),
//   리다이렉트마다 다시 검사한다.
// - 시간 제한, 응답 크기 제한. 이미지는 작은 래스터만 data: URL 로 돌려준다 (SVG 는 받지 않는다).
import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import type { LinkPreview } from '@shared/types-chat'

const HTML_MAX = 512 * 1024
const IMAGE_MAX = 1024 * 1024
const MAX_REDIRECTS = 4
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

export interface PreviewOptions {
  timeoutMs?: number
  /** 이 host:port 들은 사설 주소 검사를 건너뛴다 (개발 모드 모의 서버 전용) */
  allowHosts?: string[]
}

// ---------- 주소 검사 ----------

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0
}

const V4_BLOCKS: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
]

/** 공인 인터넷 주소가 아니면 true (요청 차단) */
export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) {
    const n = ipv4ToInt(ip)
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
      return (n & mask) === (ipv4ToInt(base) & mask)
    })
  }
  if (v === 6) {
    const s = ip.toLowerCase().replace(/^\[|\]$/g, '')
    if (s === '::' || s === '::1') return true
    // IPv4 매핑/호환 주소는 안의 v4 로 판단
    const mapped = s.match(/^(?:::ffff:|::)(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isBlockedIp(mapped[1])
    const hexMapped = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (hexMapped) {
      const a = parseInt(hexMapped[1], 16)
      const b = parseInt(hexMapped[2], 16)
      return isBlockedIp(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`)
    }
    const first = parseInt(s.split(':')[0] || '0', 16)
    if ((first & 0xfe00) === 0xfc00) return true // fc00::/7 고유 로컬
    if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 링크 로컬
    if ((first & 0xff00) === 0xff00) return true // 멀티캐스트
    if (s.startsWith('64:ff9b:') || s.startsWith('2001:db8:') || s.startsWith('2002:')) return true
    return false
  }
  return true
}

/** 요청해도 되는 URL 인지 (프로토콜·자격 증명·IP 리터럴·이름). DNS 검사는 연결 시점에 따로 한다. */
export function checkUrl(raw: string, allowHosts: string[] = []): URL | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (u.username || u.password) return null
  if (allowHosts.includes(u.host)) return u
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) return isBlockedIp(host) ? null : u
  const lower = host.toLowerCase()
  if (lower === 'localhost' || lower.endsWith('.localhost') || lower.endsWith('.local') || lower.endsWith('.internal') || !lower.includes('.'))
    return null
  return u
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void

/** dns.lookup 을 감싸 내부 주소로 풀리면 실패시킨다 (http.request 의 lookup 옵션) */
function guardedLookup(hostname: string, options: { all?: boolean; family?: number }, cb: LookupCb): void {
  dnsLookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err, [])
    const list = addrs as LookupAddress[]
    if (!list.length || list.some((a) => isBlockedIp(a.address))) {
      const e = new Error('내부 주소로는 요청하지 않습니다') as NodeJS.ErrnoException
      e.code = 'EBLOCKED'
      return cb(e, [])
    }
    if (options.all) return cb(null, list)
    cb(null, list[0].address, list[0].family)
  })
}

// ---------- 요청 ----------

interface RawResponse {
  status: number
  headers: IncomingHttpHeaders
  body: Buffer
  truncated: boolean
}

function getOnce(u: URL, accept: string, maxBytes: number, timeoutMs: number, skipDnsCheck: boolean): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)(
      u,
      {
        method: 'GET',
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; RAKM-LinkPreview/1.0)',
          accept,
          'accept-encoding': 'identity',
          'accept-language': 'ko,en;q=0.8'
        },
        lookup: skipDnsCheck ? undefined : (guardedLookup as never),
        timeout: timeoutMs
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        let truncated = false
        res.on('data', (c: Buffer) => {
          if (truncated) return
          size += c.length
          if (size > maxBytes) {
            truncated = true
            chunks.push(c.subarray(0, c.length - (size - maxBytes)))
            res.destroy()
            done()
            return
          }
          chunks.push(c)
        })
        let finished = false
        const done = () => {
          if (finished) return
          finished = true
          clearTimeout(timer)
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), truncated })
        }
        res.on('end', done)
        res.on('close', done)
        res.on('error', (e) => {
          clearTimeout(timer)
          reject(e)
        })
      }
    )
    // 전체 시간 제한 (느리게 흘려 보내는 서버 대비)
    const timer = setTimeout(() => req.destroy(new Error('시간 초과')), timeoutMs)
    req.on('timeout', () => req.destroy(new Error('시간 초과')))
    req.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    req.end()
  })
}

/** 리다이렉트를 직접 따라가며 매번 주소를 검사한다 */
async function fetchGuarded(
  raw: string,
  accept: string,
  maxBytes: number,
  opts: PreviewOptions
): Promise<{ url: URL; res: RawResponse } | null> {
  let u = checkUrl(raw, opts.allowHosts)
  const timeoutMs = opts.timeoutMs ?? 5000
  for (let i = 0; u && i <= MAX_REDIRECTS; i++) {
    const res = await getOnce(u, accept, maxBytes, timeoutMs, (opts.allowHosts ?? []).includes(u.host))
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      u = checkUrl(new URL(res.headers.location, u).toString(), opts.allowHosts)
      continue
    }
    if (res.status !== 200) return null
    return { url: u, res }
  }
  return null
}

// ---------- HTML 해석 ----------

export function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => safeChar(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (_m, n: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' })[n] ?? '')
}

function safeChar(code: number): string {
  try {
    return String.fromCodePoint(code)
  } catch {
    return ''
  }
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([a-zA-Z_:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '')
  }
  return out
}

function clean(s: string | undefined | null, max: number): string | null {
  if (!s) return null
  const t = s.replace(/\s+/g, ' ').trim()
  if (!t) return null
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

export function parseMeta(html: string): { siteName: string | null; title: string | null; description: string | null; image: string | null } {
  const head = html.slice(0, HTML_MAX)
  const meta: Record<string, string> = {}
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(m[0])
    const key = (a.property ?? a.name ?? '').toLowerCase()
    if (key && a.content !== undefined && !(key in meta)) meta[key] = a.content
  }
  const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
  return {
    siteName: clean(meta['og:site_name'], 80),
    title: clean(meta['og:title'] ?? meta['twitter:title'] ?? (titleTag ? decodeEntities(titleTag) : null), 160),
    description: clean(meta['og:description'] ?? meta['twitter:description'] ?? meta['description'], 300),
    image: clean(meta['og:image'] ?? meta['og:image:url'] ?? meta['twitter:image'], 2000)
  }
}

function charsetOf(contentType: string | undefined, body: Buffer): string {
  const fromHeader = contentType?.match(/charset=["']?([\w-]+)/i)?.[1]
  if (fromHeader) return fromHeader.toLowerCase()
  const sniff = body.subarray(0, 2048).toString('latin1').match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1]
  return (sniff ?? 'utf-8').toLowerCase()
}

function decodeBody(body: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset).decode(body)
  } catch {
    return body.toString('utf8')
  }
}

// ---------- 공개 함수 ----------

export async function fetchLinkPreview(rawUrl: string, opts: PreviewOptions = {}): Promise<LinkPreview | null> {
  const page = await fetchGuarded(rawUrl, 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1', HTML_MAX, opts)
  if (!page) return null
  const type = String(page.res.headers['content-type'] ?? '').toLowerCase()
  if (!type.includes('text/html') && !type.includes('application/xhtml')) return null
  const html = decodeBody(page.res.body, charsetOf(type, page.res.body))
  const meta = parseMeta(html)
  if (!meta.title && !meta.description) return null
  let image: string | null = null
  if (meta.image) {
    try {
      const imgUrl = new URL(meta.image, page.url).toString()
      const img = await fetchGuarded(imgUrl, 'image/png,image/jpeg,image/gif,image/webp', IMAGE_MAX, opts)
      const imgType = String(img?.res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
      if (img && !img.res.truncated && IMAGE_TYPES.has(imgType) && img.res.body.length > 0) {
        image = `data:${imgType};base64,${img.res.body.toString('base64')}`
      }
    } catch {
      image = null
    }
  }
  return {
    url: rawUrl,
    finalUrl: page.url.toString(),
    siteName: meta.siteName ?? page.url.hostname,
    title: meta.title,
    description: meta.description,
    image
  }
}
