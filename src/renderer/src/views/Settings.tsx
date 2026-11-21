import { useEffect, useState } from 'react'
import type { SecretSource, TestResult } from '@shared/types'
import { call, errorText } from '../api'
import { useApp } from '../state'

const API_BASES = [
  { value: 'https://api.dooray.com', label: '민간 클라우드 (api.dooray.com)' },
  { value: 'https://api.gov-dooray.com', label: '공공 클라우드 (api.gov-dooray.com)' },
  { value: 'https://api.gov-dooray.co.kr', label: '공공 업무망 (api.gov-dooray.co.kr)' },
  { value: 'https://api.dooray.co.kr', label: '금융 클라우드 (api.dooray.co.kr)' }
]

function sourceText(s: SecretSource): string {
  if (s === 'keychain') return '저장됨 (OS 키체인 암호화)'
  if (s === 'env') return '개발용 .env 에서 읽는 중'
  return '없음'
}

export function SettingsView() {
  const { settings, reloadSettings, toast, realtime } = useApp()
  const [apiBase, setApiBase] = useState('https://api.dooray.com')
  const [domain, setDomain] = useState('')
  const [pollSeconds, setPollSeconds] = useState(4)
  const [token, setToken] = useState('')
  const [address, setAddress] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [imapHost, setImapHost] = useState('imap.dooray.com')
  const [imapPort, setImapPort] = useState(993)
  const [smtpHost, setSmtpHost] = useState('smtp.dooray.com')
  const [smtpPort, setSmtpPort] = useState(465)
  const [busy, setBusy] = useState<'' | 'dooray' | 'mail'>('')
  const [doorayTest, setDoorayTest] = useState<TestResult | null>(null)
  const [mailTest, setMailTest] = useState<TestResult | null>(null)

  useEffect(() => {
    if (!settings) return
    setApiBase(settings.dooray.apiBase)
    setDomain(settings.dooray.domain)
    setPollSeconds(settings.dooray.pollSeconds)
    setAddress(settings.mail.address)
    setDisplayName(settings.mail.displayName)
    setImapHost(settings.mail.imapHost)
    setImapPort(settings.mail.imapPort)
    setSmtpHost(settings.mail.smtpHost)
    setSmtpPort(settings.mail.smtpPort)
  }, [settings])

  if (!settings) return <div className="empty">불러오는 중…</div>

  async function saveDooray(e: { preventDefault(): void }) {
    e.preventDefault()
    setBusy('dooray')
    setDoorayTest(null)
    try {
      await call('settings:save', {
        dooray: { apiBase, domain, pollSeconds, ...(token ? { token } : {}) }
      })
      setToken('')
      await reloadSettings()
      setDoorayTest(await call('settings:testDooray'))
    } catch (err) {
      toast(errorText(err))
    } finally {
      setBusy('')
    }
  }

  async function saveMail(e: { preventDefault(): void }) {
    e.preventDefault()
    setBusy('mail')
    setMailTest(null)
    try {
      await call('settings:save', {
        mail: { address, displayName, imapHost, imapPort, smtpHost, smtpPort, ...(password ? { password } : {}) }
      })
      setPassword('')
      await reloadSettings()
      setMailTest(await call('settings:testMail'))
    } catch (err) {
      toast(errorText(err))
    } finally {
      setBusy('')
    }
  }

  async function removeSecret(kind: 'token' | 'password') {
    if (!window.confirm(kind === 'token' ? '저장된 두레이 토큰을 지울까요?' : '저장된 메일 비밀번호를 지울까요?')) return
    try {
      await call('settings:save', kind === 'token' ? { dooray: { token: null } } : { mail: { password: null } })
      await reloadSettings()
    } catch (err) {
      toast(errorText(err))
    }
  }

  return (
    <div className="settings">
      <h1>설정</h1>
      <p className="muted">
        토큰과 비밀번호는 이 컴퓨터의 OS 키체인으로 암호화해 저장하고, 화면에 다시 보여주지 않습니다. 서버로 보내는 곳은 두레이뿐입니다.
      </p>
      {!settings.secureStorage && (
        <div className="banner banner-warn">
          이 컴퓨터에서 OS 키체인 암호화를 쓸 수 없어 토큰·비밀번호를 저장할 수 없습니다. (리눅스라면 GNOME Keyring 이나 KWallet 이 필요합니다.)
        </div>
      )}

      <form className="card" onSubmit={saveDooray}>
        <h2>두레이 API</h2>
        <label>
          <span>클라우드</span>
          <select value={apiBase} onChange={(e) => setApiBase(e.target.value)}>
            {API_BASES.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>개인 API 토큰</span>
          <input
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={settings.dooray.tokenSource === 'none' ? '두레이 개인설정 > API > 개인 인증 토큰' : '바꿀 때만 입력'}
          />
          <small>
            현재: {sourceText(settings.dooray.tokenSource)}
            {settings.dooray.tokenSource === 'keychain' && (
              <button type="button" className="link" onClick={() => void removeSecret('token')}>
                지우기
              </button>
            )}
          </small>
        </label>
        <label>
          <span>회사 도메인 (선택)</span>
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="예: mycompany.dooray.com" />
          <small>
            입력하면 실시간 수신(Socket Mode)을 시도합니다. 개인 토큰으로는 안 될 수 있으며, 그 경우 자동으로 폴링합니다. 현재 상태:{' '}
            {realtime.mode === 'socket' ? '실시간 연결됨' : realtime.detail || '폴링'}
          </small>
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
        </label>
        <div className="row">
          <button className="primary" disabled={busy !== ''}>
            {busy === 'dooray' ? '저장하고 확인하는 중…' : '저장하고 연결 확인'}
          </button>
          {doorayTest && <span className={doorayTest.ok ? 'ok' : 'err'}>{doorayTest.message}</span>}
        </div>
      </form>

      <form className="card" onSubmit={saveMail}>
        <h2>메일 (IMAP / SMTP)</h2>
        <p className="muted">
          두레이 메일은 IMAP 으로 읽고 SMTP 로 보냅니다. 메일 포함 Business 플랜 이상이어야 하고, 관리자가 IMAP 을 허용해야 합니다. 비밀번호는 두레이
          웹의 <b>설정 &gt; 메일 &gt; IMAP</b> 화면에 나오는 값을 넣으세요 (SSO 회사는 그 화면에서 발급한 비밀번호 키).
        </p>
        <label>
          <span>메일 주소</span>
          <input type="email" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="me@company.com" />
        </label>
        <label>
          <span>보내는 사람 이름</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="홍길동" />
        </label>
        <label>
          <span>IMAP 비밀번호</span>
          <input
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={settings.mail.passwordSource === 'none' ? '설정 > 메일 > IMAP 의 비밀번호' : '바꿀 때만 입력'}
          />
          <small>
            현재: {sourceText(settings.mail.passwordSource)}
            {settings.mail.passwordSource === 'keychain' && (
              <button type="button" className="link" onClick={() => void removeSecret('password')}>
                지우기
              </button>
            )}
          </small>
        </label>
        <div className="grid2">
          <label>
            <span>IMAP 서버</span>
            <input value={imapHost} onChange={(e) => setImapHost(e.target.value)} />
          </label>
          <label>
            <span>포트</span>
            <input type="number" value={imapPort} onChange={(e) => setImapPort(Number(e.target.value))} />
          </label>
          <label>
            <span>SMTP 서버</span>
            <input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
          </label>
          <label>
            <span>포트</span>
            <input type="number" value={smtpPort} onChange={(e) => setSmtpPort(Number(e.target.value))} />
          </label>
        </div>
        <div className="row">
          <button className="primary" disabled={busy !== ''}>
            {busy === 'mail' ? '저장하고 확인하는 중…' : '저장하고 연결 확인'}
          </button>
          {mailTest && <span className={mailTest.ok ? 'ok' : 'err'}>{mailTest.message}</span>}
        </div>
      </form>

      <div className="card">
        <h2>단축키</h2>
        <ul className="keys">
          <li>
            <kbd>⌘/Ctrl 1·2·3</kbd> 메신저·메일·위키
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
