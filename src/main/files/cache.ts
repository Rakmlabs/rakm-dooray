// 내려받은 채팅 파일 캐시. userData/file-cache 아래에만 둔다.
// - 키는 channelId + fileId. 요청은 이 둘로만 받고, 디스크 경로는 이 모듈이 만든다 (경로 탐색 방지).
// - 용량 상한을 넘으면 가장 오래 안 쓴 것부터 지운다 (LRU).
// - electron 을 직접 쓰지 않는다 (다운로드·썸네일 함수를 주입받는다) → 단위 테스트 가능.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { mimeFromName, type FileCacheStats } from '@shared/types-files'

export interface CacheEntry {
  key: string
  channelId: string
  fileId: string
  /** 디스크에 저장한 파일 이름 (원래 이름을 안전하게 바꾼 것) */
  name: string
  mime: string
  size: number
  /** 썸네일 파일 크기 (없으면 0). 썸네일을 만들 수 없으면 -1 */
  thumbSize: number
  thumbExt?: 'jpg' | 'png'
  /** 마지막 사용 시각 (ms) */
  at: number
}

export interface Downloaded {
  bytes: Buffer
  fileName: string | null
  contentType: string | null
}

export interface FileCacheOptions {
  dir: string
  limitBytes: () => number
  download: (channelId: string, fileId: string) => Promise<Downloaded>
  /** src 이미지를 dest 로 축소 저장. 축소할 필요가 없거나 못 하면 null */
  makeThumb?: (src: string, ext: 'jpg' | 'png') => Promise<Buffer | null>
  now?: () => number
}

export function cacheKey(channelId: string, fileId: string): string {
  return createHash('sha256').update(`${channelId}\0${fileId}`).digest('hex').slice(0, 40)
}

/** 디스크에 쓸 안전한 파일 이름. 확장자는 지킨다 (Quick Look·기본 앱이 형식을 알아보게). */
export function safeFileName(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[\0-\x1f<>:"|?*]/g, '_').replace(/^\.+/, '').trim()
  if (!base) return 'file'
  if (base.length <= 120) return base
  const dot = base.lastIndexOf('.')
  const ext = dot > 0 && base.length - dot <= 12 ? base.slice(dot) : ''
  return base.slice(0, 120 - ext.length) + ext
}

export class FileCache {
  private index = new Map<string, CacheEntry>()
  private readonly inflight = new Map<string, Promise<CacheEntry>>()
  private readonly thumbInflight = new Map<string, Promise<void>>()
  private saveTimer: NodeJS.Timeout | null = null
  private readonly now: () => number

  constructor(private readonly opts: FileCacheOptions) {
    this.now = opts.now ?? Date.now
    mkdirSync(join(opts.dir, 'blobs'), { recursive: true })
    mkdirSync(join(opts.dir, 'thumbs'), { recursive: true })
    this.load()
  }

  private get indexPath(): string {
    return join(this.opts.dir, 'index.json')
  }

  private load(): void {
    if (!existsSync(this.indexPath)) return
    try {
      const list = JSON.parse(readFileSync(this.indexPath, 'utf8')) as CacheEntry[]
      for (const e of list) {
        if (e && typeof e.key === 'string' && /^[0-9a-f]{40}$/.test(e.key) && existsSync(this.blobPath(e))) this.index.set(e.key, e)
      }
    } catch {
      this.index.clear()
    }
  }

  /** 색인 저장 (자주 불리므로 모아서 쓴다) */
  private persist(immediate = false): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    const write = () => {
      const p = this.indexPath
      writeFileSync(p + '.tmp', JSON.stringify([...this.index.values()]), { encoding: 'utf8', mode: 0o600 })
      renameSync(p + '.tmp', p)
    }
    if (immediate) write()
    else this.saveTimer = setTimeout(write, 400)
  }

  flush(): void {
    if (this.saveTimer) this.persist(true)
  }

  blobPath(e: Pick<CacheEntry, 'key' | 'name'>): string {
    return join(this.opts.dir, 'blobs', e.key, e.name)
  }

  thumbPath(e: CacheEntry): string {
    return join(this.opts.dir, 'thumbs', `${e.key}.${e.thumbExt ?? 'jpg'}`)
  }

  get(channelId: string, fileId: string): CacheEntry | null {
    return this.index.get(cacheKey(channelId, fileId)) ?? null
  }

  has(channelId: string, fileId: string): boolean {
    return this.index.has(cacheKey(channelId, fileId))
  }

  /** 캐시에 있으면 그대로, 없으면 내려받아 넣는다. 같은 파일 동시 요청은 한 번만 받는다. */
  ensure(channelId: string, fileId: string, nameHint: string): Promise<CacheEntry> {
    const key = cacheKey(channelId, fileId)
    const hit = this.index.get(key)
    if (hit) {
      hit.at = this.now()
      this.persist()
      return Promise.resolve(hit)
    }
    const running = this.inflight.get(key)
    if (running) return running
    const p = this.fetchInto(key, channelId, fileId, nameHint).finally(() => this.inflight.delete(key))
    this.inflight.set(key, p)
    return p
  }

  private async fetchInto(key: string, channelId: string, fileId: string, nameHint: string): Promise<CacheEntry> {
    const d = await this.opts.download(channelId, fileId)
    const name = safeFileName(nameHint || d.fileName || 'file')
    let mime = mimeFromName(name)
    if (mime === 'application/octet-stream' && d.contentType) mime = d.contentType.split(';')[0].trim() || mime
    const entry: CacheEntry = { key, channelId, fileId, name, mime, size: d.bytes.length, thumbSize: 0, at: this.now() }
    const dir = join(this.opts.dir, 'blobs', key)
    await mkdir(dir, { recursive: true })
    const tmp = join(dir, `.${name}.part`)
    await writeFile(tmp, d.bytes, { mode: 0o600 })
    renameSync(tmp, this.blobPath(entry))
    this.index.set(key, entry)
    this.evict(key)
    this.persist()
    return entry
  }

  /** 이미지 썸네일. 만들 수 없거나 원본이 충분히 작으면 원본 경로를 돌려준다. */
  async thumb(channelId: string, fileId: string, nameHint: string): Promise<{ path: string; mime: string }> {
    const e = await this.ensure(channelId, fileId, nameHint)
    if (e.thumbSize === 0 && this.opts.makeThumb) {
      let job = this.thumbInflight.get(e.key)
      if (!job) {
        job = this.buildThumb(e).finally(() => this.thumbInflight.delete(e.key))
        this.thumbInflight.set(e.key, job)
      }
      await job
    }
    if (e.thumbSize > 0 && existsSync(this.thumbPath(e))) {
      return { path: this.thumbPath(e), mime: e.thumbExt === 'png' ? 'image/png' : 'image/jpeg' }
    }
    return { path: this.blobPath(e), mime: e.mime }
  }

  private async buildThumb(e: CacheEntry): Promise<void> {
    const ext: 'jpg' | 'png' = e.mime === 'image/jpeg' ? 'jpg' : 'png'
    let buf: Buffer | null = null
    try {
      buf = (await this.opts.makeThumb?.(this.blobPath(e), ext)) ?? null
    } catch {
      buf = null
    }
    if (!buf) {
      e.thumbSize = -1
    } else {
      e.thumbExt = ext
      await writeFile(this.thumbPath(e), buf, { mode: 0o600 })
      e.thumbSize = buf.length
    }
    this.persist()
  }

  stats(): FileCacheStats {
    let bytes = 0
    for (const e of this.index.values()) bytes += e.size + Math.max(0, e.thumbSize)
    return { bytes, count: this.index.size, limitBytes: this.opts.limitBytes() }
  }

  /** 상한을 넘으면 오래 안 쓴 것부터 지운다. keep 은 방금 넣은 것 (지우지 않는다). */
  evict(keep?: string): void {
    const limit = this.opts.limitBytes()
    let { bytes } = this.stats()
    if (bytes <= limit) return
    const order = [...this.index.values()].sort((a, b) => a.at - b.at)
    for (const e of order) {
      if (bytes <= limit) break
      if (e.key === keep) continue
      bytes -= e.size + Math.max(0, e.thumbSize)
      this.drop(e)
    }
    this.persist()
  }

  private drop(e: CacheEntry): void {
    this.index.delete(e.key)
    void rm(join(this.opts.dir, 'blobs', e.key), { recursive: true, force: true })
    void rm(this.thumbPath(e), { force: true })
  }

  async clear(): Promise<void> {
    this.index.clear()
    this.persist(true)
    await rm(join(this.opts.dir, 'blobs'), { recursive: true, force: true })
    await rm(join(this.opts.dir, 'thumbs'), { recursive: true, force: true })
    mkdirSync(join(this.opts.dir, 'blobs'), { recursive: true })
    mkdirSync(join(this.opts.dir, 'thumbs'), { recursive: true })
  }

  /** 디스크 크기 확인용 (테스트) */
  async sizeOnDisk(e: CacheEntry): Promise<number> {
    return (await stat(this.blobPath(e))).size
  }
}
