import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from './state'
import { call, onEvent } from './api'
import { MessengerView } from './views/Messenger'
import { WikiView } from './views/Wiki'
import { MailView } from './views/Mail'
import { SettingsView } from './views/Settings'
import { Icon, type IconName } from './components/Icon'
import { navigate, onNav, type NavRequest } from './lib/nav'
import { QuickSwitcher } from './shell/QuickSwitcher'
import { SearchPanel } from './shell/SearchPanel'
import { navHistory } from './shell/history'
import { onOpenSearch } from './shell/overlay'
import rakmMark from './assets/rakm-r.png'

type Tab = 'messenger' | 'mail' | 'wiki' | 'settings'

// 메일은 지금 쓰지 않아 탭에서 뺐다 (Free 플랜이라 IMAP 불가). MailView 와 main 쪽 코드는 남겨 두었으니 다시 넣으려면 여기에 추가한다.
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'messenger', label: '메신저', icon: 'chat' },
  { id: 'wiki', label: '위키', icon: 'book' }
]

type Overlay = { kind: 'quick' } | { kind: 'search'; q: string; scope: { channelId: string; title: string } | null } | null

export function App() {
  const { settings, realtime, shell, updateShell, unread, connection } = useApp()
  const [tab, setTab] = useState<Tab>('messenger')
  // 한 번 연 화면은 숨겨 두기만 해서 스크롤·선택 상태를 유지한다
  const [opened, setOpened] = useState<Set<Tab>>(new Set(['messenger']))
  const [overlay, setOverlay] = useState<Overlay>(null)
  const openedRef = useRef(opened)
  openedRef.current = opened
  const redispatching = useRef(false)
  const restored = useRef(false)
  const tabRef = useRef(tab)
  tabRef.current = tab

  useEffect(() => {
    if (settings && settings.dooray.tokenSource === 'none') setTab('settings')
  }, [settings?.dooray.tokenSource]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setOpened((s) => (s.has(tab) ? s : new Set([...s, tab])))
  }, [tab])

  // 마지막으로 보던 탭 기억 (위키였다면 마지막 페이지로)
  useEffect(() => {
    if (!shell || restored.current || !settings) return
    restored.current = true
    if (settings.dooray.tokenSource === 'none') return
    if (shell.layout.last.tab === 'wiki') {
      void call('shell:lastWikiPage')
        .then((p) => (p ? navigate({ kind: 'wikiPage', wikiId: p.wikiId, pageId: p.pageId }) : setTab('wiki')))
        .catch(() => setTab('wiki'))
    }
  }, [shell, settings])

  useEffect(() => {
    if (!restored.current || (tab !== 'messenger' && tab !== 'wiki')) return
    updateShell((s) => (s.layout.last.tab === tab ? s : { ...s, layout: { ...s.layout, last: { ...s.layout.last, tab } } }))
  }, [tab, updateShell])

  // 화면 이동 버스: 탭을 바꾸고, 그 화면이 아직 안 떠 있었으면 뜬 뒤 같은 요청을 한 번 더 보낸다 (각 화면이 onNav 로 받아 처리)
  useEffect(
    () =>
      onNav((req) => {
        if (redispatching.current) return
        const want: Tab = req.kind === 'wikiPage' ? 'wiki' : req.kind === 'settings' ? 'settings' : 'messenger'
        if (req.kind === 'channel' || req.kind === 'thread' || req.kind === 'wikiPage') navHistory.push(req)
        const mounted = openedRef.current.has(want)
        setTab(want)
        if (!mounted && want !== 'settings') {
          window.setTimeout(() => {
            redispatching.current = true
            try {
              navigate(req)
            } finally {
              redispatching.current = false
            }
          }, 400)
        }
      }),
    []
  )

  useEffect(() => onOpenSearch((r) => setOverlay({ kind: 'search', q: r.q ?? '', scope: r.scope ?? null })), [])

  // 알림을 누르는 등 main 이 보낸 이동
  useEffect(() => onEvent('shell:navigate', (t) => navigate(t as NavRequest)), [])

  const goHistory = useCallback((dir: 'back' | 'forward') => {
    const t = dir === 'back' ? navHistory.back() : navHistory.forward()
    if (!t) return
    // 기록 안에서 움직일 때는 다시 쌓지 않는다
    navHistory.silently(() => navigate(t))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const k = e.key.toLowerCase()
      if (k === 'k' && !e.shiftKey) {
        e.preventDefault()
        setOverlay((o) => (o?.kind === 'quick' ? null : { kind: 'quick' }))
        return
      }
      if (k === 'f' && e.shiftKey) {
        e.preventDefault()
        setOverlay({ kind: 'search', q: '', scope: null })
        return
      }
      if (k === 'f' && !e.shiftKey && tabRef.current === 'messenger') {
        const channelId = shellRef.current?.layout.last.channelId
        if (!channelId) return
        e.preventDefault()
        setOverlay({ kind: 'search', q: '', scope: { channelId, title: '' } })
        return
      }
      if (e.key === '[' || e.key === ']') {
        e.preventDefault()
        goHistory(e.key === '[' ? 'back' : 'forward')
        return
      }
      const map: Record<string, Tab> = { '1': 'messenger', '2': 'wiki', ',': 'settings' }
      const t = map[e.key]
      if (t) {
        e.preventDefault()
        setTab(t)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goHistory])

  const shellRef = useRef(shell)
  shellRef.current = shell
  const closeOverlay = useCallback(() => setOverlay(null), [])
  const searchAll = useCallback((q: string) => setOverlay({ kind: 'search', q, scope: null }), [])

  return (
    <div className="app">
      <nav className="rail" aria-label="기능 전환">
        <div className="rail-logo" title="RAKM LABS">
          <img src={rakmMark} alt="RAKM" draggable={false} />
        </div>
        {TABS.map((t, i) => (
          <button
            key={t.id}
            className={`rail-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
            title={`${t.label} (⌘${i + 1})`}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            <Icon name={t.icon} />
            <span>{t.label}</span>
            {t.id === 'messenger' && unread.total > 0 && (
              <span className="rail-badge" aria-label={`안 읽은 메시지 ${unread.total}개`}>
                {unread.total > 99 ? '99+' : unread.total}
              </span>
            )}
          </button>
        ))}
        <button className="rail-btn" onClick={() => setOverlay({ kind: 'quick' })} title="빠른 이동 (⌘K)">
          <Icon name="search" />
          <span>찾기</span>
        </button>
        <div className="rail-spacer" />
        {!connection.online && (
          <div className="rail-offline" title={connection.detail} aria-label="연결 끊김">
            <Icon name="offline" size={18} />
          </div>
        )}
        <div
          className={`rt-dot rt-${realtime.mode}`}
          title={realtime.mode === 'socket' ? '실시간 연결됨' : realtime.detail || '폴링'}
          aria-label={`수신 방식: ${realtime.mode === 'socket' ? '실시간' : '폴링'}`}
        />
        <button
          className={`rail-btn ${tab === 'settings' ? 'active' : ''}`}
          onClick={() => setTab('settings')}
          title="설정 (⌘,)"
        >
          <Icon name="gear" />
          <span>설정</span>
        </button>
      </nav>
      <main className="workspace">
        {!connection.online && (
          <div className="offline-bar" role="status">
            <Icon name="offline" size={15} /> {connection.detail || '연결이 끊겼습니다.'} 이 컴퓨터에 받아 둔 메시지는 계속 볼 수 있습니다.
          </div>
        )}
        <div className="workspace-body">
          {opened.has('messenger') && (
            <section className="view" hidden={tab !== 'messenger'}>
              <MessengerView active={tab === 'messenger'} />
            </section>
          )}
          {opened.has('mail') && (
            <section className="view" hidden={tab !== 'mail'}>
              <MailView active={tab === 'mail'} />
            </section>
          )}
          {opened.has('wiki') && (
            <section className="view" hidden={tab !== 'wiki'}>
              <WikiView />
            </section>
          )}
          {tab === 'settings' && (
            <section className="view">
              <SettingsView />
            </section>
          )}
        </div>
      </main>
      {overlay?.kind === 'quick' && <QuickSwitcher onClose={closeOverlay} onSearchAll={searchAll} />}
      {overlay?.kind === 'search' && <SearchPanel initial={overlay.q} scope={overlay.scope} onClose={closeOverlay} />}
    </div>
  )
}
