// 보관함 검색을 작업 스레드에서. 스레드를 못 띄우거나 죽으면 그 자리(메인)에서 돌린다.
import type { Worker } from 'node:worker_threads'
import createSearchWorker from './searchWorker?nodeWorker'
import type { LocalArchive } from './archive'
import type { MessageHit, WikiHit } from '@shared/types-shell'
import type { SearchRequest } from './searchWorker'

type Result = { messages: MessageHit[]; wiki: WikiHit[] }
const TIMEOUT_MS = 10_000

export class ArchiveSearch {
  private worker: Worker | null = null
  private broken = false
  private seq = 0
  private readonly waiting = new Map<number, { query: string; channelId: string | null; resolve: (r: Result) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>()

  constructor(
    private readonly path: string,
    private readonly fallback: () => LocalArchive | null
  ) {}

  async search(query: string, channelId: string | null): Promise<Result> {
    const w = this.ensure()
    if (!w) return this.inline(query, channelId)
    const id = ++this.seq
    return new Promise<Result>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id)
        reject(new Error('검색이 너무 오래 걸립니다. 검색어를 더 길게 입력해 보세요.'))
      }, TIMEOUT_MS)
      this.waiting.set(id, { query, channelId, resolve, reject, timer })
      w.postMessage({ id, query, channelId } satisfies SearchRequest)
    })
  }

  stop(): void {
    const w = this.worker
    this.worker = null
    void w?.terminate()
  }

  private inline(query: string, channelId: string | null): Result {
    const a = this.fallback()
    return { messages: a?.searchMessages(query, channelId) ?? [], wiki: channelId ? [] : (a?.searchWiki(query) ?? []) }
  }

  private ensure(): Worker | null {
    if (this.worker || this.broken) return this.worker
    try {
      const w = createSearchWorker({ workerData: { path: this.path } })
      w.unref()
      w.on('message', (m: { id: number; ok: boolean; value?: Result; error?: string }) => {
        const p = this.waiting.get(m.id)
        if (!p) return
        this.waiting.delete(m.id)
        clearTimeout(p.timer)
        if (m.ok && m.value) p.resolve(m.value)
        else p.reject(new Error(m.error ?? '검색 실패'))
      })
      // 스레드가 죽으면 이후로는 메인에서 돌리고, 기다리던 검색도 메인에서 마저 한다
      const die = (why?: unknown) => {
        if (this.worker !== w) return
        console.warn(`[search] 작업 스레드를 못 써서 메인에서 검색합니다: ${why instanceof Error ? why.message : String(why ?? '종료')}`)
        this.worker = null
        this.broken = true
        for (const [, p] of this.waiting) {
          clearTimeout(p.timer)
          try {
            p.resolve(this.inline(p.query, p.channelId))
          } catch (e) {
            p.reject(e instanceof Error ? e : new Error(String(e)))
          }
        }
        this.waiting.clear()
      }
      w.on('error', die)
      w.on('exit', die)
      this.worker = w
    } catch (e) {
      console.warn(`[search] 작업 스레드를 띄우지 못함: ${e instanceof Error ? e.message : String(e)}`)
      this.broken = true
    }
    return this.worker
  }
}
