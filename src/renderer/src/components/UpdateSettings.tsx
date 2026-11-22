import { useState } from 'react'
import { call, errorText } from '../api'
import { useApp } from '../state'
import { checkUpdates, restartToUpdate, useUpdates } from '../lib/updates'

const RELEASES_URL = 'https://github.com/Rakmlabs/rakm-dooray/releases'

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR') : '없음')

/** 화면 위 띠: 새 버전을 다 받았을 때만 */
export function UpdateBar() {
  const s = useUpdates()
  const { toast } = useApp()
  if (s?.state !== 'ready') return null
  return (
    <div className="update-bar" role="status">
      <span>
        새 버전 <b>{s.version}</b> 준비됨
      </span>
      <button type="button" className="primary small" disabled={s.restarting} onClick={() => void restartToUpdate().catch((e) => toast(errorText(e)))}>
        {s.restarting ? '저장 마무리 중…' : '재시작'}
      </button>
      <small className="muted">재시작하지 않으면 다음에 앱을 끌 때 설치됩니다.</small>
    </div>
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
          앱을 켤 때와 4시간마다 새 버전을 확인해 뒤에서 받아 둡니다. 마지막 확인: {when(s.lastCheckedAt)}
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
