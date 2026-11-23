// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../src/shared/types-updates'

let status: UpdateStatus | null = null
vi.mock('../src/renderer/src/lib/updates', () => ({
  useUpdates: () => status,
  checkUpdates: vi.fn(),
  restartToUpdate: vi.fn(() => Promise.resolve(null))
}))
vi.mock('../src/renderer/src/state', () => ({ useApp: () => ({ toast: vi.fn() }) }))
vi.mock('../src/renderer/src/api', () => ({ call: vi.fn(() => Promise.resolve(null)), errorText: String }))

const { UpdateBar } = await import('../src/renderer/src/components/UpdateSettings')
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const base: UpdateStatus = {
  state: 'idle', current: '0.1.8', version: null, percent: null, detail: '', lastCheckedAt: null, lastResult: null, restarting: false, notes: [], notesUrl: null
}
const ready = (v = '0.1.9'): UpdateStatus => ({ ...base, state: 'ready', version: v, percent: 100, notes: ['새 알림', '• 15분마다 확인'], notesUrl: 'https://example.com' })

let clock = Date.now()
describe('새 버전 알림 카드', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(() => {
    // 앞 시험의 입력 시각이 모듈에 남아 있으므로 시험마다 시계를 한 시간씩 뒤로
    clock += 3_600_000
    vi.useFakeTimers({ now: clock })
    localStorage.clear()
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  })
  afterEach(() => {
    act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
  })
  const render = () => act(() => root.render(<UpdateBar />))

  it('받기 전에는 없고, 준비되면 버전·변경점·버튼', () => {
    status = { ...base, state: 'downloading', version: '0.1.9', percent: 40 }
    render()
    expect(host.querySelector('.update-card')).toBeNull()
    status = ready()
    render()
    const card = host.querySelector('.update-card')!
    expect(card.textContent).toContain('v0.1.9 출시')
    expect(card.querySelector('li.h')?.textContent).toBe('새 알림')
    expect([...card.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['변경점 전체 보기', '지금 재시작', '나중에'])
  })

  it('앱을 켠 뒤 한참 지나 준비돼도, 그 순간 입력 중이면 손을 뗄 때까지 미룬다', () => {
    status = base
    render() // 켤 때는 입력 중이 아님
    vi.advanceTimersByTime(60_000)
    const t = document.createElement('textarea')
    document.body.append(t)
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    status = ready()
    render()
    expect(host.querySelector('.update-card')).toBeNull()
    act(() => vi.advanceTimersByTime(2000))
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', bubbles: true })) // 계속 입력
    act(() => vi.advanceTimersByTime(3000))
    expect(host.querySelector('.update-card')).toBeNull()
    act(() => vi.advanceTimersByTime(2000)) // 마지막 입력 뒤 5초
    expect(host.querySelector('.update-card')).not.toBeNull()
    expect(document.activeElement === t || document.activeElement === document.body).toBe(true)
    t.remove()
  })

  it('나중에: 그 버전은 다시 띄우지 않고, 더 새 버전은 띄운다', () => {
    status = ready('0.1.9')
    render()
    act(() => (host.querySelector('.update-card-actions button:last-child') as HTMLButtonElement).click())
    expect(host.querySelector('.update-card')).toBeNull()
    expect(localStorage.getItem('rakm.update.later')).toBe('0.1.9')
    status = ready('0.1.10')
    render()
    expect(host.querySelector('.update-card')?.textContent).toContain('v0.1.10')
  })
})
