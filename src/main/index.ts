import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { IPC_CHANNELS, type IpcChannel, type IpcContract, type IpcEventName, type IpcEvents } from '@shared/ipc'
import { DoorayHttp, NotConfiguredError } from './dooray/http'
import { MessengerApi } from './dooray/messenger'
import { WikiApi } from './dooray/wiki'
import { RealtimeService } from './dooray/realtime'
import { MailService } from './mail/service'
import { getPublicSettings, getSecret, getSettings, getUiState, saveSettings, saveUiState } from './settings'

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
  getDomain: () => getSettings().dooray.domain,
  onStatus: (s) => emit('realtime:status', s),
  onActivity: (channelId) => emit('messenger:activity', { channelId })
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

const handlers: Handlers = {
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
  'messenger:channels': () => messenger.channels(),
  'messenger:logs': (channelId, size) => messenger.logs(channelId, size),
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
  'wiki:pages': (w, parent) => wiki.pages(w, parent),
  'wiki:page': (w, p) => wiki.page(w, p),
  'wiki:create': (w, parent, subject, content) => wiki.create(w, parent, subject, content),
  'wiki:update': (w, p, subject, content) => wiki.update(w, p, subject, content),
  'wiki:move': (w, p, target) => wiki.move(w, p, target),
  'wiki:delete': (w, p) => wiki.remove(w, p),
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

function createWindow(): void {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 600,
    title: '두레이',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })
  win.once('ready-to-show', () => win?.show())
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

app.whenReady().then(() => {
  registerIpc()
  createWindow()
  void realtime.restart()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  realtime.stop()
  void mail.close()
  if (process.platform !== 'darwin') app.quit()
})
