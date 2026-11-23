// 사람마다 눈에 확 띄는 서로 다른 이름 색 (슬랙처럼 이름에 색을 넣는다).
// 처음 본 순서대로 아직 안 쓴 색을 하나씩 준다 → 색 수(NAME_COLORS)보다 사람이 적으면 겹치지 않는다.
// 한 번 정한 색은 이 컴퓨터에 기억해 늘 같은 색으로 보인다. 색 값은 chat.css 의 .nc-N (라이트/다크).
export const NAME_COLORS = 10

const KEY = 'name-colors:v1'
let map: Record<string, number> | null = null

function loadMap(): Record<string, number> {
  if (map) return map
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Record<string, number>
    map = v && typeof v === 'object' ? v : {}
  } catch {
    map = {}
  }
  return map
}

/** 이 사람(멤버 ID, 없으면 이름)의 색 번호 0..NAME_COLORS-1 */
export function nameColorIndex(key: string | null | undefined): number {
  if (!key) return 0
  const m = loadMap()
  const have = m[key]
  if (typeof have === 'number' && have >= 0 && have < NAME_COLORS) return have
  const used = new Array<number>(NAME_COLORS).fill(0)
  for (const v of Object.values(m)) if (v >= 0 && v < NAME_COLORS) used[v]++
  // 가장 적게 쓴 색 (같으면 앞 번호) — 열 명까지는 모두 다른 색
  let pick = 0
  for (let i = 1; i < NAME_COLORS; i++) if (used[i] < used[pick]) pick = i
  m[key] = pick
  try {
    window.localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    /* 저장 못 해도 이번 실행 동안은 같은 색 */
  }
  return pick
}

/** 이름에 붙일 클래스 (color: var(--nc)) */
export const nameColorClass = (key: string | null | undefined): string => `who nc-${nameColorIndex(key)}`

/** 테스트용 */
export function resetNameColors(): void {
  map = null
}
