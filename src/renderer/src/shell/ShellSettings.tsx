import { useEffect, useState } from 'react'
import type { Channel } from '@shared/types'
import type { IndexStatus, NotifyPermission, ShellPrefs } from '@shared/types-shell'
import { call, errorText, onEvent } from '../api'
import { useApp, useMemberNames } from '../state'
import { channelTitle } from '../lib/projects'

// 설정 화면의 셸 영역 카드들 (화면, 알림, 창·실행, 로컬 보관, 단축키)

function useShellPrefs() {
  const { shell, updateShell } = useApp()
  const set = (fn: (p: ShellPrefs) => ShellPrefs) => updateShell((s) => ({ ...s, prefs: fn(s.prefs) }))
  return { prefs: shell?.prefs ?? null, set }
}

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="tabs seg-pref" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} className={value === v ? 'active' : ''} onClick={() => onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  )
}

export function AppearanceSettings() {
  const { prefs, set } = useShellPrefs()
  if (!prefs) return null
  return (
    <div className="card">
      <h2>화면</h2>
      <div className="pref-row">
        <span>테마</span>
        <Seg
          label="테마"
          value={prefs.theme}
          options={[
            ['system', '시스템 따라가기'],
            ['light', '라이트'],
            ['dark', '다크']
          ]}
          onChange={(theme) => set((p) => ({ ...p, theme }))}
        />
      </div>
      <div className="pref-row">
        <span>글자 크기</span>
        <Seg
          label="글자 크기"
          value={prefs.fontSize}
          options={[
            ['small', '작게'],
            ['normal', '보통'],
            ['large', '크게']
          ]}
          onChange={(fontSize) => set((p) => ({ ...p, fontSize }))}
        />
      </div>
      <small className="muted">창 크기·위치와 마지막으로 보던 화면(탭, 대화방, 위키 페이지)은 자동으로 기억합니다.</small>
    </div>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle-row">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-text">
        <span>{label}</span>
        {hint && <small className="muted">{hint}</small>}
      </span>
    </label>
  )
}

export function NotificationSettings() {
  const { prefs, set } = useShellPrefs()
  const { toast } = useApp()
  const nameOf = useMemberNames()
  const [channels, setChannels] = useState<Channel[]>([])
  const [perm, setPerm] = useState<NotifyPermission | null>(null)
  const [testing, setTesting] = useState(false)
  useEffect(() => {
    call('shell:quickData')
      .then((d) => setChannels(d.channels))
      .catch(() => {})
    call('shell:notifyPermission').then(setPerm).catch(() => {})
    return onEvent('shell:notifyPermission', setPerm)
  }, [])
  if (!prefs) return null
  const n = prefs.notify
  const test = () => {
    setTesting(true)
    call('shell:testNotification')
      .then((p) => {
        setPerm(p)
        if (p.state === 'allowed') toast('알림을 보냈습니다. 화면 오른쪽 위에 보이면 정상입니다.')
      })
      .catch((e) => toast(errorText(e)))
      .finally(() => setTesting(false))
  }
  const setN = (fn: (x: ShellPrefs['notify']) => ShellPrefs['notify']) => set((p) => ({ ...p, notify: fn(p.notify) }))
  return (
    <div className="card" id="notify-settings">
      <h2>알림</h2>
      {perm?.state === 'denied' && (
        <div className="banner banner-warn notify-off" role="alert">
          <strong>알림이 꺼져 있음</strong> · {perm.detail}
          <button type="button" className="link" onClick={() => void call('shell:openNotificationSettings')}>
            시스템 설정 열기
          </button>
        </div>
      )}
      {perm && perm.state !== 'denied' && perm.state !== 'allowed' && perm.detail && <div className="banner banner-warn notify-off">{perm.detail}</div>}
      <Toggle
        checked={n.enabled}
        onChange={(enabled) => setN((x) => ({ ...x, enabled }))}
        label="새 메시지 데스크톱 알림"
        hint="앱이 앞에 있고 그 대화방을 보고 있을 때는 알리지 않습니다. 알림을 누르면 그 대화방으로 갑니다."
      />
      <Toggle checked={n.preview} onChange={(preview) => setN((x) => ({ ...x, preview }))} label="알림에 메시지 내용 보이기" hint="끄면 “새 메시지”로만 보입니다." />
      <Toggle checked={n.sound} onChange={(sound) => setN((x) => ({ ...x, sound }))} label="알림 소리" />
      <div className="pref-sub">
        <span className="muted small">알림을 끈 대화방 (대화방 ⋯ 메뉴나 대화방 위 종 버튼으로 끄고 켭니다)</span>
        {n.muted.length === 0 ? (
          <div className="muted small">없음</div>
        ) : (
          <div className="chips">
            {n.muted.map((id) => {
              const c = channels.find((x) => x.id === id)
              return (
                <button key={id} className="chip" onClick={() => setN((x) => ({ ...x, muted: x.muted.filter((m) => m !== id) }))} title="알림 다시 켜기">
                  {c ? channelTitle(c, nameOf) : '대화방'} ✕
                </button>
              )
            })}
          </div>
        )}
      </div>
      <div className="row">
        <button type="button" onClick={test} disabled={testing}>
          알림 테스트
        </button>
        <button type="button" className="link" onClick={() => void call('shell:openNotificationSettings')}>
          시스템 알림 설정
        </button>
        <small className="muted">
          {perm?.state === 'allowed'
            ? `알림 켜짐${perm.checkedAt ? ` (마지막 확인 ${new Date(perm.checkedAt).toLocaleString('ko-KR')})` : ''}.`
            : perm?.state === 'asked'
              ? '처음 알림을 보내면 macOS 가 허용할지 묻습니다. "허용"을 눌러야 알림·배지가 보입니다.'
              : '알림이 안 보이면 "알림 테스트"를 눌러 보세요.'}{' '}
          안 읽은 수는 이 컴퓨터에서 계산한 값입니다 (두레이에는 읽음 정보를 주는 API 가 없습니다).
        </small>
      </div>
    </div>
  )
}

export function WindowSettings() {
  const { prefs, set } = useShellPrefs()
  if (!prefs) return null
  return (
    <div className="card">
      <h2>창·실행</h2>
      <Toggle
        checked={prefs.tray}
        onChange={(tray) => set((p) => ({ ...p, tray }))}
        label="메뉴 막대(트레이)에 상주"
        hint="창을 닫아도 앱이 남아 새 메시지 알림을 받습니다. 아이콘 옆에 안 읽은 수가 보입니다."
      />
      <Toggle
        checked={prefs.openAtLogin}
        onChange={(openAtLogin) => set((p) => ({ ...p, openAtLogin }))}
        label="로그인할 때 자동 실행"
        hint="설치한 앱(dmg/설치 파일)에서만 적용됩니다. 개발 실행에서는 저장만 됩니다."
      />
    </div>
  )
}

export function StorageSettings() {
  const { toast } = useApp()
  const [st, setSt] = useState<IndexStatus | null>(null)
  const load = () =>
    call('shell:indexStatus')
      .then(setSt)
      .catch(() => {})
  useEffect(() => {
    void load()
    const id = window.setInterval(load, 5000)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div className="card">
      <h2>이 컴퓨터에 보관</h2>
      <p className="muted small">
        두레이는 대화방마다 최신 메시지 1000개만 보여 줍니다. 받아 온 메시지를 이 컴퓨터에 쌓아 두어 그보다 오래된 것도 보고 검색할 수 있습니다. 수정·삭제된
        메시지는 다시 받을 때 반영됩니다. 이 기록은 어디로도 보내지 않습니다.
      </p>
      {st && (
        <ul className="stats">
          <li>
            메시지 <b>{st.messages.toLocaleString('ko-KR')}</b>개 · 대화방·스레드 {st.channels}개
          </li>
          <li>
            위키 페이지 <b>{st.wikiPages.toLocaleString('ko-KR')}</b>개 (본문 검색 가능 {st.wikiBodies}개 — 열어 본 페이지)
            {st.crawling && <span className="muted"> · 위키 목록 모으는 중…</span>}
          </li>
          <li className="muted small">저장소: {st.storage}</li>
        </ul>
      )}
      <div className="row">
        <button
          type="button"
          disabled={st?.crawling}
          onClick={() =>
            void call('shell:reindexWiki')
              .then(() => {
                toast('위키 페이지 목록을 다시 모읍니다. 요청 제한 때문에 천천히 진행됩니다.', 'info')
                void load()
              })
              .catch((e) => toast(errorText(e)))
          }
        >
          위키 목록 다시 모으기
        </button>
      </div>
    </div>
  )
}

export function Shortcuts() {
  const keys: [string, string][] = [
    ['⌘K', '빠른 이동 (대화방·사람·위키 페이지, 초성 검색)'],
    ['⌘⇧F', '전체 검색 (메시지·위키)'],
    ['⌘F', '지금 대화방 안에서 찾기'],
    ['⌘[ · ⌘]', '이전·다음 위치로'],
    ['⌘1 · ⌘2', '메신저 · 위키'],
    ['⌘,', '설정'],
    ['Enter', '보내기 (Shift+Enter 줄바꿈)'],
    ['Esc', '답장·수정·스레드·창 닫기']
  ]
  return (
    <div className="card">
      <h2>단축키</h2>
      <ul className="keys">
        {keys.map(([k, v]) => (
          <li key={k}>
            <kbd>{k}</kbd> {v}
          </li>
        ))}
      </ul>
      <small className="muted">Windows·리눅스에서는 ⌘ 대신 Ctrl 입니다. 대화방은 목록에서 끌어 순서를 바꾸거나 폴더(프로젝트)·즐겨찾기로 옮길 수 있습니다.</small>
    </div>
  )
}
