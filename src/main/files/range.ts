// HTTP Range 해석 (동영상·오디오 탐색용). 한 구간만 지원한다 (브라우저 미디어 요청은 한 구간이다).

export type RangeResult = { start: number; end: number } | 'unsatisfiable' | null

/** null = Range 없음/무시(전체 응답), 'unsatisfiable' = 416 */
export function parseRange(header: string | null | undefined, size: number): RangeResult {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const [, a, b] = m
  if (a === '' && b === '') return null
  if (size === 0) return 'unsatisfiable'
  let start: number
  let end: number
  if (a === '') {
    // 마지막 N 바이트
    const n = Number(b)
    if (n === 0) return 'unsatisfiable'
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(a)
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1)
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return 'unsatisfiable'
  return { start, end }
}
