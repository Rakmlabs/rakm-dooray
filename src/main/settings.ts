import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { PublicSettings, SecretSource, SettingsInput, UiState } from '@shared/types'
import { parseDotEnv } from './dotenv'
import { INVALID_TOKEN_MESSAGE, isValidToken } from './dooray/http'

/**
 * 설정 저장소.
 * - 일반 설정: userData/settings.json (평문)
 * - 비밀 값(두레이 토큰, 메일 비밀번호): userData/secrets.json 에 safeStorage(OS 키체인) 로 암호화한 base64 만 저장
 * - 개발 모드(패키징 안 된 실행)에서 비밀 값이 저장돼 있지 않으면 프로젝트 루트 .env 를 읽는다
 * 비밀 값은 renderer 로 보내지 않고, 로그에도 남기지 않는다.
 */

/** 이 앱은 한 회사(rakm)만 쓴다. 도메인과 API 주소(민간 클라우드)는 고정이고 설정에서 바꾸지 않는다. */
export const DOORAY_DOMAIN = 'rakm.dooray.com'
export const DOORAY_API_BASE = 'https://api.dooray.com'

interface StoredSettings {
  dooray: { apiBase: string; domain: string }
  mail: {
    address: string
    displayName: string
    imapHost: string
    imapPort: number
    smtpHost: string
    smtpPort: number
  }
}

type SecretKey = 'doorayToken' | 'mailPassword'

const DEFAULTS: StoredSettings = {
  dooray: { apiBase: DOORAY_API_BASE, domain: DOORAY_DOMAIN },
  mail: {
    address: '',
    displayName: '',
    imapHost: 'imap.dooray.com',
    imapPort: 993,
    smtpHost: 'smtp.dooray.com',
    smtpPort: 465
  }
}

const DEFAULT_UI: UiState = { projects: [], channelProject: {}, lastSeenAt: {}, hiddenChannels: [] }

function dir(): string {
  const d = app.getPath('userData')
  mkdirSync(d, { recursive: true })
  return d
}

function readJson<T>(file: string, fallback: T): T {
  const p = join(dir(), file)
  if (!existsSync(p)) return fallback
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(join(dir(), file), JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 })
}

let envCache: Record<string, string> | null = null
function devEnv(): Record<string, string> {
  if (app.isPackaged) return {}
  if (!envCache) {
    const p = join(process.cwd(), '.env')
    envCache = existsSync(p) ? parseDotEnv(readFileSync(p, 'utf8')) : {}
  }
  return envCache
}

/**
 * 개발 전용 모의 서버 주소 (scripts/mock-dooray.mjs). 패키징된 앱에서는 무시한다.
 * 실제 토큰 없이 화면을 확인할 때만 쓴다.
 */
export function mockBase(): string | null {
  if (app.isPackaged) return null
  const v = process.env.DOORAY_MOCK_BASE
  return v && /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(v) ? v : null
}

export async function secureStorageAvailable(): Promise<boolean> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return false
  // 리눅스에서 키링이 없으면 'basic_text'(사실상 평문) 백엔드가 선택된다. 그 경우는 안전하지 않다고 본다.
  if (process.platform === 'linux') {
    const backend = safeStorage.getSelectedStorageBackend?.()
    if (backend === 'basic_text' || backend === 'unknown') return false
  }
  return true
}

function loadStored(): StoredSettings {
  const raw = readJson<Partial<StoredSettings>>('settings.json', {})
  const env = devEnv()
  const s: StoredSettings = {
    dooray: { ...DEFAULTS.dooray, ...(raw.dooray ?? {}) },
    mail: { ...DEFAULTS.mail, ...(raw.mail ?? {}) }
  }
  // 예전 버전에서 저장한 도메인·API 주소가 남아 있어도 무시하고 고정값을 쓴다
  s.dooray.apiBase = DOORAY_API_BASE
  s.dooray.domain = DOORAY_DOMAIN
  // 새로고침 간격은 이제 코드에 고정이다 (src/renderer/src/lib/hooks.ts). 예전에 저장한 값은 무시한다.
  delete (s.dooray as { pollSeconds?: unknown }).pollSeconds
  // 저장된 값이 없을 때만 개발용 .env 로 채운다
  if (!raw.mail?.address && env.MAIL_ADDRESS) s.mail.address = env.MAIL_ADDRESS
  if (!raw.mail?.imapHost && env.MAIL_IMAP_HOST) s.mail.imapHost = env.MAIL_IMAP_HOST
  if (!raw.mail?.imapPort && env.MAIL_IMAP_PORT) s.mail.imapPort = Number(env.MAIL_IMAP_PORT)
  if (!raw.mail?.smtpHost && env.MAIL_SMTP_HOST) s.mail.smtpHost = env.MAIL_SMTP_HOST
  if (!raw.mail?.smtpPort && env.MAIL_SMTP_PORT) s.mail.smtpPort = Number(env.MAIL_SMTP_PORT)
  const mock = mockBase()
  if (mock) s.dooray.apiBase = mock
  return s
}

function readSecrets(): Partial<Record<SecretKey, string>> {
  return readJson<Partial<Record<SecretKey, string>>>('secrets.json', {})
}

// 복호화한 값은 메모리에만 둔다 (키체인 접근을 줄이기 위해). 파일·로그로는 나가지 않는다.
const secretCache = new Map<SecretKey, string | null>()

async function storedSecret(key: SecretKey): Promise<string | null> {
  if (secretCache.has(key)) return secretCache.get(key) ?? null
  const enc = readSecrets()[key]
  let value: string | null = null
  if (enc && (await safeStorage.isAsyncEncryptionAvailable())) {
    try {
      value = (await safeStorage.decryptStringAsync(Buffer.from(enc, 'base64'))).result
    } catch {
      value = null
    }
  }
  secretCache.set(key, value)
  return value
}

const ENV_KEYS: Record<SecretKey, string> = { doorayToken: 'DOORAY_TOKEN', mailPassword: 'MAIL_PASSWORD' }

async function secretWithSource(key: SecretKey): Promise<{ value: string | null; source: SecretSource }> {
  if (key === 'doorayToken' && mockBase()) return { value: 'mock-token', source: 'env' }
  const stored = await storedSecret(key)
  if (stored) return { value: stored, source: 'keychain' }
  const envValue = devEnv()[ENV_KEYS[key]]
  if (envValue) return { value: envValue, source: 'env' }
  return { value: null, source: 'none' }
}

export async function getSecret(key: SecretKey): Promise<string | null> {
  return (await secretWithSource(key)).value
}

async function setSecret(key: SecretKey, value: string | null): Promise<void> {
  const secrets = readSecrets()
  if (value === null || value === '') {
    delete secrets[key]
  } else {
    if (!(await secureStorageAvailable())) {
      throw new Error('이 컴퓨터에서 OS 키체인 암호화를 쓸 수 없어 비밀 값을 저장하지 않았습니다.')
    }
    secrets[key] = (await safeStorage.encryptStringAsync(value)).toString('base64')
  }
  writeJson('secrets.json', secrets)
  secretCache.delete(key)
}

export function getSettings(): StoredSettings {
  return loadStored()
}

export async function getPublicSettings(): Promise<PublicSettings> {
  const s = loadStored()
  return {
    dooray: { ...s.dooray, tokenSource: (await secretWithSource('doorayToken')).source },
    mail: { ...s.mail, passwordSource: (await secretWithSource('mailPassword')).source },
    secureStorage: await secureStorageAvailable()
  }
}

export async function saveSettings(input: SettingsInput): Promise<PublicSettings> {
  const current = readJson<Partial<StoredSettings>>('settings.json', {})
  const next: StoredSettings = {
    dooray: { ...DEFAULTS.dooray, ...(current.dooray ?? {}) },
    mail: { ...DEFAULTS.mail, ...(current.mail ?? {}) }
  }
  if (input.dooray) {
    delete (next.dooray as { pollSeconds?: unknown }).pollSeconds
    const { token } = input.dooray
    if (token !== undefined && token !== null) {
      const t = token.trim()
      // 붙여 넣다 한글·공백이 섞이면 저장하지 않는다 (그대로 두면 모든 호출이 ByteString 오류로 실패한다)
      if (t && !isValidToken(t)) throw new Error(INVALID_TOKEN_MESSAGE)
      await setSecret('doorayToken', t)
    } else if (token === null) {
      await setSecret('doorayToken', null)
    }
  }
  if (input.mail) {
    const { password, ...rest } = input.mail
    next.mail = { ...next.mail, ...rest }
    if (password !== undefined) await setSecret('mailPassword', password)
  }
  writeJson('settings.json', next)
  return getPublicSettings()
}

export function getUiState(): UiState {
  const raw = readJson<Partial<UiState>>('ui-state.json', {})
  return { ...DEFAULT_UI, ...raw }
}

export function saveUiState(state: UiState): UiState {
  writeJson('ui-state.json', state)
  return getUiState()
}
