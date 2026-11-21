import { useEffect, useState } from 'react'
import { useApp } from './state'
import { MessengerView } from './views/Messenger'
import { WikiView } from './views/Wiki'
import { MailView } from './views/Mail'
import { SettingsView } from './views/Settings'
import { Icon, type IconName } from './components/Icon'

type Tab = 'messenger' | 'mail' | 'wiki' | 'settings'

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'messenger', label: '메신저', icon: 'chat' },
  { id: 'mail', label: '메일', icon: 'mail' },
  { id: 'wiki', label: '위키', icon: 'book' }
]

export function App() {
  const { settings, realtime } = useApp()
  const [tab, setTab] = useState<Tab>('messenger')
  // 한 번 연 화면은 숨겨 두기만 해서 스크롤·선택 상태를 유지한다
  const [opened, setOpened] = useState<Set<Tab>>(new Set(['messenger']))

  useEffect(() => {
    if (settings && settings.dooray.tokenSource === 'none') setTab('settings')
  }, [settings?.dooray.tokenSource]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setOpened((s) => (s.has(tab) ? s : new Set([...s, tab])))
  }, [tab])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const map: Record<string, Tab> = { '1': 'messenger', '2': 'mail', '3': 'wiki', ',': 'settings' }
      const t = map[e.key]
      if (t) {
        e.preventDefault()
        setTab(t)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="app">
      <nav className="rail" aria-label="기능 전환">
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
          </button>
        ))}
        <div className="rail-spacer" />
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
      </main>
    </div>
  )
}
