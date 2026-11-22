import { useState } from 'react'
import type { SecretSource, TestResult } from '@shared/types'
import { call, errorText } from '../api'
import { TOKEN_URL } from '@shared/company'
import { useApp } from '../state'
import { ChatSettings } from '../components/chat/ChatSettings'
import { FileSettings } from '../components/files/FileSettings'
import { ReceiptsSettings } from '../components/ReceiptsSettings'
import { UpdateSettings } from '../components/UpdateSettings'
import { AppearanceSettings, NotificationSettings, Shortcuts, StorageSettings, WindowSettings } from '../shell/ShellSettings'

/** 새 버전은 여기서 내려받는다 (비공개 저장소라 자동 업데이트는 하지 않는다) */
/** 개인 API 토큰 발급 화면 (두레이 웹) */

// 메일 설정(IMAP/SMTP)은 지금 쓰지 않아 화면에서 뺐다 (Free 플랜이라 IMAP 불가). main 쪽 코드와 IPC 는 남아 있다.

function sourceText(s: SecretSource): string {
  if (s === 'keychain') return '저장됨 (OS 키체인 암호화)'
  if (s === 'env') return '개발용 .env 에서 읽는 중'
  return '없음'
}

/** HTTP 헤더에 넣을 수 있는 문자만 (main 의 isValidToken 과 같은 규칙) */
const TOKEN_OK = /^[\x21-\x7E]+$/

export function SettingsView() {
  const { settings, reloadSettings, toast, realtime } = useApp()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [doorayTest, setDoorayTest] = useState<TestResult | null>(null)

  if (!settings) return <div className="empty">불러오는 중…</div>

  const trimmed = token.trim()
  const noToken = settings.dooray.tokenSource === 'none'
  const tokenError = trimmed && !TOKEN_OK.test(trimmed) ? '토큰에 한글이나 공백이 섞였습니다. 발급받은 토큰만 그대로 붙여 넣으세요.' : null

  async function save(e: { preventDefault(): void }) {
    e.preventDefault()
    if (tokenError) return
    setBusy(true)
    setDoorayTest(null)
    try {
      if (trimmed) await call('settings:save', { dooray: { token: trimmed } })
      setToken('')
      await reloadSettings()
      setDoorayTest(await call('settings:testDooray'))
    } catch (err) {
      toast(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  async function removeToken() {
    if (!window.confirm('저장된 두레이 토큰을 지울까요?')) return
    try {
      await call('settings:save', { dooray: { token: null } })
      await reloadSettings()
    } catch (err) {
      toast(errorText(err))
    }
  }

  return (
    <div className="settings">
      <h1>설정</h1>
      <p className="muted">
        <b>{settings.dooray.domain}</b> 에 연결합니다. 토큰은 OS 키체인으로 암호화해 이 컴퓨터에만 저장합니다.
      </p>
      <UpdateSettings />
      {!settings.secureStorage && (
        <div className="banner banner-warn">
          이 컴퓨터에서 OS 키체인 암호화를 쓸 수 없어 토큰을 저장할 수 없습니다. (리눅스라면 GNOME Keyring 이나 KWallet 이 필요합니다.)
        </div>
      )}

      <form className={`card token-card ${noToken ? 'token-card-first' : ''}`} onSubmit={save}>
        <h2>{noToken ? '두레이 개인 API 토큰을 넣어 시작하세요' : '두레이 연결'}</h2>
        <div className="token-help">
          <ol>
            <li>
              <button type="button" className={noToken ? 'primary' : ''} onClick={() => void call('shell:openExternal', TOKEN_URL)}>
                여기서 발급
              </button>
              을 눌러 두레이 웹의 토큰 화면을 엽니다.
            </li>
            <li>“토큰 생성”을 눌러 새 토큰을 만듭니다.</li>
            <li>만든 토큰을 복사해 아래 칸에 붙여 넣고 “저장하고 연결 확인”을 누릅니다.</li>
          </ol>
          <small className="muted">{TOKEN_URL.replace('https://', '')} · 로그인한 내 계정으로 발급됩니다.</small>
        </div>
        <label>
          <span>개인 API 토큰</span>
          <input
            type="password"
            autoComplete="off"
            autoFocus={noToken}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            aria-invalid={!!tokenError}
            placeholder={noToken ? '복사한 토큰을 여기에 붙여 넣기' : '바꿀 때만 입력'}
          />
          {tokenError ? (
            <small className="err">{tokenError}</small>
          ) : (
            <small>
              현재: {sourceText(settings.dooray.tokenSource)}
              {settings.dooray.tokenSource === 'keychain' && (
                <button type="button" className="link" onClick={() => void removeToken()}>
                  지우기
                </button>
              )}
              {' · '}수신 방식: {realtime.mode === 'socket' ? '실시간 연결됨' : '자동 새로고침'}
            </small>
          )}
        </label>
        <div className="row">
          <button className="primary" disabled={busy || !!tokenError || (noToken && !trimmed)}>
            {busy ? '저장하고 확인하는 중…' : '저장하고 연결 확인'}
          </button>
          {doorayTest && <span className={doorayTest.ok ? 'ok' : 'err'}>{doorayTest.message}</span>}
        </div>
      </form>

      <AppearanceSettings />
      <NotificationSettings />
      <ReceiptsSettings />
      <ChatSettings />
      <FileSettings />
      <WindowSettings />
      <StorageSettings />
      <Shortcuts />
    </div>
  )
}
