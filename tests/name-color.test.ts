// 이름 색: 열 명까지는 서로 다른 색, 같은 사람은 늘 같은 색
import { beforeEach, describe, expect, it } from 'vitest'
const store = new Map<string, string>()
;(globalThis as unknown as { window: unknown }).window = {
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) }
}
const { NAME_COLORS, nameColorIndex, resetNameColors } = await import('../src/renderer/src/components/people/nameColor')

beforeEach(() => {
  store.clear()
  resetNameColors()
})

describe('이름 색', () => {
  it('열 명까지 모두 다른 색', () => {
    const got = Array.from({ length: NAME_COLORS }, (_, i) => nameColorIndex(`m${i}`))
    expect(new Set(got).size).toBe(NAME_COLORS)
  })
  it('같은 사람은 같은 색이고, 다시 켜도 그대로', () => {
    const a = nameColorIndex('a')
    const b = nameColorIndex('b')
    expect(nameColorIndex('a')).toBe(a)
    resetNameColors()
    store.set('name-colors:v1', JSON.stringify({ a, b }))
    expect(nameColorIndex('b')).toBe(b)
    expect(nameColorIndex('c')).not.toBe(a)
  })
})
