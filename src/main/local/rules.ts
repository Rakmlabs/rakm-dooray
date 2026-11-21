import type { Message } from '@shared/types'
import type { ShellLayout, ShellPrefs, ShellState } from '@shared/types-shell'

// 셸 영역 main 쪽 순수 규칙 (Electron 없이 테스트한다)

export const DEFAULT_PREFS: ShellPrefs = {
  theme: 'system',
  fontSize: 'normal',
  tray: false,
  openAtLogin: false,
  notify: { enabled: true, preview: true, sound: true, muted: [] }
}

export const DEFAULT_LAYOUT: ShellLayout = {
  favorites: [],
  order: {},
  collapsed: ['hidden'],
  recent: [],
  last: { tab: 'messenger', channelId: null }
}

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** 저장 파일이 예전 형식이거나 깨져 있어도 쓸 수 있는 값으로 맞춘다 */
export function normalizeState(raw: unknown): ShellState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ShellState>
  const p = (r.prefs ?? {}) as Partial<ShellPrefs>
  const n = (p.notify ?? {}) as Partial<ShellPrefs['notify']>
  const l = (r.layout ?? {}) as Partial<ShellLayout>
  const order: Record<string, string[]> = {}
  if (l.order && typeof l.order === 'object') for (const [k, v] of Object.entries(l.order)) order[k] = strings(v)
  return {
    prefs: {
      theme: pick(p.theme, ['system', 'light', 'dark'] as const, DEFAULT_PREFS.theme),
      fontSize: pick(p.fontSize, ['small', 'normal', 'large'] as const, DEFAULT_PREFS.fontSize),
      tray: typeof p.tray === 'boolean' ? p.tray : DEFAULT_PREFS.tray,
      openAtLogin: typeof p.openAtLogin === 'boolean' ? p.openAtLogin : DEFAULT_PREFS.openAtLogin,
      notify: {
        enabled: typeof n.enabled === 'boolean' ? n.enabled : true,
        preview: typeof n.preview === 'boolean' ? n.preview : true,
        sound: typeof n.sound === 'boolean' ? n.sound : true,
        muted: strings(n.muted)
      }
    },
    layout: {
      favorites: strings(l.favorites),
      order,
      collapsed: Array.isArray(l.collapsed) ? strings(l.collapsed) : DEFAULT_LAYOUT.collapsed,
      recent: Array.isArray(l.recent) ? l.recent.filter((x) => x && typeof x.key === 'string' && x.target).slice(0, 40) : [],
      last: {
        tab: pick(l.last?.tab, ['messenger', 'wiki'] as const, 'messenger'),
        channelId: typeof l.last?.channelId === 'string' ? l.last.channelId : null
      }
    }
  }
}

export const ZOOM: Record<ShellPrefs['fontSize'], number> = { small: 0.9, normal: 1, large: 1.15 }

export interface NotifyContext {
  meId: string | null
  /** 이번에 받기 전의 읽은 시각. null 이면 처음 보는 대화방이라 알리지 않는다 */
  readMsBefore: number | null
  now: number
  muted: boolean
  /** 앱이 앞에 있고 그 방을 보고 있음 */
  watching: boolean
}

/** 이번에 처음 받은 메시지 중 알릴 것. 오래된 것(10분 넘음)은 앱을 켤 때 한꺼번에 몰려오지 않게 뺀다. */
export function notifiable(added: Message[], c: NotifyContext): Message[] {
  if (c.muted || c.watching || c.readMsBefore === null) return []
  return added.filter((m) => {
    if (!m.senderId || m.senderId === c.meId) return false
    if (m.senderType && m.senderType !== 'member' && m.senderType !== 'app') return false
    const t = m.sentAt ? Date.parse(m.sentAt) : 0
    return t > (c.readMsBefore ?? 0) && c.now - t < 10 * 60 * 1000
  })
}

/** 화면 크기가 바뀌어 저장된 창 위치가 어느 화면에도 걸치지 않으면 버린다 */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export function visibleOn(bounds: Rect, displays: Rect[]): boolean {
  return displays.some(
    (d) =>
      bounds.x < d.x + d.width - 80 &&
      bounds.x + bounds.width > d.x + 80 &&
      bounds.y >= d.y - 10 &&
      bounds.y < d.y + d.height - 80
  )
}
