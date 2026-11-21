// ⌘K 검색 매칭: 대소문자 무시, 공백 무시, 한글 초성(ㄱㄴㄷ)·섞어 쓰기("알ㅍ") 지원.

const CHO = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ']
const CHO_SET = new Set(CHO)

/** 한글 음절의 초성. 음절이 아니면 null */
export function initialOf(ch: string): string | null {
  const code = ch.charCodeAt(0) - 0xac00
  if (code < 0 || code > 11171) return null
  return CHO[Math.floor(code / 588)]
}

/** 문자열의 초성만 (한글이 아닌 글자는 그대로) */
export function chosung(s: string): string {
  return [...s].map((c) => initialOf(c) ?? c).join('')
}

export function isJamoConsonant(ch: string): boolean {
  return CHO_SET.has(ch)
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '')
}

/** 질의 글자 q 가 대상 글자 t 에 맞는가: 같거나, q 가 초성이고 t 의 초성과 같음 */
function charMatch(t: string, q: string): boolean {
  return t === q || (isJamoConsonant(q) && initialOf(t) === q)
}

/** text 안에서 query 가 이어서 나오는 첫 위치 (공백 무시). 없으면 -1 */
export function findMatch(text: string, query: string): number {
  const t = [...norm(text)]
  const q = [...norm(query)]
  if (!q.length) return 0
  outer: for (let i = 0; i + q.length <= t.length; i++) {
    for (let j = 0; j < q.length; j++) if (!charMatch(t[i + j], q[j])) continue outer
    return i
  }
  return -1
}

/**
 * 0 이면 안 맞음. 높을수록 앞에.
 * 앞부분 일치 > 단어 시작 일치 > 중간 일치. 초성으로만 맞으면 조금 낮게.
 */
export function matchScore(text: string, query: string): number {
  const q = norm(query)
  if (!q) return 1
  const at = findMatch(text, query)
  if (at < 0) return 0
  const exact = norm(text).includes(q)
  let score = at === 0 ? 100 : 60
  if (at > 0) {
    // 원문 기준 단어 시작인지 (공백·구분자 뒤)
    const words = text.toLowerCase().split(/[\s\-_/·›,.[\]()]+/).filter(Boolean)
    if (words.some((w) => findMatch(w, query) === 0)) score = 80
  }
  if (!exact) score -= 10
  // 짧은 이름일수록 조금 더 (정확히 그 이름일 가능성)
  return score - Math.min(9, Math.floor(norm(text).length / 8))
}

/** 검색 결과 미리보기: 검색어 주변만 자르고, 검색어 위치를 [시작, 끝] 으로 알려 준다 */
export function snippetParts(text: string, query: string, width = 50): { before: string; hit: string; after: string } {
  const flat = text.replace(/\s+/g, ' ').trim()
  const terms = query.trim().split(/\s+/).filter(Boolean)
  const lower = flat.toLowerCase()
  for (const t of terms) {
    const at = lower.indexOf(t.toLowerCase())
    if (at < 0) continue
    const start = Math.max(0, at - width)
    const end = Math.min(flat.length, at + t.length + width * 2)
    return {
      before: (start > 0 ? '…' : '') + flat.slice(start, at),
      hit: flat.slice(at, at + t.length),
      after: flat.slice(at + t.length, end) + (end < flat.length ? '…' : '')
    }
  }
  return { before: flat.slice(0, width * 3), hit: '', after: flat.length > width * 3 ? '…' : '' }
}
