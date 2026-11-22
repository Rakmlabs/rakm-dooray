import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: true, getName: () => 'RAKM 두레이' }, Notification: class {}, shell: {} }))

const { interpret, describe: describePerm } = await import('../src/main/local/notify-permission')

describe('알림 권한 해석', () => {
  it('미결정 → undecided, 안내 있음', () => {
    const v = interpret({ status: 'notDetermined', alert: 'notSupported', badge: 'notSupported', sound: 'notSupported' })
    expect(v.state).toBe('undecided')
    expect(describePerm(v, false)).toMatch(/허용/)
  })
  it('거부 → denied (Dock 배지도 안 보인다고 안내)', () => {
    const v = interpret({ status: 'denied', alert: 'enabled', badge: 'enabled', sound: 'enabled' })
    expect(v).toEqual({ state: 'denied', banners: false, badge: false })
    expect(describePerm(v, false)).toMatch(/Dock 배지/)
  })
  it('허용 + 배지 꺼짐 → 배지 안내', () => {
    const v = interpret({ status: 'authorized', alert: 'enabled', badge: 'disabled', sound: 'enabled' })
    expect(v).toEqual({ state: 'allowed', banners: true, badge: false })
    expect(describePerm(v, false)).toMatch(/배지/)
  })
  it('다 켜짐 → 안내 없음', () => {
    const v = interpret({ status: 'authorized', alert: 'enabled', badge: 'enabled', sound: 'enabled' })
    expect(describePerm(v, false)).toBe('')
  })
  it('읽지 못함 → unknown', () => {
    expect(interpret(null).state).toBe('unknown')
  })
})
