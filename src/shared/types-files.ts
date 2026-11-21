// 파일 영역 공용 타입·도구 (main 과 renderer 가 함께 쓴다). 파일 영역 작업자만 고친다.

/** 앱 안에서 어떻게 보여줄지에 따른 분류 */
export type FileKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'hwp'
  | 'hwpx'
  | 'markdown'
  | 'csv'
  | 'json'
  | 'code'
  | 'text'
  | 'other'

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  avif: 'image/avif',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  hwp: 'application/x-hwp',
  hwpx: 'application/hwp+zip',
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  zip: 'application/zip',
  html: 'text/html',
  htm: 'text/html',
  xml: 'application/xml'
}

/** 문법 강조를 붙일 코드 파일 확장자 → highlight.js 언어 이름 */
export const CODE_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  php: 'php',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  swift: 'swift',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  env: 'ini',
  css: 'css',
  scss: 'scss',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  vue: 'xml',
  dockerfile: 'dockerfile',
  gradle: 'groovy',
  diff: 'diff',
  patch: 'diff'
}

export function extOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  if (/^dockerfile$/i.test(base)) return 'dockerfile'
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i + 1).toLowerCase() : ''
}

/** 이름으로 mime 을 추정한다. 모르면 application/octet-stream */
export function mimeFromName(name: string): string {
  const ext = extOf(name)
  if (EXT_MIME[ext]) return EXT_MIME[ext]
  if (CODE_LANG[ext]) return 'text/plain'
  return 'application/octet-stream'
}

/** 이름(확장자) 우선, 없으면 mime 으로 분류. 두레이 응답에 mimeType 이 없을 때가 많다. */
export function fileKind(name: string, mime?: string | null): FileKind {
  const ext = extOf(name)
  switch (ext) {
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'bmp':
    case 'avif':
      return 'image'
    case 'svg':
      // SVG 는 스크립트가 들어 있을 수 있어 이미지 태그로만 그린다 (img 는 스크립트를 실행하지 않는다)
      return 'image'
    case 'mp4':
    case 'm4v':
    case 'webm':
    case 'mov':
      return 'video'
    case 'mp3':
    case 'm4a':
    case 'aac':
    case 'wav':
    case 'ogg':
    case 'oga':
    case 'flac':
      return 'audio'
    case 'pdf':
      return 'pdf'
    case 'docx':
      return 'docx'
    case 'xlsx':
    case 'xlsm':
      return 'xlsx'
    case 'pptx':
      return 'pptx'
    case 'hwp':
      return 'hwp'
    case 'hwpx':
      return 'hwpx'
    case 'md':
    case 'markdown':
      return 'markdown'
    case 'csv':
    case 'tsv':
      return 'csv'
    case 'json':
      return 'json'
    case 'txt':
    case 'log':
      return 'text'
  }
  if (CODE_LANG[ext]) return 'code'
  const m = (mime ?? '').toLowerCase()
  if (m.startsWith('image/') && m !== 'image/heic') return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  if (m === 'application/pdf') return 'pdf'
  if (m === 'application/json') return 'json'
  if (m === 'text/markdown') return 'markdown'
  if (m === 'text/csv') return 'csv'
  if (m.startsWith('text/')) return 'text'
  return 'other'
}

/** 앱 안 업로드 한 개 최대 크기. 바이트를 IPC 로 main 에 넘기므로 너무 큰 파일은 막는다. */
export const UPLOAD_MAX_BYTES = 100 * 1024 * 1024

export interface FileCacheStats {
  /** 지금 캐시가 쓰는 용량 (바이트) */
  bytes: number
  /** 캐시에 든 파일 수 */
  count: number
  /** 용량 상한 (바이트) */
  limitBytes: number
}

/** 캐시 용량 상한 선택지 (MB) */
export const CACHE_LIMIT_CHOICES_MB = [256, 512, 1024, 2048, 5120]
export const DEFAULT_CACHE_LIMIT_MB = 1024

/** rakm-file:// 주소. 요청은 channelId/fileId 로만 하고 경로는 받지 않는다. name 은 확장자(형식) 판단용 힌트. */
export const FILE_SCHEME = 'rakm-file'

export function fileUrl(channelId: string, fileId: string, name: string): string {
  return `${FILE_SCHEME}://file/${encodeURIComponent(channelId)}/${encodeURIComponent(fileId)}?name=${encodeURIComponent(name)}`
}

export function thumbUrl(channelId: string, fileId: string, name: string): string {
  return `${FILE_SCHEME}://thumb/${encodeURIComponent(channelId)}/${encodeURIComponent(fileId)}?name=${encodeURIComponent(name)}`
}

export interface ParsedFileUrl {
  host: 'file' | 'thumb' | 'pdfjs'
  /** file/thumb: [channelId, fileId] · pdfjs: [폴더, 파일 이름] */
  parts: [string, string]
  name: string
}

/** rakm-file:// 주소를 엄격하게 해석한다. 형식이 다르면 null. */
export function parseFileUrl(raw: string): ParsedFileUrl | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== `${FILE_SCHEME}:`) return null
  const host = u.hostname
  if (host !== 'file' && host !== 'thumb' && host !== 'pdfjs') return null
  const segs = u.pathname.split('/').filter((s) => s !== '')
  if (segs.length !== 2) return null
  let parts: [string, string]
  try {
    parts = [decodeURIComponent(segs[0]), decodeURIComponent(segs[1])]
  } catch {
    return null
  }
  // file/thumb 의 두 값은 경로가 아니라 ID 로만 쓰인다 (캐시 키 해시, API 경로는 encodeURIComponent)
  if (parts.some((p) => !p || p.length > 200 || p.includes('\0') || p === '.' || p === '..')) return null
  if (host === 'pdfjs' && (!/^(cmaps|standard_fonts)$/.test(parts[0]) || !/^[A-Za-z0-9_.-]+$/.test(parts[1]))) return null
  return { host, parts, name: u.searchParams.get('name') ?? '' }
}
