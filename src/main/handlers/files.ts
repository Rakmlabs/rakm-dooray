// 채팅 파일 뷰어·업로드·캐시 영역의 main 핸들러. 이 영역 작업자만 고친다.
import { app, nativeImage, protocol, shell } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { FilesAreaContract } from '@shared/ipc-files'
import {
  CACHE_LIMIT_CHOICES_MB,
  DEFAULT_CACHE_LIMIT_MB,
  FILE_SCHEME,
  UPLOAD_MAX_BYTES,
  mimeFromName
} from '@shared/types-files'
import { dataDir, jsonStore } from '../store'
import { FileCache, safeFileName } from '../files/cache'
import { makeFileProtocolHandler } from '../files/protocol'
import type { HandlersFor, MainContext } from './types'

const settings = jsonStore<{ cacheLimitMB: number }>('files-settings.json', { cacheLimitMB: DEFAULT_CACHE_LIMIT_MB })
const THUMB_MAX = 640

let cache: FileCache | null = null

function getCache(ctx: MainContext): FileCache {
  if (!cache) {
    cache = new FileCache({
      dir: dataDir('file-cache'),
      limitBytes: () => Math.max(64, settings.read().cacheLimitMB || DEFAULT_CACHE_LIMIT_MB) * 1024 * 1024,
      download: (c, f) => ctx.messenger.downloadFile(c, f),
      makeThumb: async (src, ext) => {
        const img = nativeImage.createFromPath(src)
        if (img.isEmpty()) return null
        const { width, height } = img.getSize()
        if (width <= THUMB_MAX && height <= THUMB_MAX) return null
        const scale = THUMB_MAX / Math.max(width, height)
        const small = img.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'good' })
        return ext === 'jpg' ? small.toJPEG(82) : small.toPNG()
      }
    })
  }
  return cache
}

let quickLook: ChildProcess | null = null

/** 앱에 포함된 pdfjs-dist 폴더 (pdf.js 의 CMap·표준 글꼴). 앱 경로에서 위로 올라가며 찾는다. */
let pdfjsDirCache: string | null = null
function pdfjsDir(): string {
  if (pdfjsDirCache) return pdfjsDirCache
  let d = app.getAppPath()
  for (let i = 0; i < 6; i++) {
    const c = join(d, 'node_modules', 'pdfjs-dist')
    if (existsSync(join(c, 'cmaps'))) return (pdfjsDirCache = c)
    d = dirname(d)
  }
  return join(app.getAppPath(), 'node_modules', 'pdfjs-dist')
}

export function filesAreaHandlers(ctx: MainContext): HandlersFor<FilesAreaContract> {
  return {
    'files:save': async (c, f, name) => {
      const fc = getCache(ctx)
      const e = await fc.ensure(c, f, name)
      return ctx.saveAs(name || e.name, await readFile(fc.blobPath(e)))
    },
    'files:open': async (c, f, name, how) => {
      const fc = getCache(ctx)
      const e = await fc.ensure(c, f, name)
      const path = fc.blobPath(e) // 캐시 안 경로만 연다
      if (how === 'quicklook') {
        if (process.platform !== 'darwin') throw new Error('미리보기(Quick Look)는 macOS 에서만 쓸 수 있습니다.')
        if (quickLook && quickLook.exitCode === null) quickLook.kill()
        // 셸을 거치지 않고 인자로만 넘긴다
        quickLook = spawn('/usr/bin/qlmanage', ['-p', path], { stdio: 'ignore' })
        quickLook.on('error', () => {})
      } else if (how === 'default') {
        const err = await shell.openPath(path)
        if (err) throw new Error(`기본 앱으로 열지 못했습니다: ${err}`)
      } else {
        shell.showItemInFolder(path)
      }
      return null
    },
    'files:upload': async (c, name, mime, bytes) => {
      if (!(bytes instanceof Uint8Array)) throw new Error('파일 내용이 올바르지 않습니다.')
      if (bytes.byteLength === 0) throw new Error('빈 파일은 올릴 수 없습니다.')
      if (bytes.byteLength > UPLOAD_MAX_BYTES) {
        throw new Error(`파일이 너무 큽니다. 한 번에 ${Math.round(UPLOAD_MAX_BYTES / 1024 / 1024)}MB 까지 올릴 수 있습니다.`)
      }
      const safe = safeFileName(name)
      const type = /^[\w.+-]+\/[\w.+-]+$/.test(mime) ? mime : mimeFromName(safe)
      await ctx.messenger.uploadFile(c, safe, type, Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
      return null
    },
    'files:cached': async (c, ids) => {
      const fc = getCache(ctx)
      return ids.filter((id) => fc.has(c, id))
    },
    'files:cacheStats': async () => getCache(ctx).stats(),
    'files:setCacheLimit': async (mb) => {
      if (!CACHE_LIMIT_CHOICES_MB.includes(mb)) throw new Error('지원하지 않는 용량입니다.')
      settings.write({ cacheLimitMB: mb })
      const fc = getCache(ctx)
      fc.evict()
      return fc.stats()
    },
    'files:clearCache': async () => {
      const fc = getCache(ctx)
      await fc.clear()
      return fc.stats()
    }
  }
}

/** app ready 전에 한 번 (예: protocol.registerSchemesAsPrivileged). */
export function filesAreaBeforeReady(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: FILE_SCHEME,
      // stream: 동영상 탐색(Range), supportFetchAPI/corsEnabled: pdf.js·문서 뷰어의 fetch
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
    }
  ])
}

/** app ready 후, 창을 만들기 전에 한 번 (예: protocol.handle, 트레이). */
export function filesAreaSetup(ctx: MainContext): void {
  protocol.handle(
    FILE_SCHEME,
    makeFileProtocolHandler(getCache(ctx), pdfjsDir)
  )
  app.on('will-quit', () => {
    cache?.flush()
    if (quickLook && quickLook.exitCode === null) quickLook.kill()
  })
}
