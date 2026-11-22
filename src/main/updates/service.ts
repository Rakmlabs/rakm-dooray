import { app } from 'electron'
import { appendFileSync, mkdirSync, statSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types-updates'
import { TEST_BUILD } from '../buildFlags'
import { jsonStore } from '../store'
import { UPDATE_FEED, type UpdateFeed } from './feed'

/**
 * 자동 업데이트 (electron-updater → 맥은 Squirrel.Mac).
 * - 앱을 켜고 조금 뒤, 그 뒤로 4시간마다 확인한다. 새 버전이 있으면 뒤에서 받는다.
 * - 다 받으면 화면 위 띠·설정 화면에서 "재시작". 재시작하지 않으면 다음에 앱을 끌 때 설치된다 (autoInstallOnAppQuit).
 * - 받은 zip 은 Squirrel.Mac 이 "지금 앱과 같은 서명(Developer ID·팀)"인지 확인한 뒤에만 바꿔 끼운다. 이 확인은 끄지 않는다.
 * - 오류는 화면에 띄우지 않고 userData/logs/updates.log 에 남기고, 설정 화면에 마지막 확인 시각·결과만 보인다.
 * - 개발 실행과 피드가 정해지지 않은 빌드에서는 확인하지 않는다.
 */

const FIRST_CHECK_MS = 15_000
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000
const RESTART_PREP_MS = 15_000
const LOG_LIMIT = 512 * 1024

export interface UpdateDeps {
  emit: (s: UpdateStatus) => void
  /** 재시작 전에 마무리할 일 (위키 자동 저장, 읽음 위치 쓰기) */
  beforeRestart: () => Promise<void>
  /** 창 닫기를 "숨기기"가 아니라 진짜 종료로 (index.ts 의 quitting 표시) */
  markQuitting: () => void
}

interface Saved {
  lastCheckedAt: string | null
  lastResult: string | null
}

/** 쓸 피드: 시험 빌드면 빌드에 박힌 로컬 피드(또는 'real' = 실제 피드), 아니면 feed.ts 의 상수 */
export function effectiveFeed(): UpdateFeed | null {
  if (TEST_BUILD) {
    // 'real': 시험 빌드로 실제 피드(GitHub 릴리스)를 읽어 본다
    if (TEST_BUILD.updateFeed === 'real') return UPDATE_FEED
    return TEST_BUILD.updateFeed ? { provider: 'generic', url: TEST_BUILD.updateFeed } : null
  }
  return UPDATE_FEED
}

export class UpdateService {
  private readonly store = jsonStore<Saved>('updates.json', { lastCheckedAt: null, lastResult: null })
  private status: UpdateStatus
  private timer: NodeJS.Timeout | null = null
  private checking: Promise<void> | null = null

  constructor(private readonly deps: UpdateDeps) {
    const saved = this.store.read()
    this.status = {
      state: 'idle',
      current: app.getVersion(),
      version: null,
      percent: null,
      detail: '',
      lastCheckedAt: saved.lastCheckedAt,
      lastResult: saved.lastResult,
      restarting: false
    }
  }

  start(): void {
    const feed = effectiveFeed()
    if (!app.isPackaged) return this.set({ state: 'disabled', detail: '개발 실행에서는 업데이트를 확인하지 않습니다.' })
    if (!feed) return this.set({ state: 'disabled', detail: '업데이트를 받을 곳이 아직 정해지지 않았습니다. 새 버전은 아래 "새 버전 내려받기"에서 받으세요.' })
    try {
      this.configure(feed)
    } catch (e) {
      this.log('error', `설정 실패: ${msg(e)}`)
      return this.set({ state: 'disabled', detail: `업데이트를 설정하지 못했습니다: ${msg(e)}` })
    }
    setTimeout(() => void this.check(), FIRST_CHECK_MS)
    this.timer = setInterval(() => void this.check(), CHECK_EVERY_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  get(): UpdateStatus {
    return this.status
  }

  /** 지금 확인. 받는 중이거나 이미 받아 뒀으면 그대로 둔다 */
  async check(): Promise<UpdateStatus> {
    const s = this.status.state
    if (s === 'disabled' || s === 'downloading' || s === 'ready') return this.status
    if (!this.checking) {
      this.checking = (async () => {
        try {
          await autoUpdater.checkForUpdates()
        } catch (e) {
          this.fail(e)
        } finally {
          this.checking = null
        }
      })()
    }
    await this.checking
    return this.status
  }

  /** 받아 둔 새 버전으로 재시작. 보류 중인 저장을 끝낸 뒤 */
  async restart(): Promise<void> {
    if (this.status.state !== 'ready' || this.status.restarting) return
    this.set({ restarting: true })
    this.log('info', `재시작 준비 (${this.status.version})`)
    await Promise.race([this.deps.beforeRestart().catch((e) => this.log('warn', `마무리 중 오류: ${msg(e)}`)), sleep(RESTART_PREP_MS)])
    this.deps.markQuitting()
    // isSilent 는 윈도용, isForceRunAfter=true: 설치 뒤 다시 켠다
    autoUpdater.quitAndInstall(false, true)
  }

  // ---------- 내부 ----------

  private configure(feed: UpdateFeed): void {
    // electron-updater 는 피드·캐시 폴더 이름을 app-update.yml 에서 읽는다. 빌드에 넣지 않고 여기서 만든다 (피드는 feed.ts 한 곳에서 정하도록)
    const dir = join(app.getPath('userData'), 'updater')
    mkdirSync(dir, { recursive: true })
    const cfg = join(dir, 'app-update.yml')
    const cacheName = TEST_BUILD ? 'rakm-dooray-test-updater' : 'rakm-dooray-updater'
    const where = feed.provider === 'github' ? `owner: ${feed.owner}\nrepo: ${feed.repo}\n` : `url: ${JSON.stringify(feed.url)}\n`
    writeFileSync(cfg, `provider: ${feed.provider}\n${where}updaterCacheDirName: ${cacheName}\n`)
    autoUpdater.updateConfigPath = cfg
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowDowngrade = false
    autoUpdater.logger = {
      info: (m: unknown) => this.log('info', String(m)),
      warn: (m: unknown) => this.log('warn', String(m)),
      error: (m: unknown) => this.log('error', String(m)),
      debug: () => {}
    }

    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking', detail: '' }))
    autoUpdater.on('update-not-available', (info) => {
      this.done(`최신 버전입니다 (${info?.version ?? this.status.current})`)
      this.set({ state: 'latest', version: null, percent: null })
    })
    autoUpdater.on('update-available', (info) => {
      this.done(`새 버전 ${info.version} 을 받는 중`)
      this.set({ state: 'downloading', version: info.version, percent: 0 })
    })
    autoUpdater.on('download-progress', (p) => this.set({ percent: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (info) => {
      this.log('info', `받기 끝: ${info.version}`)
      this.done(`새 버전 ${info.version} 준비됨 (재시작하거나 다음에 앱을 끌 때 설치)`)
      this.set({ state: 'ready', version: info.version, percent: 100 })
    })
    autoUpdater.on('error', (e) => this.fail(e))
  }

  private fail(e: unknown): void {
    this.log('error', msg(e))
    // 이미 받아 둔 것은 그대로 쓸 수 있다
    if (this.status.state === 'ready') return
    this.done(`확인 실패: ${friendly(msg(e))}`)
    this.set({ state: 'error', percent: null, restarting: false, detail: '다음 확인 때 다시 시도합니다.' })
  }

  private done(result: string): void {
    const saved: Saved = { lastCheckedAt: new Date().toISOString(), lastResult: result }
    this.store.write(saved)
    this.set(saved)
  }

  private set(patch: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...patch }
    this.deps.emit(this.status)
  }

  private log(level: string, text: string): void {
    try {
      const dir = join(app.getPath('userData'), 'logs')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, 'updates.log')
      try {
        if (statSync(file).size > LOG_LIMIT) renameSync(file, file + '.1')
      } catch {
        /* 아직 없음 */
      }
      appendFileSync(file, `${new Date().toISOString()} [${level}] ${text.replace(/\s+/g, ' ').slice(0, 2000)}\n`)
    } catch {
      /* 기록 실패는 무시 */
    }
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
/** 설정 화면에 보일 짧은 사유 (원문은 updates.log 에) */
export function friendly(m: string): string {
  if (/\b404\b/.test(m)) return '릴리스를 찾지 못했습니다 (404). 저장소가 비공개이거나 아직 릴리스가 없습니다.'
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|net::ERR_/i.test(m)) return '업데이트 서버에 연결할 수 없습니다.'
  if (/sha512|checksum/i.test(m)) return '받은 파일이 손상돼 버렸습니다. 다음 확인 때 다시 받습니다.'
  if (/signature|code ?sign|designated requirement/i.test(m)) return '새 버전의 서명이 맞지 않아 설치하지 않았습니다.'
  const first = m.split('\n')[0].replace(/^Error:\s*/, '')
  return first.length > 100 ? first.slice(0, 97) + '…' : first
}
