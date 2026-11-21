import { useEffect, useState } from 'react'
import type { SecretSource, TestResult } from '@shared/types'
import { call, errorText } from '../api'
import { useApp } from '../state'
import { ChatSettings } from '../components/chat/ChatSettings'
import { FileSettings } from '../components/files/FileSettings'

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
  const [pollSeconds, setPollSeconds] = useState(4)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [doorayTest, setDoorayTest] = useState<TestResult | null>(null)

  useEffect(() => {
    if (settings) setPollSeconds(settings.dooray.pollSeconds)
  }, [settings])

  if (!settings) return <div className="empty">불러오는 중…</div>

  const trimmed = token.trim()
  const tokenError = trimmed && !TOKEN_OK.test(trimmed) ? '토큰에 한글이나 공백이 섞였습니다. 발급받은 토큰만 그대로 붙여 넣으세요.' : null

  async function save(e: { preventDefault(): void }) {
    e.preventDefault()
    if (tokenError) return
    setBusy(true)
    setDoorayTest(null)
    try {
      await call('settings:save', { dooray: { pollSeconds, ...(trimmed ? { token: trimmed } : {}) } })
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
      {!settings.secureStorage && (
        <div className="banner banner-warn">
          이 컴퓨터에서 OS 키체인 암호화를 쓸 수 없어 토큰을 저장할 수 없습니다. (리눅스라면 GNOME Keyring 이나 KWallet 이 필요합니다.)
        </div>
      )}

      <form className="card" onSubmit={save}>
        <h2>두레이 연결</h2>
        <label>
          <span>개인 API 토큰</span>
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            aria-invalid={!!tokenError}
            placeholder={settings.dooray.tokenSource === 'none' ? '두레이 개인설정 > API > 개인 인증 토큰' : '바꿀 때만 입력'}
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
            </small>
          )}
        </label>
        <label>
          <span>열린 대화방 새로고침 간격 (초)</span>
          <input
            type="number"
            min={2}
            max={60}
            value={pollSeconds}
            onChange={(e) => setPollSeconds(Number(e.target.value) || 4)}
          />
          <small>수신 방식: {realtime.mode === 'socket' ? '실시간 연결됨' : realtime.detail || '폴링'}</small>
        </label>
        <div className="row">
          <button className="primary" disabled={busy || !!tokenError}>
            {busy ? '저장하고 확인하는 중…' : '저장하고 연결 확인'}
          </button>
          {doorayTest && <span className={doorayTest.ok ? 'ok' : 'err'}>{doorayTest.message}</span>}
        </div>
      </form>

      <ChatSettings />
      <FileSettings />

      <div className="card">
        <h2>단축키</h2>
        <ul className="keys">
          <li>
            <kbd>⌘/Ctrl 1·2</kbd> 메신저·위키
          </li>
          <li>
            <kbd>⌘/Ctrl ,</kbd> 설정
          </li>
          <li>
            <kbd>Enter</kbd> 보내기, <kbd>Shift+Enter</kbd> 줄바꿈
          </li>
          <li>
            <kbd>Esc</kbd> 답장·수정·스레드 닫기
          </li>
        </ul>
      </div>
    </div>
  )
}
