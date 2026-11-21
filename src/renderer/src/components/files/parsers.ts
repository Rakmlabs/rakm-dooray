// 문서 미리보기용 파서 (전부 이 컴퓨터 안에서만 처리한다. 외부 변환 서비스로 보내지 않는다).
// DOM 이 필요 없는 부분만 여기 두어 단위 테스트한다.

/** CSV/TSV 를 행 배열로. 따옴표 안의 구분자·줄바꿈·"" 이스케이프를 처리한다. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const d = delimiter ?? guessDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else q = false
      } else cell += c
      continue
    }
    if (c === '"' && cell === '') q = true
    else if (c === d) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

function guessDelimiter(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? ''
  const counts = [',', '\t', ';'].map((d) => [d, first.split(d).length] as const)
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 1 ? counts[0][0] : ','
}

/** 엑셀식 열 이름: 0 → A, 25 → Z, 26 → AA */
export function columnName(i: number): string {
  let s = ''
  let n = i + 1
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** HWP 의 PrvText 는 문단을 <...> 로 감싼 경우가 많다. 줄 단위로 벗긴다. */
export function cleanPrvText(raw: string): string {
  return raw
    .replace(/\0+$/, '')
    .split(/\r?\n/)
    .map((l) => l.replace(/^<(.*)>$/, '$1'))
    .join('\n')
    .trim()
}

/** UTF-16LE 바이트 → 문자열 */
export function utf16le(bytes: Uint8Array): string {
  return new TextDecoder('utf-16le').decode(bytes)
}

/** 이미지 바이트의 형식 (미리보기 이미지가 PNG/GIF/BMP/JPEG 중 무엇인지) */
export function imageMime(b: Uint8Array): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp'
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  return null
}

/** zip 안 상대 경로 해석 (ppt/slides/slide1.xml + ../media/a.png → ppt/media/a.png) */
export function resolveZipPath(fromFile: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = fromFile.split('/').slice(0, -1)
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.' && seg !== '') parts.push(seg)
  }
  return parts.join('/')
}

/** 자연 정렬용: slide10 이 slide2 뒤로 가게 */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true })
}
