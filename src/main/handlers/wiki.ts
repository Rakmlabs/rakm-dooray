// 위키 블록 편집기 영역의 main 핸들러. 이 영역 작업자만 고친다.
import { app, type BrowserWindow } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WikiAreaContract } from '@shared/ipc-wiki'
import type { WikiBackup, WikiServerCopy } from '@shared/types-wiki'
import { parseWikiImageSrc } from '../dooray/wiki'
import { dataDir } from '../store'
import type { HandlersFor, MainContext } from './types'

const MAX_BACKUPS_PER_PAGE = 20
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
/** 본문 이미지 캐시 (data: URL 문자열) 상한: 개수가 아니라 크기로. 예전 80개 상한은 큰 사진이면 GB 단위까지 갈 수 있었다 */
const IMAGE_CACHE_BYTES = 64 * 1024 * 1024

function backupFile(pageId: string): string {
  return join(dataDir('wiki-backups'), `${pageId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`)
}

function readBackups(pageId: string): WikiBackup[] {
  const p = backupFile(pageId)
  if (!existsSync(p)) return []
  try {
    const v = JSON.parse(readFileSync(p, 'utf8'))
    return Array.isArray(v) ? (v as WikiBackup[]) : []
  } catch {
    return []
  }
}

function writeBackups(pageId: string, list: WikiBackup[]): void {
  const p = backupFile(pageId)
  writeFileSync(p + '.tmp', JSON.stringify(list), { encoding: 'utf8', mode: 0o600 })
  renameSync(p + '.tmp', p)
}

/** 바이트로 이미지 형식 확인 (서버 content-type 이 octet-stream 일 수 있다) */
export function sniffImage(bytes: Buffer, contentType: string | null): string | null {
  const ct = (contentType ?? '').split(';')[0].trim().toLowerCase()
  if (ct.startsWith('image/')) return ct
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.subarray(0, 6).toString('latin1').startsWith('GIF8')) return 'image/gif'
  if (bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp'
  return null
}

const imageCache = new Map<string, string>()
let imageCacheBytes = 0
function putImage(key: string, url: string): void {
  const old = imageCache.get(key)
  if (old !== undefined) {
    imageCache.delete(key)
    imageCacheBytes -= old.length
  }
  imageCache.set(key, url)
  imageCacheBytes += url.length
  // 오래된 것부터 (Map 은 넣은 순서) 상한 안으로. 방금 넣은 것은 남긴다
  for (const [k, v] of imageCache) {
    if (imageCacheBytes <= IMAGE_CACHE_BYTES || k === key) break
    imageCache.delete(k)
    imageCacheBytes -= v.length
  }
}
let pendingSave = false
let flushWaiter: (() => void) | null = null
let quitting = false

export function wikiAreaHandlers(ctx: MainContext): HandlersFor<WikiAreaContract> {
  const copy = (p: { version: string; updatedAt: string | null; subject: string; content: string }): WikiServerCopy => ({
    version: p.version,
    updatedAt: p.updatedAt,
    subject: p.subject,
    content: p.content
  })
  return {
    'wiki:save': async (wikiId, pageId, req) => {
      const cur = await ctx.wiki.page(wikiId, pageId)
      // 버전으로 비교하고, 버전이 없을 때만 수정 시각으로 비교한다
      const changed =
        req.baseVersion && cur.version
          ? cur.version !== req.baseVersion
          : !!(req.baseUpdatedAt && cur.updatedAt && cur.updatedAt !== req.baseUpdatedAt)
      if (changed && !req.force) return { status: 'conflict', server: copy(cur) }
      const wid = cur.wikiId || wikiId
      // 서버와 같은 값은 보내지 않는다
      if (req.subject !== null && req.subject !== cur.subject) await ctx.wiki.updateTitle(wid, pageId, req.subject)
      if (req.content !== null && req.content !== cur.content) await ctx.wiki.updateContent(wid, pageId, req.content)
      const after = await ctx.wiki.page(wid, pageId)
      return { status: 'saved', ...copy(after) }
    },
    'wiki:backupAdd': async (b) => {
      const entry: WikiBackup = { ...b, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, savedAt: new Date().toISOString() }
      const list = [entry, ...readBackups(b.pageId)].slice(0, MAX_BACKUPS_PER_PAGE)
      writeBackups(b.pageId, list)
      return entry
    },
    'wiki:backups': async (pageId) => readBackups(pageId),
    'wiki:image': async (wikiId, pageId, src) => {
      const ref = parseWikiImageSrc(src)
      if (!ref) return null
      const key = `${wikiId}|${pageId}|${src}`
      const hit = imageCache.get(key)
      if (hit) {
        // 최근에 쓴 것을 뒤로 (LRU)
        imageCache.delete(key)
        imageCache.set(key, hit)
        return hit
      }
      const file =
        ref.kind === 'attach' ? await ctx.wiki.downloadAttachFile(ref.wikiId, ref.attachFileId) : await ctx.wiki.downloadFile(wikiId, pageId, ref.fileId)
      if (file.bytes.length > MAX_IMAGE_BYTES) return null
      const mime = sniffImage(file.bytes, file.contentType)
      if (!mime) return null
      const url = `data:${mime};base64,${file.bytes.toString('base64')}`
      putImage(key, url)
      return url
    },
    'wiki:uploadImage': async (wikiId, pageId, name, mimeType, bytes) => {
      const buf = Buffer.from(bytes)
      if (buf.length > MAX_IMAGE_BYTES) throw new Error('이미지가 너무 큽니다 (20MB 까지).')
      if (!sniffImage(buf, mimeType)) throw new Error('이미지 파일만 본문에 넣을 수 있습니다.')
      const safe = name.replace(/[\\/:*?"<>|\n\r]/g, '_').slice(0, 120) || 'image.png'
      const r = await ctx.wiki.uploadFile(wikiId, pageId, safe, mimeType, buf, 'inline_image')
      // 공식 문서: 본문에는 ![name](/wikis/{wikiId}/files/{attachFileId}). attachFileId 가 없으면 id 를 쓴다(불확실).
      const fileId = r.attachFileId || r.id
      if (!fileId) throw new Error('업로드 응답에 파일 ID 가 없습니다.')
      const src = `/wikis/${wikiId}/files/${fileId}`
      putImage(`${wikiId}|${pageId}|${src}`, `data:${sniffImage(buf, mimeType)};base64,${buf.toString('base64')}`)
      return { src, name: r.name || safe }
    },
    'wiki:pendingSave': async (pending) => {
      pendingSave = pending
      return null
    },
    'wiki:flushDone': async () => {
      pendingSave = false
      flushWaiter?.()
      return null
    }
  }
}

/** app ready 전에 한 번 (예: protocol.registerSchemesAsPrivileged). */
export function wikiAreaBeforeReady(): void {}

/** 보류 중인 위키 자동 저장을 지금 마무리하게 하고 끝날 때까지 기다린다 (최대 10초). 업데이트 재시작 전에 쓴다 */
export function flushWikiSaves(ctx: MainContext): Promise<void> {
  if (!pendingSave) return Promise.resolve()
  pendingSave = false
  return new Promise<void>((resolve) => {
    const finish = () => {
      if (flushWaiter === finish) flushWaiter = null
      resolve()
    }
    flushWaiter = finish
    setTimeout(finish, 10_000)
    ctx.emit('wiki:flush', null)
  })
}

/** 창을 닫기 전에 보류 중인 위키 저장을 마무리한다 (최대 10초 기다림). */
function guardClose(ctx: MainContext, w: BrowserWindow): void {
  w.on('close', (e) => {
    if (!pendingSave || w.isDestroyed()) return
    e.preventDefault()
    pendingSave = false
    const done = new Promise<void>((resolve) => {
      flushWaiter = resolve
      setTimeout(resolve, 10_000)
    })
    ctx.emit('wiki:flush', null)
    void done.then(() => {
      flushWaiter = null
      if (quitting) app.quit()
      else if (!w.isDestroyed()) w.close()
    })
  })
}

/** app ready 후, 창을 만들기 전에 한 번 (예: protocol.handle, 트레이). */
export function wikiAreaSetup(ctx: MainContext): void {
  app.on('before-quit', () => {
    quitting = true
  })
  app.on('browser-window-created', (_e, w) => guardClose(ctx, w))
}
