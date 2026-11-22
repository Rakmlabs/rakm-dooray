import { app, Notification, shell } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NotifyPermission, NotifyPermissionState } from '@shared/types-shell'
import { jsonStore } from '../store'

/**
 * 데스크톱 알림 권한.
 * macOS 는 앱이 "처음 알림을 만들 때" 권한을 묻는다 (Electron 이 그때 UNUserNotificationCenter 권한을 요청한다).
 * Electron 에는 권한을 따로 묻거나 조회하는 API 가 없어서:
 *   - 토큰이 확인된 뒤 한 번, 안내 알림을 보내 권한 창을 띄운다 (askOnce)
 *   - 알림마다 결과(show / failed)를 보고 상태를 기록한다. 시스템이 거절하면 failed("not allowed") 가 온다.
 * 예전 버전은 안 읽은 메시지가 생겨야 처음 알림을 만들었으므로, 그 전에는 권한 창이 한 번도 뜨지 않을 수 있었다.
 */

interface Saved {
  state: NotifyPermissionState
  detail: string
  checkedAt: string | null
  askedAt: string | null
}

const WAIT_MS = 5_000

export class NotifyPermissionTracker {
  private readonly store = jsonStore<Saved>('notify-permission.json', { state: 'unknown', detail: '', checkedAt: null, askedAt: null })
  private saved: Saved
  /** 결과를 기다리는 동안 알림 객체가 가비지 수집되지 않게 잡아 둔다 */
  private live = new Set<Notification>()
  private readonly dev = !app.isPackaged

  constructor(private readonly onChange: (p: NotifyPermission) => void) {
    this.saved = this.store.read()
  }

  get(): NotifyPermission {
    if (!Notification.isSupported()) return { state: 'unsupported', detail: '이 컴퓨터에서는 데스크톱 알림을 쓸 수 없습니다.', checkedAt: null, dev: this.dev }
    return { state: this.saved.state, detail: this.saved.detail, checkedAt: this.saved.checkedAt, dev: this.dev }
  }

  /** 알림 하나를 보내고 결과를 기록한다. 결과(또는 시간 초과)까지 기다린다 */
  show(n: Notification): Promise<NotifyPermission> {
    this.live.add(n)
    return new Promise((resolve) => {
      let done = false
      const finish = (state: NotifyPermissionState | null, detail: string) => {
        if (done) return
        done = true
        setTimeout(() => this.live.delete(n), 60_000)
        if (state) this.set(state, detail)
        resolve(this.get())
      }
      n.once('show', () => {
        // 처음 보낸 알림이면 macOS 가 지금 권한 창을 띄우고 있을 수 있다
        if (this.saved.state === 'unknown') finish('asked', 'macOS 가 알림 허용을 묻습니다. 화면 오른쪽 위 알림 창에서 "허용"을 누르세요.')
        else finish('allowed', '')
      })
      n.once('failed', (_e, error: string) => {
        if (/not allowed|UNErrorDomain/i.test(error)) {
          finish(
            this.dev ? 'unsupported' : 'denied',
            this.dev
              ? '개발 실행(서명 안 된 Electron)에서는 macOS 가 알림을 막습니다. 설치한 앱에서 확인하세요.'
              : '시스템 설정 > 알림 에서 이 앱의 알림이 꺼져 있습니다.'
          )
        } else finish(null, '')
      })
      setTimeout(() => finish(null, ''), WAIT_MS)
      n.show()
    })
  }

  /** 토큰이 확인된 뒤 한 번만: 안내 알림으로 권한을 묻는다 (설치 후 첫 실행, 또는 이 기능이 생긴 버전으로 업데이트한 뒤) */
  askOnce(): void {
    if (this.saved.askedAt || this.dev || !Notification.isSupported()) return
    this.saved = { ...this.saved, askedAt: new Date().toISOString() }
    this.store.write(this.saved)
    void this.show(new Notification({ title: app.getName(), body: '새 메시지가 오면 이렇게 알려 드립니다. (설정 > 알림에서 끌 수 있습니다)', silent: true }))
  }

  /** 시스템 설정 > 알림 (가능하면 이 앱 항목으로) */
  openSettings(): void {
    const id = bundleId()
    const base = 'x-apple.systempreferences:com.apple.Notifications-Settings.extension'
    void shell.openExternal(id ? `${base}?id=${encodeURIComponent(id)}` : base)
  }

  private set(state: NotifyPermissionState, detail: string): void {
    const changed = state !== this.saved.state || detail !== this.saved.detail
    this.saved = { ...this.saved, state, detail, checkedAt: new Date().toISOString() }
    this.store.write(this.saved)
    if (changed) this.onChange(this.get())
  }
}

function bundleId(): string | null {
  if (process.platform !== 'darwin') return null
  const plist = join(process.resourcesPath, '..', 'Info.plist')
  if (!existsSync(plist)) return null
  const m = /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(readFileSync(plist, 'utf8'))
  return m?.[1] ?? null
}
