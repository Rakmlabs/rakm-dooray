// rakm-file:// 프로토콜: 캐시에 든 채팅 파일만 renderer 에 내보낸다.
//   rakm-file://file/<channelId>/<fileId>?name=…   원본 (Range 지원)
//   rakm-file://thumb/<channelId>/<fileId>?name=…  이미지 썸네일
//   rakm-file://pdfjs/<cmaps|standard_fonts>/<이름>  pdf.js 글꼴 데이터 (앱에 포함된 pdfjs-dist 에서만)
// 경로는 요청에서 받지 않는다. channelId/fileId 로 캐시 항목을 찾고, 디스크 경로는 캐시가 만든다.
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { parseFileUrl } from '@shared/types-files'
import type { FileCache } from './cache'
import { parseRange } from './range'

const BASE_HEADERS: Record<string, string> = {
  // renderer 의 fetch(pdf.js·문서 뷰어)가 읽을 수 있게. 이 스킴은 우리 앱 창에서만 쓰인다.
  'Access-Control-Allow-Origin': '*',
  'X-Content-Type-Options': 'nosniff',
  // 문서로 직접 열리더라도 스크립트가 돌지 않게
  'Content-Security-Policy': "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'"
}

/** HTML 같은 실행 가능한 형식은 글자로만 내보낸다 */
function safeMime(mime: string): string {
  if (/^(text\/html|application\/xhtml|text\/xml|application\/xml)/i.test(mime)) return 'text/plain; charset=utf-8'
  if (mime.startsWith('text/')) return `${mime}; charset=utf-8`
  return mime
}

function text(status: number, msg: string): Response {
  return new Response(msg, { status, headers: { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } })
}

export async function serveFile(path: string, mime: string, rangeHeader: string | null): Promise<Response> {
  const size = (await stat(path)).size
  const headers: Record<string, string> = {
    ...BASE_HEADERS,
    'Content-Type': safeMime(mime),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=600'
  }
  const range = parseRange(rangeHeader, size)
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
  }
  if (range) {
    const body = Readable.toWeb(createReadStream(path, { start: range.start, end: range.end })) as ReadableStream
    return new Response(body, {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        'Content-Length': String(range.end - range.start + 1)
      }
    })
  }
  const body = Readable.toWeb(createReadStream(path)) as ReadableStream
  return new Response(body, { status: 200, headers: { ...headers, 'Content-Length': String(size) } })
}

export function makeFileProtocolHandler(cache: FileCache, pdfjsDir: () => string) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return text(405, '허용되지 않는 요청')
    const u = parseFileUrl(req.url)
    if (!u) return text(400, '잘못된 파일 주소')
    try {
      if (u.host === 'pdfjs') {
        const bytes = await readFile(join(pdfjsDir(), u.parts[0], u.parts[1]))
        return new Response(new Uint8Array(bytes), {
          status: 200,
          headers: { ...BASE_HEADERS, 'Content-Type': 'application/octet-stream', 'Cache-Control': 'max-age=86400' }
        })
      }
      const [channelId, fileId] = u.parts
      if (u.host === 'thumb') {
        const t = await cache.thumb(channelId, fileId, u.name)
        return serveFile(t.path, t.mime, null)
      }
      const e = await cache.ensure(channelId, fileId, u.name)
      return serveFile(cache.blobPath(e), e.mime, req.headers.get('range'))
    } catch (e) {
      // 파일 내용·토큰은 메시지에 넣지 않는다
      const msg = e instanceof Error ? e.message : String(e)
      console.error(`[files] 파일 요청 실패: ${msg}`)
      return text(502, msg)
    }
  }
}
