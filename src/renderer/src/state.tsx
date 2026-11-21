import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Member, PublicSettings, RealtimeStatus, UiState } from '@shared/types'
import type { ConnectionState, ShellState, UnreadPayload } from '@shared/types-shell'
import { call, onEvent } from './api'

interface AppState {
  settings: PublicSettings | null
  reloadSettings: () => Promise<void>
  ui: UiState
  updateUi: (fn: (prev: UiState) => UiState) => void
  realtime: RealtimeStatus
  toast: (msg: string, kind?: 'error' | 'info') => void
  /** 셸 영역 설정·배치 (main 의 shell-state.json) */
  shell: ShellState | null
  updateShell: (fn: (prev: ShellState) => ShellState) => void
  unread: UnreadPayload
  connection: ConnectionState
}

const EMPTY_UI: UiState = { projects: [], channelProject: {}, lastSeenAt: {}, hiddenChannels: [] }
const Ctx = createContext<AppState | null>(null)

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('AppProvider 밖에서 사용됨')
  return v
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [ui, setUi] = useState<UiState>(EMPTY_UI)
  const [realtime, setRealtime] = useState<RealtimeStatus>({ mode: 'off', detail: '' })
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: 'error' | 'info' }[]>([])
  const saveTimer = useRef<number | null>(null)
  const [shell, setShell] = useState<ShellState | null>(null)
  const [unread, setUnread] = useState<UnreadPayload>({ summaries: {}, total: 0 })
  const [connection, setConnection] = useState<ConnectionState>({ online: true, detail: '' })
  const shellTimer = useRef<number | null>(null)

  const reloadSettings = useCallback(async () => {
    setSettings(await call('settings:get'))
  }, [])

  useEffect(() => {
    void reloadSettings()
    void call('ui:get').then(setUi)
    void call('realtime:status').then(setRealtime)
    void call('shell:getState').then(setShell).catch(() => {})
    void call('shell:summaries').then(setUnread).catch(() => {})
    void call('shell:connection').then(setConnection).catch(() => {})
    const offs = [
      onEvent('realtime:status', setRealtime),
      onEvent('shell:unread', setUnread),
      onEvent('shell:connectionChanged', setConnection)
    ]
    const net = () => setConnection((c) => (navigator.onLine ? c : { online: false, detail: '인터넷 연결이 끊겼습니다.' }))
    const back = () => setConnection({ online: true, detail: '' })
    window.addEventListener('offline', net)
    window.addEventListener('online', back)
    return () => {
      offs.forEach((f) => f())
      window.removeEventListener('offline', net)
      window.removeEventListener('online', back)
    }
  }, [reloadSettings])

  // 테마·글자 크기: html 에 표시해 styles.css 의 토큰을 덮는다 (main 은 nativeTheme·확대 비율을 맞춘다)
  useEffect(() => {
    if (!shell) return
    const root = document.documentElement
    if (shell.prefs.theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', shell.prefs.theme)
    root.setAttribute('data-font', shell.prefs.fontSize)
  }, [shell?.prefs.theme, shell?.prefs.fontSize]) // eslint-disable-line react-hooks/exhaustive-deps

  const updateShell = useCallback((fn: (prev: ShellState) => ShellState) => {
    setShell((prev) => {
      if (!prev) return prev
      const next = fn(prev)
      if (shellTimer.current) window.clearTimeout(shellTimer.current)
      shellTimer.current = window.setTimeout(() => void call('shell:saveState', next).catch(() => {}), 300)
      return next
    })
  }, [])

  const updateUi = useCallback((fn: (prev: UiState) => UiState) => {
    setUi((prev) => {
      const next = fn(prev)
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      saveTimer.current = window.setTimeout(() => void call('ui:save', next), 400)
      return next
    })
  }, [])

  const toast = useCallback((msg: string, kind: 'error' | 'info' = 'error') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, msg, kind }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3000)
  }, [])

  return (
    <Ctx.Provider value={{ settings, reloadSettings, ui, updateUi, realtime, toast, shell, updateShell, unread, connection }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

// ---------- 멤버 이름 캐시 ----------

const memberCache = new Map<string, Member | null>()
const pending = new Map<string, Promise<void>>()
const listeners = new Set<() => void>()

function requestMember(id: string): void {
  if (memberCache.has(id) || pending.has(id)) return
  const p = call('messenger:member', id)
    .then((m) => {
      memberCache.set(id, m)
    })
    .catch(() => {
      memberCache.set(id, null)
    })
    .finally(() => {
      pending.delete(id)
      listeners.forEach((l) => l())
    })
  pending.set(id, p)
}

export function rememberMember(m: Member): void {
  memberCache.set(m.id, m)
  listeners.forEach((l) => l())
}

/** id → 이름. 모르는 id 는 백그라운드로 조회하고 도착하면 다시 그린다. */
export function useMemberNames(): (id: string | null) => string | null {
  const [, force] = useState(0)
  useEffect(() => {
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])
  return useCallback((id: string | null) => {
    if (!id) return null
    const m = memberCache.get(id)
    if (m === undefined) {
      requestMember(id)
      return null
    }
    return m?.name ?? null
  }, [])
}
