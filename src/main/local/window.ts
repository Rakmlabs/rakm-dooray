import { app, BrowserWindow, Menu, nativeImage, screen, Tray } from 'electron'
import { existsSync } from 'node:fs'
import { jsonStore } from '../store'
import { visibleOn, type Rect } from './rules'

// 창 크기·위치 기억, 메뉴 막대(트레이) 상주.

interface WindowState {
  bounds: Rect | null
  maximized: boolean
}

const store = jsonStore<WindowState>('window-state.json', { bounds: null, maximized: false })

/** 저장된 창 위치. 지금 연결된 화면 밖이면 버린다 */
export function savedBounds(): Partial<Rect> & { maximized: boolean } {
  const s = store.read()
  if (!s.bounds) return { maximized: false }
  const displays = screen.getAllDisplays().map((d) => d.workArea)
  if (!visibleOn(s.bounds, displays)) return { width: s.bounds.width, height: s.bounds.height, maximized: s.maximized }
  return { ...s.bounds, maximized: s.maximized }
}

export function trackWindow(win: BrowserWindow): void {
  let t: NodeJS.Timeout | null = null
  const save = () => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
    const maximized = win.isMaximized()
    store.write({ bounds: maximized ? (store.read().bounds ?? win.getNormalBounds()) : win.getNormalBounds(), maximized })
  }
  const later = () => {
    if (t) clearTimeout(t)
    t = setTimeout(save, 500)
  }
  win.on('resize', later)
  win.on('move', later)
  win.on('close', save)
}

/** 16pt 메뉴 막대용 아이콘: 말풍선 모양을 직접 그린다 (macOS 는 템플릿 이미지로 밝기·다크 모드 자동 대응) */
function trayIcon(fallbackPath: string): Electron.NativeImage {
  const draw = (size: number) => {
    const buf = Buffer.alloc(size * size * 4)
    const s = size / 16
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const fx = x / s
        const fy = y / s
        // 둥근 사각형 말풍선 (2..14, 2..11) + 꼬리
        const inBox = fx >= 2 && fx < 14 && fy >= 2.5 && fy < 11 && !((fx < 3 || fx >= 13) && (fy < 3.5 || fy >= 10))
        const inTail = fy >= 11 && fy < 14 && fx >= 4 && fx < 4 + (14 - fy) * 0.9
        const hole = fx >= 4.5 && fx < 11.5 && fy >= 5 && fy < 8.5 && !(fy >= 6.2 && fy < 7.2)
        const on = (inBox && !hole) || inTail
        const i = (y * size + x) * 4
        // BGRA
        buf[i] = 0
        buf[i + 1] = 0
        buf[i + 2] = 0
        buf[i + 3] = on ? 255 : 0
      }
    }
    return buf
  }
  try {
    const img = nativeImage.createFromBitmap(draw(16), { width: 16, height: 16 })
    img.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: draw(32) })
    if (process.platform === 'darwin') img.setTemplateImage(true)
    if (!img.isEmpty()) return img
  } catch {
    /* 아래로 */
  }
  return existsSync(fallbackPath) ? nativeImage.createFromPath(fallbackPath).resize({ width: 16, height: 16 }) : nativeImage.createEmpty()
}

export class TrayControl {
  private tray: Tray | null = null
  private unread = 0

  constructor(
    private readonly iconPath: string,
    private readonly show: () => void,
    private readonly quit: () => void
  ) {}

  get enabled(): boolean {
    return !!this.tray
  }

  set(enabled: boolean): void {
    if (enabled && !this.tray) {
      this.tray = new Tray(trayIcon(this.iconPath))
      this.tray.setToolTip('RAKM 두레이')
      this.tray.on('click', () => this.show())
      this.refresh()
    } else if (!enabled && this.tray) {
      this.tray.destroy()
      this.tray = null
    }
  }

  setUnread(n: number): void {
    this.unread = n
    this.refresh()
  }

  private refresh(): void {
    if (!this.tray) return
    if (process.platform === 'darwin') this.tray.setTitle(this.unread > 0 ? String(this.unread) : '')
    this.tray.setToolTip(this.unread > 0 ? `RAKM 두레이 — 안 읽은 메시지 ${this.unread}개` : 'RAKM 두레이')
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '열기', click: () => this.show() },
        { label: this.unread > 0 ? `안 읽은 메시지 ${this.unread}개` : '새 메시지 없음', enabled: false },
        { type: 'separator' },
        { label: '종료', click: () => this.quit() }
      ])
    )
  }
}

/** 로그인 시 자동 실행. 개발 실행(패키징 안 됨)에서는 Electron 실행 파일이 등록되므로 적용하지 않는다. */
export function applyLoginItem(open: boolean): void {
  if (!app.isPackaged) return
  if (process.platform !== 'darwin' && process.platform !== 'win32') return
  if (app.getLoginItemSettings().openAtLogin !== open) app.setLoginItemSettings({ openAtLogin: open })
}
