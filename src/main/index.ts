import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, shell } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { IPC_CHANNELS, type IpcChannel, type IpcContract, type IpcEventName, type IpcEvents } from '@shared/ipc'
import { DoorayHttp, NotConfiguredError } from './dooray/http'
import { MessengerApi } from './dooray/messenger'
import { WikiApi } from './dooray/wiki'
import { RealtimeService } from './dooray/realtime'
import { MailService } from './mail/service'
import { chatAreaBeforeReady, chatAreaHandlers, chatAreaSetup } from './handlers/chat'
import { filesAreaBeforeReady, filesAreaHandlers, filesAreaSetup } from './handlers/files'
import { shellAreaBeforeReady, shellAreaHandlers, shellAreaSetup, shellHooks, shellService } from './handlers/shell'
import { applyLoginItem, savedBounds, trackWindow, TrayControl } from './local/window'
import { ZOOM } from './local/rules'
import type { ShellState } from '@shared/types-shell'
import type { MainContext } from './handlers/types'
import { flushWikiSaves, wikiAreaBeforeReady, wikiAreaHandlers, wikiAreaSetup } from './handlers/wiki'
import { receiptsAreaHandlers, receiptsAreaSetup, receiptsFlush } from './handlers/receipts'
import { updatesAreaHandlers, updatesAreaSetup } from './handlers/updates'
import { TEST_BUILD } from './buildFlags'
import { DOORAY_DOMAIN, getPublicSettings, getSecret, getSettings, getUiState, saveSettings, saveUiState } from './settings'

// 이름을 바꾸면 userData 경로도 바뀌어 저장된 토큰·설정을 잃는다. 경로는 예전 이름(dooray-client)으로 고정하고 표시 이름만 바꾼다.
// 시험용 패키징 빌드는 이름·userData 를 따로 써서 실제 앱의 토큰·데이터·키체인 항목과 섞이지 않는다 (buildFlags.ts)
if (!app.commandLine.hasSwitch('user-data-dir')) app.setPath('userData', join(app.getPath('appData'), TEST_BUILD?.userData ?? 'dooray-client'))
app.setName(TEST_BUILD?.name ?? 'RAKM 두레이')
const APP_TITLE = TEST_BUILD?.name ?? 'RAKM 두레이'
const ICON_PATH = join(__dirname, '../../build/icon.png')

let win: BrowserWindow | null = null

function emit<E extends IpcEventName>(event: E, payload: IpcEvents[E]): void {
  if (win && !win.isDestroyed()) win.webContents.send(event, payload)
}

const http = new DoorayHttp(async () => {
  const token = await getSecret('doorayToken')
  return token ? { apiBase: getSettings().dooray.apiBase, token } : null
})
const messenger = new MessengerApi(http)
const wiki = new WikiApi(http)
const realtime = new RealtimeService({
  http,
  getDomain: () => DOORAY_DOMAIN,
  onStatus: (s) => emit('realtime:status', s),
  onActivity: (channelId) => {
    emit('messenger:activity', { channelId })
    shellService()?.noteActivity(channelId)
  }
})
const mail = new MailService(async () => {
  const s = getSettings().mail
  const password = await getSecret('mailPassword')
  return password ? { ...s, password } : null
})

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.zip': 'application/zip',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.hwp': 'application/x-hwp'
}
const mimeOf = (p: string) => MIME[extname(p).toLowerCase()] ?? 'application/octet-stream'

// 사용자가 파일 선택 창에서 직접 고른 경로만 메일 첨부로 허용한다 (renderer 가 임의 경로를 보내지 못하게).
const pickedPaths = new Set<string>()

async function pickFiles(): Promise<string[]> {
  const r = await dialog.showOpenDialog(win!, { properties: ['openFile', 'multiSelections'] })
  if (r.canceled) return []
  r.filePaths.forEach((p) => pickedPaths.add(p))
  return r.filePaths
}

async function saveAs(suggested: string, bytes: Buffer): Promise<string | null> {
  const r = await dialog.showSaveDialog(win!, { defaultPath: join(app.getPath('downloads'), safeName(suggested)) })
  if (r.canceled || !r.filePath) return null
  await writeFile(r.filePath, bytes)
  return r.filePath
}

function safeName(n: string): string {
  return basename(n).replace(/[\\/:*?"<>|]/g, '_') || 'download'
}

type Handlers = { [K in IpcChannel]: (...args: IpcContract[K]['args']) => Promise<IpcContract[K]['result']> }

const ctx: MainContext = { http, messenger, wiki, getWindow: () => win, emit, pickFiles, saveAs }

const handlers: Handlers = {
  ...wikiAreaHandlers(ctx),
  ...filesAreaHandlers(ctx),
  ...chatAreaHandlers(ctx),
  ...shellAreaHandlers(ctx),
  ...receiptsAreaHandlers(ctx),
  ...updatesAreaHandlers(ctx),
  'settings:get': () => getPublicSettings(),
  'settings:save': async (input) => {
    const r = await saveSettings(input)
    await mail.close()
    void realtime.restart()
    return r
  },
  'settings:testDooray': async () => {
    try {
      const me = await messenger.me()
      return { ok: true, message: `연결됨: ${me.name}` }
    } catch (e) {
      return { ok: false, message: errorMessage(e) }
    }
  },
  'settings:testMail': async () => {
    try {
      return { ok: true, message: await mail.test() }
    } catch (e) {
      return { ok: false, message: errorMessage(e) }
    }
  },
  'ui:get': async () => getUiState(),
  'ui:save': async (s) => saveUiState(s),

  'messenger:me': () => messenger.me(),
  // 받아 온 목록·메시지는 셸 영역의 로컬 보관함(안 읽음·검색·1000개 이전 기록)에도 넣는다
  'messenger:channels': async () => {
    const list = await messenger.channels()
    shellService()?.noteChannels(list)
    return list
  },
  'messenger:logs': async (channelId, size) => {
    const list = await messenger.logs(channelId, size)
    shellService()?.ingest(channelId, list, Math.min(1000, Math.max(1, Math.round(size))))
    return list
  },
  'messenger:member': (id) => messenger.member(id),
  'messenger:searchMembers': (name) => messenger.searchMembers(name),
  'messenger:send': (c, text) => messenger.send(c, text),
  'messenger:update': (c, l, text) => messenger.update(c, l, text),
  'messenger:delete': (c, l) => messenger.remove(c, l),
  'messenger:reply': (c, l, text) => messenger.reply(c, l, text),
  'messenger:createThread': (c, text, threadText) => messenger.createThread(c, text, threadText),
  'messenger:threadFromMessage': (c, l, text) => messenger.threadFromMessage(c, l, text),
  'messenger:directSend': (m, text) => messenger.directSend(m, text),
  'messenger:createChannel': (title, ids) => messenger.createChannel(title, ids),
  'messenger:downloadFile': async (c, f, name) => {
    const file = await messenger.downloadFile(c, f)
    return saveAs(file.fileName ?? name, file.bytes)
  },
  'messenger:uploadFile': async (c) => {
    const paths = await pickFiles()
    for (const p of paths) await messenger.uploadFile(c, basename(p), mimeOf(p), await readFile(p))
    return paths.length > 0
  },
  'realtime:status': async () => realtime.getStatus(),
  'realtime:restart': () => realtime.restart(),

  'wiki:list': () => wiki.wikis(),
  'wiki:pages': async (w, parent) => {
    const list = await wiki.pages(w, parent)
    shellService()?.noteWikiPages(w, list)
    return list
  },
  'wiki:page': async (w, p) => {
    const page = await wiki.page(w, p)
    shellService()?.noteWikiPage(page)
    return page
  },
  'wiki:create': (w, parent, subject, content) => wiki.create(w, parent, subject, content),
  'wiki:update': (w, p, subject, content) => wiki.update(w, p, subject, content),
  'wiki:move': (w, p, target) => wiki.move(w, p, target),
  'wiki:delete': async (w, p) => {
    const r = await wiki.remove(w, p)
    shellService()?.noteWikiDeleted(p)
    return r
  },
  'wiki:comments': (w, p) => wiki.comments(w, p),
  'wiki:addComment': (w, p, content) => wiki.addComment(w, p, content),
  'wiki:updateComment': (w, p, c, content) => wiki.updateComment(w, p, c, content),
  'wiki:deleteComment': (w, p, c) => wiki.deleteComment(w, p, c),
  'wiki:uploadFile': async (w, p) => {
    const paths = await pickFiles()
    for (const f of paths) await wiki.uploadFile(w, p, basename(f), mimeOf(f), await readFile(f))
    return paths.length > 0
  },
  'wiki:downloadFile': async (w, p, f, name) => {
    const file = await wiki.downloadFile(w, p, f)
    return saveAs(file.fileName ?? name, file.bytes)
  },

  'mail:folders': () => mail.folders(),
  'mail:list': (folder, page, size) => mail.list(folder, page, size),
  'mail:get': (folder, uid) => mail.get(folder, uid),
  'mail:setSeen': (folder, uid, seen) => mail.setSeen(folder, uid, seen),
  'mail:delete': (folder, uid) => mail.remove(folder, uid),
  'mail:downloadAttachment': async (folder, uid, index) => {
    const a = await mail.attachment(folder, uid, index)
    return saveAs(a.filename, a.content)
  },
  'mail:send': async (input) => {
    if (input.attachmentPaths.some((p) => !pickedPaths.has(p))) throw new Error('파일 선택 창에서 고른 파일만 첨부할 수 있습니다.')
    return mail.send(input)
  },

  'file:pick': () => pickFiles(),
  'shell:openExternal': async (url) => {
    if (/^(https?:|mailto:)/i.test(url)) await shell.openExternal(url)
    return null
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof NotConfiguredError) return e.message
  if (e instanceof Error) return e.message
  return String(e)
}

function registerIpc(): void {
  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      // 우리 창에서 온 요청만 받는다
      if (!win || event.sender !== win.webContents) return { ok: false, error: '허용되지 않은 요청입니다.' }
      try {
        const fn = handlers[channel] as (...a: unknown[]) => Promise<unknown>
        return { ok: true, value: await fn(...args) }
      } catch (e) {
        // 토큰·비밀번호는 에러 메시지에 들어가지 않는다 (http.ts, service.ts 참고). 스택은 남기지 않는다.
        console.error(`[ipc] ${channel} 실패: ${errorMessage(e)}`)
        return { ok: false, error: errorMessage(e), notConfigured: e instanceof NotConfiguredError }
      }
    })
  }
}

// ---------- 창·트레이 (셸 영역) ----------

let quitting = false
let shellState: ShellState | null = null
const tray = new TrayControl(ICON_PATH, () => void showWindow(), () => {
  quitting = true
  app.quit()
})

/** 셸 설정(테마·글자 크기·트레이·자동 실행)을 적용한다 */
function applyShellState(s: ShellState): void {
  shellState = s
  nativeTheme.themeSource = s.prefs.theme
  if (win && !win.isDestroyed()) win.webContents.setZoomFactor(ZOOM[s.prefs.fontSize])
  tray.set(s.prefs.tray)
  applyLoginItem(s.prefs.openAtLogin)
}

/** 창을 앞으로 (닫혀 있으면 새로 만들고 화면이 다 뜰 때까지 기다린다) */
async function showWindow(): Promise<void> {
  if (!win || win.isDestroyed()) {
    createWindow()
    await new Promise<void>((resolve) => win!.webContents.once('did-finish-load', () => setTimeout(resolve, 800)))
  }
  if (win!.isMinimized()) win!.restore()
  win!.show()
  win!.focus()
}

shellHooks.showWindow = showWindow
shellHooks.applyState = applyShellState

function createWindow(): void {
  const saved = savedBounds()
  win = new BrowserWindow({
    width: saved.width ?? 1360,
    height: saved.height ?? 860,
    x: saved.x,
    y: saved.y,
    minWidth: 960,
    minHeight: 600,
    title: APP_TITLE,
    // 패키징하면 실행 파일 아이콘을 쓰고, 개발 실행(윈도·리눅스)에서만 직접 지정한다
    icon: !app.isPackaged && process.platform !== 'darwin' ? ICON_PATH : undefined,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })
  win.once('ready-to-show', () => {
    if (saved.maximized) win?.maximize()
    win?.show()
  })
  trackWindow(win)
  win.webContents.on('did-finish-load', () => {
    if (shellState) win?.webContents.setZoomFactor(ZOOM[shellState.prefs.fontSize])
  })
  win.on('focus', () => shellService()?.onFocus())
  // macOS 와 트레이 상주 중에는 닫기 = 숨기기 (다시 열 때 화면 상태가 그대로이고, 뒤에서 알림을 계속 받는다)
  win.on('close', (e) => {
    if (quitting) return
    if (process.platform === 'darwin' || tray.enabled) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('closed', () => {
    win = null
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const dev = process.env.ELECTRON_RENDERER_URL
    if (dev && url.startsWith(dev)) return
    e.preventDefault()
    if (/^(https?:|mailto:)/i.test(url)) void shell.openExternal(url)
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

for (const f of [wikiAreaBeforeReady, filesAreaBeforeReady, chatAreaBeforeReady, shellAreaBeforeReady]) f()

app.whenReady().then(() => {
  for (const f of [wikiAreaSetup, filesAreaSetup, chatAreaSetup, shellAreaSetup, receiptsAreaSetup]) f(ctx)
  // 자동 업데이트: 재시작 전에 위키 자동 저장·읽음 위치 쓰기를 끝내고, 창 닫기를 숨기기가 아닌 종료로 처리한다
  updatesAreaSetup(ctx, {
    beforeRestart: async () => {
      await Promise.all([flushWikiSaves(ctx), receiptsFlush()])
    },
    markQuitting: () => {
      quitting = true
    }
  })
  // 개발 실행에서도 Dock 에 RAKM 아이콘이 보이게 한다 (패키징하면 electron-builder 가 build/icon.png 를 쓴다)
  if (process.platform === 'darwin' && !app.isPackaged) {
    const icon = nativeImage.createFromPath(ICON_PATH)
    if (!icon.isEmpty()) app.dock?.setIcon(icon)
  }
  registerIpc()
  createWindow()
  void realtime.restart()
  const s = shellService()
  if (s) s.onUnread = (n) => tray.setUnread(n)
  app.on('activate', () => void showWindow())
})

app.on('before-quit', () => {
  quitting = true
})

app.on('will-quit', () => {
  shellService()?.stop()
})

app.on('window-all-closed', () => {
  realtime.stop()
  void mail.close()
  if (process.platform !== 'darwin' && !tray.enabled) app.quit()
})
