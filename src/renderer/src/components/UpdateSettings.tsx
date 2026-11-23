import { useEffect, useState } from 'react'
import { call, errorText } from '../api'
import { useApp } from '../state'
import { checkUpdates, restartToUpdate, useUpdates } from '../lib/updates'

const RELEASES_URL = 'https://github.com/Rakmlabs/rakm-dooray/releases'

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR') : '없음')

const DISMISS_KEY = 'rakm.update.later'
/** 입력 중이면 이만큼 손을 뗄 때까지 카드를 미룬다 */
const TYPING_QUIET_MS = 4000

function dismissedVersion(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY)
  } catch {
    return null
  }
}

let lastTypingAt = 0
if (typeof document !== 'undefined') {
  document.addEventListener(
    'keydown',
    (e) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT' || t.isContentEditable)) lastTypingAt = Date.now()
    },
    true
  )
}

/**
 * 새 버전 알림 카드: 다 받았을 때 오른쪽 위에 떠 있는 카드 (레이아웃을 밀지 않는다 — position: fixed).
 * 입력하는 중이면 손을 뗄 때까지 미루고, 포커스를 빼앗지 않는다. "나중에"는 그 버전만 다시 띄우지 않는다 (끌 때 설치).
 */
export function UpdateBar() {
  const s = useUpdates()
  const { toast } = useApp()
  const [later, setLater] = useState(dismissedVersion)
  /** 카드를 띄운 버전. 준비된 순간 입력 중이면 손을 뗄 때까지 미룬 뒤 정한다 */
  const [shown, setShown] = useState<string | null>(null)
  const want = s?.state === 'ready' && s.version && later !== s.version ? s.version : null
  useEffect(() => {
    if (!want || shown === want) return
    const tryShow = () => {
      if (Date.now() - lastTypingAt < TYPING_QUIET_MS) return false
      setShown(want)
      return true
    }
    if (tryShow()) return
    const id = window.setInterval(() => tryShow() && window.clearInterval(id), 1000)
    return () => window.clearInterval(id)
  }, [want, shown])
  if (!want || shown !== want || !s) return null
  const notes = s.notes.slice(0, 6)
  const hide = () => {
    try {
      localStorage.setItem(DISMISS_KEY, want)
    } catch {
      /* 저장 못 해도 이번엔 닫는다 */
    }
    setLater(want)
  }
  return (
    <aside className="update-card" role="status" aria-live="polite" aria-label={`새 버전 v${s.version} 출시`}>
      <div className="update-card-head">
        <b>v{s.version} 출시</b>
        <span className="muted small">지금 {s.current}</span>
      </div>
      {notes.length > 0 ? (
        <ul className="update-notes">
          {notes.map((n, i) => (n.startsWith('• ') ? <li key={i}>{n.slice(2)}</li> : <li key={i} className="h">{n}</li>))}
        </ul>
      ) : (
        <p className="muted small">새 버전을 받아 두었습니다.</p>
      )}
      {s.notesUrl && (
        <button type="button" className="link small" onClick={() => void call('shell:openExternal', s.notesUrl!)}>
          변경점 전체 보기
        </button>
      )}
      <div className="update-card-actions">
        <button type="button" className="primary small" disabled={s.restarting} onClick={() => void restartToUpdate().catch((e) => toast(errorText(e)))}>
          {s.restarting ? '저장 마무리 중…' : '지금 재시작'}
        </button>
        <button type="button" className="small" disabled={s.restarting} onClick={hide}>
          나중에
        </button>
      </div>
      <small className="muted">나중에를 누르면 다음에 앱을 끌 때 설치됩니다.</small>
    </aside>
  )
}

/** 설정 화면 카드: 지금 버전, 마지막 확인 시각·결과, 지금 확인, 재시작 */
export function UpdateSettings() {
  const s = useUpdates()
  const { toast } = useApp()
  const [busy, setBusy] = useState(false)
  if (!s) return null
  const check = () => {
    setBusy(true)
    checkUpdates()
      .catch((e) => toast(errorText(e)))
      .finally(() => setBusy(false))
  }
  const stateText =
    s.state === 'checking'
      ? '확인하는 중…'
      : s.state === 'downloading'
        ? `새 버전 ${s.version} 받는 중${s.percent !== null ? ` (${s.percent}%)` : ''}`
        : s.state === 'ready'
          ? `새 버전 ${s.version} 준비됨`
          : s.state === 'latest'
            ? '최신 버전입니다'
            : s.state === 'error'
              ? '마지막 확인이 실패했습니다'
              : ''
  return (
    <div className="card" id="update-settings">
      <h2>업데이트</h2>
      <p>
        지금 버전 <b>{s.current}</b>
        {stateText && <> · {stateText}</>}
      </p>
      {s.state === 'disabled' ? (
        <p className="muted small">{s.detail}</p>
      ) : (
        <p className="muted small">
          앱을 켤 때·창에 돌아올 때·15분마다 새 버전을 확인해 뒤에서 받아 둡니다. 마지막 확인: {when(s.lastCheckedAt)}
          {s.lastResult && <> · {s.lastResult}</>}
          {s.state === 'error' && s.detail && <> · {s.detail}</>}
        </p>
      )}
      <div className="row">
        {s.state === 'ready' ? (
          <button type="button" className="primary" disabled={s.restarting} onClick={() => void restartToUpdate().catch((e) => toast(errorText(e)))}>
            {s.restarting ? '저장 마무리 중…' : `새 버전 ${s.version} 준비됨 · 재시작`}
          </button>
        ) : (
          <button type="button" disabled={busy || s.state === 'disabled' || s.state === 'checking' || s.state === 'downloading'} onClick={check}>
            지금 확인
          </button>
        )}
        <button type="button" className="link" onClick={() => void call('shell:openExternal', RELEASES_URL)}>
          릴리스 페이지 (직접 내려받기)
        </button>
      </div>
    </div>
  )
}
