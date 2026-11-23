import { app, BrowserWindow, Notification, powerMonitor } from 'electron'
import { appendFileSync, mkdirSync, statSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/types-updates'
import { TEST_BUILD } from '../buildFlags'
import { jsonStore } from '../store'
import { UPDATE_FEED, type UpdateFeed } from './feed'

/**
 * 자동 업데이트 (electron-updater → 맥은 Squirrel.Mac).
 * - 앱을 켜고 조금 뒤, 그 뒤로 15분마다, 그리고 창에 돌아올 때·잠자기에서 깰 때(직전 확인이 5분보다 오래됐으면) 확인한다.
 *   GitHub 피드는 releases.atom + latest-mac.yml 두 번 받기(API 아님)라 15분 주기로도 레이트리밋에 걸리지 않는다.
 * - 새 버전이 있으면 뒤에서 받고, 다 받으면 macOS 알림 + 앱 안 알림 카드(변경점·지금 재시작·나중에).
 *   재시작하지 않으면 다음에 앱을 끌 때 설치된다 (autoInstallOnAppQuit).
 * - 변경점은 GitHub 릴리스 노트(피드가 주는 releaseNotes)를 줄 글로 바꾼 것.
 * - 받은 zip 은 Squirrel.Mac 이 "지금 앱과 같은 서명(Developer ID·팀)"인지 확인한 뒤에만 바꿔 끼운다. 이 확인은 끄지 않는다.
 * - 오류는 화면에 띄우지 않고 userData/logs/updates.log 에 남기고, 설정 화면에 마지막 확인 시각·결과만 보인다.
 * - 개발 실행과 피드가 정해지지 않은 빌드에서는 확인하지 않는다.
 */

const FIRST_CHECK_MS = 15_000
const CHECK_EVERY_MS = 15 * 60 * 1000
/** 창 포커스·잠자기 깨어남 때는 직전 확인이 이보다 오래됐을 때만 */
const NUDGE_MIN_GAP_MS = 5 * 60 * 1000
/** 잠자기에서 깬 직후는 네트워크가 아직 없을 수 있어 조금 기다린다 */
const RESUME_DELAY_MS = 10_000
const RELEASES_PAGE = 'https://github.com/Rakmlabs/rakm-dooray/releases/tag/v'
const RESTART_PREP_MS = 15_000
const LOG_LIMIT = 512 * 1024

export interface UpdateDeps {
  emit: (s: UpdateStatus) => void
  /** 재시작 전에 마무리할 일 (위키 자동 저장, 읽음 위치 쓰기) */
  beforeRestart: () => Promise<void>
  /** 창 닫기를 "숨기기"가 아니라 진짜 종료로 (index.ts 의 quitting 표시) */
  markQuitting: () => void
  /** macOS 알림을 눌렀을 때 창 보이기 */
  showWindow: () => void
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
      restarting: false,
      notes: [],
      notesUrl: null
    }
  }
  private lastCheckMs = 0
  /** 알림 객체가 GC 되면 클릭이 오지 않아 들고 있는다 */
  private readonly notified = new Set<Notification>()

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
    app.on('browser-window-focus', () => this.nudge())
    powerMonitor.on('resume', () => setTimeout(() => this.nudge(), RESUME_DELAY_MS))
  }

  /** 포커스·깨어남: 직전 확인이 오래됐을 때만 */
  private nudge(): void {
    if (Date.now() - this.lastCheckMs >= NUDGE_MIN_GAP_MS) void this.check()
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
      this.lastCheckMs = Date.now()
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
      const notes = releaseNotesText(info.releaseNotes)
      this.set({ state: 'ready', version: info.version, percent: 100, notes, notesUrl: RELEASES_PAGE + info.version })
      this.notify(info.version, notes)
    })
    autoUpdater.on('error', (e) => this.fail(e))
  }

  /** macOS 알림 한 번 (알림 권한이 꺼져 있으면 macOS 가 조용히 버린다 — 앱 안 카드는 따로 뜬다) */
  private notify(version: string, notes: string[]): void {
    try {
      if (!Notification.isSupported()) return
      const n = new Notification({
        title: `RAKM 두레이 v${version} 출시`,
        body: notes.length ? notes.slice(0, 3).join('\n') : '재시작하면 새 버전으로 바뀝니다. 나중에 앱을 끌 때 설치해도 됩니다.',
        silent: true
      })
      this.notified.add(n)
      n.on('click', () => {
        this.notified.delete(n)
        this.deps.showWindow()
      })
      n.on('close', () => this.notified.delete(n))
      n.show()
    } catch (e) {
      this.log('warn', `알림 실패: ${msg(e)}`)
    }
    // 창이 없거나 숨어 있으면 Dock 아이콘을 한 번 튀게 (macOS)
    if (!BrowserWindow.getAllWindows().some((w) => w.isVisible() && w.isFocused())) app.dock?.bounce('informational')
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
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }
const decode = (t: string) =>
  t.replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })

const NOTES_MAX_LINES = 12
/**
 * 릴리스 노트(GitHub 가 주는 HTML, 또는 마크다운·버전별 배열)를 알림 카드에 보일 줄 글로.
 * 제목은 그대로 한 줄, 목록은 "• ", 굵게·코드 표시는 지운다. 자동 설치 안내 문단은 카드에 이미 있으니 뺀다.
 */
export function releaseNotesText(raw: unknown): string[] {
  let src = ''
  if (typeof raw === 'string') src = raw
  else if (Array.isArray(raw)) src = raw.map((x) => (x && typeof x === 'object' && 'note' in x ? String((x as { note: unknown }).note ?? '') : '')).join('\n')
  if (!src.trim()) return []
  const text = /<[a-z][\s\S]*>/i.test(src)
    ? decode(
        src
          .replace(/\r/g, '')
          .replace(/\n/g, ' ')
          .replace(/<li[^>]*>/gi, '\n• ')
          .replace(/<\/(p|li|h[1-6]|ul|ol|div)>|<br\s*\/?>/gi, '\n')
          .replace(/<h[1-6][^>]*>/gi, '\n')
          .replace(/<[^>]+>/g, '')
      )
    : src
        .replace(/\r/g, '')
        .split('\n')
        .map((l) => l.replace(/^\s*#{1,6}\s+/, '').replace(/^\s*[-*+]\s+/, '• '))
        .join('\n')
  return text
    .split('\n')
    .map((l) => l.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim())
    .filter((l) => l && l !== '•' && !/자동으로 설치됩니다/.test(l))
    .slice(0, NOTES_MAX_LINES)
}

/** 설정 화면에 보일 짧은 사유 (원문은 updates.log 에) */
export function friendly(m: string): string {
  if (/\b404\b/.test(m)) return '릴리스를 찾지 못했습니다 (404). 저장소가 비공개이거나 아직 릴리스가 없습니다.'
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|net::ERR_/i.test(m)) return '업데이트 서버에 연결할 수 없습니다.'
  if (/sha512|checksum/i.test(m)) return '받은 파일이 손상돼 버렸습니다. 다음 확인 때 다시 받습니다.'
  if (/signature|code ?sign|designated requirement/i.test(m)) return '새 버전의 서명이 맞지 않아 설치하지 않았습니다.'
  const first = m.split('\n')[0].replace(/^Error:\s*/, '')
  return first.length > 100 ? first.slice(0, 97) + '…' : first
}
