import { app, Notification, shell } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NotifyPermission, NotifyPermissionState } from '@shared/types-shell'

/**
 * 데스크톱 알림 권한 (macOS).
 *
 * Electron 에는 권한을 조회·요청하는 API 가 없고, 알림의 'show' 이벤트는 권한이 없거나 거부돼 있어도 온다.
 * (0.1.3 은 이 'show' 를 보고 "허용됨"으로 기록해, 실제로는 거부·미결정인데도 안내를 띄우지 않았다.)
 * 그래서 작은 네이티브 모듈(native/notify.mm)로 UNUserNotificationCenter 의 실제 상태를 앱 프로세스 안에서 읽는다.
 *
 * - 앱을 켤 때마다 상태를 읽고, '아직 결정 안 함'이면 바로 권한을 요청한다 (토큰·안 읽은 메시지와 무관).
 * - 거부·꺼짐이면 설정 화면과 메신저 화면 위에 안내를 띄운다 (renderer 가 이 상태를 받아 그린다).
 * - macOS 는 알림 권한이 없으면 Dock 배지도 그리지 않는다 (app.setBadgeCount 는 값만 넣고 Dock 에는 안 보임).
 *   권한이 생기면 onAllowed 로 배지를 다시 넣는다.
 * - 사용자가 시스템 설정에서 바꿀 수 있으므로, 허용될 때까지 주기적으로·창이 앞에 올 때 다시 읽는다.
 */

export interface NativeSettings {
  status: 'notDetermined' | 'denied' | 'authorized' | 'provisional' | 'unknown'
  alert: 'enabled' | 'disabled' | 'notSupported'
  badge: 'enabled' | 'disabled' | 'notSupported'
  sound: 'enabled' | 'disabled' | 'notSupported'
}

interface NativeModule {
  settings(): NativeSettings | null
  request(): void
}

const POLL_FAST_MS = 3_000
const POLL_FAST_FOR_MS = 3 * 60_000
const POLL_SLOW_MS = 60_000

let nativeCache: NativeModule | null | undefined
function native(): NativeModule | null {
  if (nativeCache !== undefined) return nativeCache
  nativeCache = null
  if (process.platform !== 'darwin') return null
  const file = app.isPackaged ? join(process.resourcesPath, 'native', 'notify.node') : join(app.getAppPath(), 'build', 'native', 'notify.node')
  if (!existsSync(file)) return null
  try {
    const m = { exports: {} as NativeModule }
    process.dlopen(m, file)
    nativeCache = m.exports
  } catch {
    nativeCache = null
  }
  return nativeCache
}

export interface PermissionView {
  state: NotifyPermissionState
  banners: boolean
  badge: boolean
}

/** 네이티브 결과 → 화면 상태 (단위 테스트용으로 분리) */
export function interpret(s: NativeSettings | null): PermissionView {
  if (!s) return { state: 'unknown', banners: false, badge: false }
  const on = (v: string) => v === 'enabled'
  switch (s.status) {
    case 'notDetermined':
      return { state: 'undecided', banners: false, badge: false }
    case 'denied':
      return { state: 'denied', banners: false, badge: false }
    case 'authorized':
    case 'provisional':
      return { state: 'allowed', banners: on(s.alert), badge: on(s.badge) }
    default:
      return { state: 'unknown', banners: false, badge: false }
  }
}

export function describe(v: PermissionView, dev: boolean): string {
  if (dev) return '개발 실행(서명 안 된 Electron)에서는 알림 권한을 확인할 수 없습니다. 설치한 앱에서 확인하세요.'
  switch (v.state) {
    case 'undecided':
      return 'macOS 가 알림 허용을 묻고 있습니다. 화면 오른쪽 위 창(또는 알림 센터)에서 "허용"을 누르세요. 그 전에는 새 메시지 알림과 Dock 배지가 보이지 않습니다.'
    case 'denied':
      return '새 메시지 알림과 Dock 배지가 보이지 않습니다. 화면 오른쪽 위에 허용을 묻는 창이 떴다면 "허용"을, 아니면 시스템 설정에서 "알림 허용"을 켜세요.'
    case 'allowed':
      if (!v.banners && !v.badge) return '알림 창과 Dock 배지가 모두 꺼져 있습니다. 시스템 설정 > 알림 > RAKM 두레이 에서 켜세요.'
      if (!v.badge) return 'Dock 배지가 꺼져 있습니다. 시스템 설정 > 알림 > RAKM 두레이 에서 "응용 프로그램 아이콘에 배지 표시"를 켜세요.'
      if (!v.banners) return '알림 창(배너)이 꺼져 있습니다. 시스템 설정 > 알림 > RAKM 두레이 에서 알림 스타일을 "배너"로 바꾸세요.'
      return ''
    case 'unknown':
      return '알림 권한 상태를 읽지 못했습니다. "알림 테스트"로 확인하세요.'
    default:
      return '이 컴퓨터에서는 데스크톱 알림을 쓸 수 없습니다.'
  }
}

export class NotifyPermissionTracker {
  private view: PermissionView = { state: 'unknown', banners: false, badge: false }
  private checkedAt: string | null = null
  private timer: NodeJS.Timeout | null = null
  private fastUntil = 0
  private requested = false
  /** 결과를 기다리는 동안 알림 객체가 가비지 수집되지 않게 잡아 둔다 */
  private live = new Set<Notification>()
  private readonly dev = !app.isPackaged

  constructor(
    private readonly onChange: (p: NotifyPermission) => void,
    /** 권한(배지)이 새로 생겼을 때: Dock 배지를 다시 넣는다 */
    private readonly onBadgeAllowed: () => void = () => {}
  ) {}

  /**
   * 앱을 켤 때 한 번: 상태를 읽고, 허용돼 있지 않으면 바로 권한을 요청한다.
   * macOS 26 은 한 번도 답하지 않은 앱도 'denied' 로 알려 줘서 "미결정"과 "거부"를 구분할 수 없다.
   * 요청은 이미 고른 경우 아무 창도 띄우지 않으므로, 허용이 아니면 매번 요청한다 (토큰 저장 여부와 무관).
   * 창이 안 뜨면(전에 이미 물었던 앱) 안내 띠의 "시스템 설정 열기"가 이 앱의 알림 화면으로 바로 간다.
   */
  start(): void {
    this.refresh()
    if (this.view.state !== 'allowed' && this.view.state !== 'unsupported') this.request()
    this.schedule()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  get(): NotifyPermission {
    return { ...this.view, detail: describe(this.view, this.dev), checkedAt: this.checkedAt, dev: this.dev }
  }

  /** 지금 상태를 다시 읽는다 (창이 앞에 왔을 때, 설정 화면을 열 때) */
  refresh(): NotifyPermission {
    const before = this.view
    let next: PermissionView
    if (this.dev) next = { state: 'unsupported', banners: false, badge: false }
    else if (!Notification.isSupported()) next = { state: 'unsupported', banners: false, badge: false }
    else next = interpret(native()?.settings() ?? null)
    this.view = next
    this.checkedAt = new Date().toISOString()
    const changed = before.state !== next.state || before.banners !== next.banners || before.badge !== next.badge
    if (changed) {
      this.onChange(this.get())
      if (next.badge && !before.badge) this.onBadgeAllowed()
    }
    return this.get()
  }

  /** 권한 창을 띄운다 (아직 결정 안 했을 때만 macOS 가 창을 보여 준다) */
  request(): void {
    if (this.dev) return
    const n = native()
    if (n) n.request()
    else void this.show(new Notification({ title: app.getName(), body: '새 메시지가 오면 이렇게 알려 드립니다.', silent: true }))
    this.requested = true
    this.fastUntil = Date.now() + POLL_FAST_FOR_MS
    this.schedule()
  }

  /** 알림 하나를 보낸다. 결과(또는 시간 초과)를 기다린 뒤 실제 권한 상태를 돌려준다 */
  show(n: Notification): Promise<NotifyPermission> {
    this.live.add(n)
    return new Promise((resolve) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        setTimeout(() => this.live.delete(n), 60_000)
        resolve(this.refresh())
      }
      // 'show' 는 권한이 없어도 온다. 상태는 네이티브로 다시 읽는다
      n.once('show', finish)
      n.once('failed', finish)
      setTimeout(finish, 5_000)
      n.show()
    })
  }

  /** 시스템 설정 > 알림 (가능하면 이 앱 항목으로) */
  openSettings(): void {
    const id = bundleId()
    const base = 'x-apple.systempreferences:com.apple.Notifications-Settings.extension'
    void shell.openExternal(id ? `${base}?id=${encodeURIComponent(id)}` : base)
    // 설정을 바꾸고 돌아올 때까지 자주 읽는다
    this.fastUntil = Date.now() + POLL_FAST_FOR_MS
    this.schedule()
  }

  private schedule(): void {
    if (this.dev) return
    if (this.timer) clearTimeout(this.timer)
    const ok = this.view.state === 'allowed' && this.view.banners && this.view.badge
    // 다 켜져 있으면 가끔만 (시스템 설정에서 끌 수도 있으니)
    const ms = Date.now() < this.fastUntil ? POLL_FAST_MS : ok ? POLL_SLOW_MS * 5 : POLL_SLOW_MS
    this.timer = setTimeout(() => {
      this.timer = null
      this.refresh()
      this.schedule()
    }, ms)
  }

  /** 시험용: 이번 실행에서 권한을 요청했는지 */
  get askedThisRun(): boolean {
    return this.requested
  }
}

function bundleId(): string | null {
  if (process.platform !== 'darwin') return null
  const plist = join(process.resourcesPath, '..', 'Info.plist')
  if (!existsSync(plist)) return null
  const m = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(readFileSync(plist, 'utf8'))
  return m?.[1] ?? null
}

