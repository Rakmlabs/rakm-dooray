import { app, Notification } from 'electron'
import { join } from 'node:path'
import type { Channel, Member, Message, WikiPage, WikiPageSummary } from '@shared/types'
import type { IpcEventName, IpcEvents } from '@shared/ipc'
import type { ConnectionState, ShellState, UnreadPayload } from '@shared/types-shell'
import { DoorayApiError, NotConfiguredError } from '../dooray/http'
import type { MessengerApi } from '../dooray/messenger'
import type { WikiApi } from '../dooray/wiki'
import { dataDir, jsonStore } from '../store'
import { mockBase } from '../settings'
import { LocalArchive, previewText } from './archive'
import { normalizeState, notifiable } from './rules'
import type { NotifyPermissionTracker } from './notify-permission'

/**
 * 셸 영역의 main 쪽 두뇌.
 * - 받아 온 메시지를 로컬 보관함에 쌓는다 (archive.ts)
 * - 뒤에서 대화방을 천천히 훑어 안 읽은 수·Dock 배지·데스크톱 알림을 만든다 (두레이에는 읽음 API 도, 공식 실시간 수신도 없다)
 * - 위키 페이지 트리를 천천히 모아 ⌘K·검색용 색인을 만든다
 * 요청 사이에 간격을 두어 두레이 요청 제한(토큰 버킷, 수치 비공개)을 배려한다.
 */

export interface ShellDeps {
  messenger: MessengerApi
  wiki: WikiApi
  emit: <E extends IpcEventName>(event: E, payload: IpcEvents[E]) => void
  /** 창이 앞에 있는지 */
  isFocused: () => boolean
  /** 창을 띄운다 (없으면 만든다). 다 뜬 뒤 resolve */
  showWindow: () => Promise<void>
  onStateApplied: (s: ShellState) => void
  /** 알림 권한 (알림을 보낸 결과로 판단) */
  permission: NotifyPermissionTracker
}

// 모의 서버로 화면을 확인할 때(개발 전용)는 빨리 돈다
const FAST = !app.isPackaged && !!mockBase()
const TICK_MS = FAST ? 4_000 : 15_000
const CHANNELS_TTL = FAST ? 3_000 : 25_000
const GAP_MS = 400
const WIKI_GAP_MS = 1_200
const WIKI_RECRAWL_MS = 6 * 60 * 60 * 1000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class ShellService {
  archive: LocalArchive | null = null
  archiveError: string | null = null
  private readonly stateFile = jsonStore<unknown>('shell-state.json', {})
  state: ShellState = normalizeState({})
  private me: Member | null = null
  private channels: Channel[] = []
  private channelsAt = 0
  private updatedSnapshot = new Map<string, string | null>()
  private dirty = new Set<string>()
  private rr = 0
  private firstScan = true
  private viewing: string | null = null
  private timer: NodeJS.Timeout | null = null
  private unreadTimer: NodeJS.Timeout | null = null
  private connection: ConnectionState = { online: true, detail: '' }
  private crawling = false
  private lastWikiPage: { wikiId: string; pageId: string } | null = null
  private memberCache = new Map<string, Member>()
  private notifications = new Set<Notification>()
  /** 이 시각 이후에 온 메시지는 처음 보는 대화방이어도 안 읽음으로 센다 (설치·업데이트 직후 첫 실행 시각) */
  private baselineMs = Date.now()

  constructor(private readonly deps: ShellDeps) {}

  start(): void {
    this.state = normalizeState(this.stateFile.read())
    try {
      this.archive = new LocalArchive(join(dataDir('local'), 'archive.db'))
      const last = this.archive.kv('lastWikiPage')
      const base = Number(this.archive.kv('unreadBaseline'))
      if (Number.isFinite(base) && base > 0) this.baselineMs = base
      else this.archive.setKv('unreadBaseline', String(this.baselineMs))
      if (last) this.lastWikiPage = JSON.parse(last)
    } catch (e) {
      // 보관함을 못 열어도 앱은 서버 데이터만으로 동작한다
      this.archiveError = e instanceof Error ? e.message : String(e)
      console.error(`[shell] 로컬 보관함을 열지 못함: ${this.archiveError}`)
    }
    this.deps.onStateApplied(this.state)
    this.timer = setTimeout(() => void this.tick(), 3_000)
    setTimeout(() => void this.crawlWikis(false), 12_000)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    try {
      this.archive?.close()
    } catch {
      /* 무시 */
    }
    this.archive = null
  }

  // ---------- 상태 ----------

  getState(): ShellState {
    return this.state
  }

  saveState(next: ShellState): ShellState {
    this.state = normalizeState(next)
    this.stateFile.write(this.state)
    this.deps.onStateApplied(this.state)
    this.scheduleUnread()
    return this.state
  }

  getConnection(): ConnectionState {
    return this.connection
  }

  private setConnection(online: boolean, detail = ''): void {
    if (this.connection.online === online && this.connection.detail === detail) return
    this.connection = { online, detail }
    this.deps.emit('shell:connectionChanged', this.connection)
  }

  /** 요청 실패를 보고 연결 상태를 정한다. 네트워크가 끊긴 경우만 오프라인으로 본다. */
  noteResult(e: unknown | null): void {
    if (e === null) return this.setConnection(true)
    if (e instanceof NotConfiguredError) return
    if (e instanceof DoorayApiError) {
      if (e.status >= 500) this.setConnection(false, `두레이 서버 응답 오류 (${e.status})`)
      return
    }
    this.setConnection(false, '두레이에 연결할 수 없습니다. 인터넷 연결을 확인하세요.')
  }

  // ---------- 메시지 ----------

  async meId(): Promise<string | null> {
    if (this.me) return this.me.id
    try {
      this.me = await this.deps.messenger.me()
      this.memberCache.set(this.me.id, this.me)
      // 토큰이 확인됐다: 아직 알림 권한을 물은 적이 없으면 지금 묻는다 (안 읽은 메시지가 생길 때까지 기다리지 않는다)
      if (this.state.prefs.notify.enabled) this.deps.permission.askOnce()
    } catch {
      return null
    }
    return this.me.id
  }

  noteChannels(list: Channel[]): void {
    this.channels = list
    this.channelsAt = Date.now()
    for (const c of list) {
      const prev = this.updatedSnapshot.get(c.id)
      if (prev !== undefined && prev !== c.updatedAt) this.dirty.add(c.id)
      this.updatedSnapshot.set(c.id, c.updatedAt)
    }
    this.scheduleUnread()
  }

  noteActivity(channelId: string): void {
    this.dirty.add(channelId)
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = setTimeout(() => void this.tick(), 500)
    }
  }

  async channelList(): Promise<Channel[]> {
    if (Date.now() - this.channelsAt > CHANNELS_TTL || this.channels.length === 0) {
      try {
        this.noteChannels(await this.deps.messenger.channels())
        this.noteResult(null)
      } catch (e) {
        this.noteResult(e)
        if (this.channels.length === 0) throw e
      }
    }
    return this.channels
  }

  /**
   * 서버에서 최신 size 개를 받아 쌓는다. 받은 것이 전부 처음 보는 것이고 요청한 만큼 꽉 찼으면
   * 그 사이(지난번에 받은 것과 이번 것 사이)를 놓쳤을 수 있어 최대치(1000)로 한 번 더 받는다.
   */
  async fetchInto(channelId: string, size: number): Promise<Message[]> {
    const list = await this.deps.messenger.logs(channelId, size)
    const added = this.ingest(channelId, list, size)
    const a = this.archive
    if (a && size < 1000 && list.length >= size && added === list.length && a.count(channelId) > added) {
      await sleep(GAP_MS)
      this.ingest(channelId, await this.deps.messenger.logs(channelId, 1000), 1000)
    }
    return list
  }

  /** 서버에서 받은 메시지 묶음을 보관함에 넣고, 안 읽음·알림을 갱신한다. 처음 본 메시지 수를 돌려준다. */
  ingest(channelId: string, list: Message[], requestedSize: number): number {
    const a = this.archive
    if (!a) return 0
    const known = this.channels.some((c) => c.id === channelId)
    const readBefore = a.readMs(channelId)
    let added: Message[]
    try {
      added = a.ingest(channelId, list, requestedSize).added
    } catch (e) {
      console.error(`[shell] 보관 실패: ${e instanceof Error ? e.message : e}`)
      return 0
    }
    if (!known) return added.length // 스레드 채널 등은 보관만 한다
    // 처음 보는 대화방: 앱을 처음 켠 시각 이전 것만 읽은 것으로 시작한다.
    //   설치 직후 예전 메시지가 안 읽음으로 쏟아지지 않게 하되, 그 뒤에 새로 생긴 방(처음 온 1:1 등)의 메시지는 안 읽음으로 센다.
    const readFrom = readBefore ?? a.markRead(channelId, this.baselineMs)
    if (this.watching(channelId)) a.markRead(channelId)
    else if (added.length) void this.notify(channelId, added, readFrom)
    this.scheduleUnread()
    return added.length
  }

  page(channelId: string, limit: number, includeId: string | null, fallback: Message[]) {
    const a = this.archive
    if (!a) return { messages: fallback, hasOlder: false }
    try {
      return a.page(channelId, limit, includeId)
    } catch {
      return { messages: fallback, hasOlder: false }
    }
  }

  private watching(channelId: string): boolean {
    return this.viewing === channelId && this.deps.isFocused()
  }

  setViewing(channelId: string | null): void {
    this.viewing = channelId
    if (channelId && this.deps.isFocused()) this.markRead(channelId)
  }

  /** 창이 다시 앞에 오면 보고 있던 방은 읽은 것으로. 그 사이 온 것이 있으면 화면에 "여기까지 읽음" 위치를 다시 알린다 */
  onFocus(): void {
    const id = this.viewing
    const a = this.archive
    if (!id || !a) return
    const before = a.readMs(id)
    if (a.markRead(id) === before) return
    this.scheduleUnread()
    this.deps.emit('shell:readMarker', { channelId: id, readAt: before === null ? null : new Date(before).toISOString() })
  }

  /** 대화방을 열 때. 창이 앞에 있을 때만 읽음으로 바꾼다 (로그인 때 뒤에서 켜지며 마지막 방을 다시 열 때는 그대로 둔다) */
  openChannel(channelId: string): { readAt: string | null } {
    const a = this.archive
    if (!a) return { readAt: null }
    const before = a.readMs(channelId)
    if (this.deps.isFocused()) {
      a.markRead(channelId)
      this.scheduleUnread()
    }
    return { readAt: before === null ? null : new Date(before).toISOString() }
  }

  private markRead(channelId: string): void {
    const a = this.archive
    if (!a) return
    const before = a.readMs(channelId)
    if (a.markRead(channelId) !== before) this.scheduleUnread()
  }

  summaries(): UnreadPayload {
    const a = this.archive
    const summaries: UnreadPayload['summaries'] = {}
    let total = 0
    if (!a) return { summaries, total }
    const meId = this.me?.id ?? null
    const muted = new Set(this.state.prefs.notify.muted)
    for (const c of this.channels) {
      const s = a.summary(c.id, meId)
      summaries[c.id] = s
      // 알림을 끈 방은 Dock 배지 합계에서 뺀다
      if (!muted.has(c.id)) total += s.unread
    }
    return { summaries, total }
  }

  private scheduleUnread(): void {
    if (this.unreadTimer) return
    this.unreadTimer = setTimeout(() => {
      this.unreadTimer = null
      const p = this.summaries()
      this.deps.emit('shell:unread', p)
      app.setBadgeCount(p.total)
      this.onUnread?.(p.total)
    }, 250)
  }

  /** 트레이 제목 갱신용 */
  onUnread: ((total: number) => void) | null = null

  // ---------- 알림 ----------

  private async nameOf(id: string): Promise<string> {
    const c = this.memberCache.get(id)
    if (c) return c.name
    try {
      const m = await this.deps.messenger.member(id)
      this.memberCache.set(id, m)
      return m.name
    } catch {
      return '알 수 없음'
    }
  }

  private async notify(channelId: string, added: Message[], readBefore: number): Promise<void> {
    const prefs = this.state.prefs.notify
    if (!prefs.enabled || !Notification.isSupported()) return
    const list = notifiable(added, {
      meId: this.me?.id ?? (await this.meId()),
      readMsBefore: readBefore,
      now: Date.now(),
      muted: prefs.muted.includes(channelId),
      watching: this.watching(channelId)
    })
    if (!list.length) return
    const ch = this.channels.find((c) => c.id === channelId)
    const last = list[list.length - 1]
    const sender = await this.nameOf(last.senderId!)
    const title = ch?.type === 'direct' || !ch?.title ? sender : `${ch.title}`
    const text = prefs.preview ? previewText(last) || '새 메시지' : '새 메시지'
    const body = (ch?.type === 'direct' || !ch?.title ? '' : `${sender}: `) + text + (list.length > 1 ? ` 외 ${list.length - 1}개` : '')
    const n = new Notification({ title, body, silent: !prefs.sound })
    this.notifications.add(n)
    n.on('click', () => {
      this.notifications.delete(n)
      void this.deps.showWindow().then(() => this.deps.emit('shell:navigate', { kind: 'channel', channelId, messageId: last.id }))
    })
    n.on('close', () => this.notifications.delete(n))
    n.on('failed', () => this.notifications.delete(n))
    void this.deps.permission.show(n)
  }

  testNotification() {
    if (!Notification.isSupported()) throw new Error('이 컴퓨터에서는 데스크톱 알림을 쓸 수 없습니다.')
    const n = new Notification({
      title: app.getName(),
      body: this.state.prefs.notify.preview ? '알림이 이렇게 보입니다.' : '새 메시지',
      silent: !this.state.prefs.notify.sound
    })
    return this.deps.permission.show(n)
  }

  // ---------- 뒤에서 훑기 ----------

  private async tick(): Promise<void> {
    this.timer = null
    try {
      await this.meId()
      const channels = await this.channelList()
      const targets: { id: string; size: number }[] = []
      const add = (id: string, size: number) => {
        if (!targets.some((t) => t.id === id)) targets.push({ id, size })
      }
      // 1) 바뀐 방 (채널 updatedAt 변화 또는 실시간 이벤트)
      for (const id of this.dirty) if (channels.some((c) => c.id === id)) add(id, 50)
      this.dirty.clear()
      // 2) 아직 기록을 다 받지 않은 방 (최신 1000개를 한 번 받아 보관함·검색에 채운다), 한 번에 하나씩
      const notBackfilled = channels.find((c) => c.status !== 'deleted' && this.archive && !this.archive.isBackfilled(c.id))
      if (notBackfilled) add(notBackfilled.id, 1000)
      // 3) updatedAt 이 새 메시지마다 바뀌는지 확인되지 않아, 나머지 방도 돌아가며 조금씩 본다.
      //    앱을 켠 직후 한 번은 모든 방을 훑어 꺼져 있던 동안의 안 읽음을 바로 계산한다.
      const live = channels.filter((c) => c.status !== 'deleted').sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
      const fullScan = this.firstScan
      if (fullScan) {
        for (const c of live) add(c.id, 50)
      } else {
        for (let i = 0; i < Math.min(3, live.length); i++) add(live[(this.rr + i) % live.length].id, 30)
        this.rr += 3
      }
      // 한 방이 실패해도 나머지는 계속 본다. 전부 훑은 뒤에만 첫 훑기를 끝낸 것으로 친다 (켜자마자 네트워크가 없었으면 다음 차례에 다시)
      let failed: unknown = null
      for (const t of targets) {
        try {
          await this.fetchInto(t.id, t.size)
          if (t.size === 1000) this.archive?.setBackfilled(t.id)
        } catch (e) {
          failed = e
          if (!(e instanceof DoorayApiError) || e.status === 429 || e.status >= 500) break
        }
        await sleep(GAP_MS)
      }
      if (failed) throw failed
      if (fullScan) this.firstScan = false
      this.noteResult(null)
    } catch (e) {
      this.noteResult(e)
    } finally {
      this.timer = setTimeout(() => void this.tick(), TICK_MS)
    }
  }

  // ---------- 위키 색인 ----------

  noteWikiPages(wikiId: string, pages: WikiPageSummary[]): void {
    try {
      this.archive?.upsertWikiPages(
        wikiId,
        '',
        pages.map((p) => ({ id: p.id, parentPageId: p.parentPageId, subject: p.subject }))
      )
    } catch {
      /* 색인은 없어도 된다 */
    }
  }

  noteWikiPage(p: WikiPage): void {
    this.lastWikiPage = { wikiId: p.wikiId, pageId: p.id }
    try {
      this.archive?.upsertWikiPages(p.wikiId, '', [{ id: p.id, parentPageId: p.parentPageId, subject: p.subject }])
      this.archive?.setWikiBody(p.id, `${p.subject}\n${p.content}`, p.updatedAt)
      this.archive?.setKv('lastWikiPage', JSON.stringify(this.lastWikiPage))
    } catch {
      /* 무시 */
    }
  }

  noteWikiDeleted(pageId: string): void {
    this.archive?.removeWikiPage(pageId)
  }

  getLastWikiPage() {
    return this.lastWikiPage
  }

  isCrawling(): boolean {
    return this.crawling
  }

  /** 위키별 페이지 트리를 한 단계씩 천천히 모은다. force 가 아니면 6시간 안에 모은 위키는 건너뛴다. */
  async crawlWikis(force: boolean): Promise<void> {
    const a = this.archive
    if (!a || this.crawling) return
    this.crawling = true
    try {
      const wikis = await this.deps.wiki.wikis()
      for (const w of wikis) {
        const key = `wikiCrawl:${w.id}`
        const last = Number(a.kv(key) ?? 0)
        if (!force && Date.now() - last < WIKI_RECRAWL_MS) continue
        const started = Date.now()
        const queue: (string | null)[] = [null]
        let ok = true
        let guard = 0
        while (queue.length && guard++ < 2000) {
          const parent = queue.shift()!
          let pages: WikiPageSummary[]
          try {
            pages = await this.deps.wiki.pages(w.id, parent)
          } catch (e) {
            if (e instanceof NotConfiguredError) throw e
            ok = false
            break
          }
          a.upsertWikiPages(
            w.id,
            w.name,
            pages.map((p) => ({ id: p.id, parentPageId: p.parentPageId ?? parent, subject: p.subject }))
          )
          for (const p of pages) queue.push(p.id)
          await sleep(WIKI_GAP_MS)
        }
        if (ok && guard < 2000) {
          a.pruneWiki(w.id, started)
          a.setKv(key, String(Date.now()))
        }
      }
      this.noteResult(null)
    } catch (e) {
      this.noteResult(e)
    } finally {
      this.crawling = false
    }
    setTimeout(() => void this.crawlWikis(false), WIKI_RECRAWL_MS)
  }

  async knownMembers(): Promise<Member[]> {
    const ids = new Set<string>()
    for (const c of this.channels) for (const id of c.participantIds) ids.add(id)
    const out: Member[] = []
    // 대화방에 있는 사람만 (조직 전체는 이름 검색으로 찾는다). 캐시에 없으면 하나씩 조회.
    for (const id of ids) {
      const cached = this.memberCache.get(id)
      if (cached) {
        out.push(cached)
        continue
      }
      try {
        const m = await this.deps.messenger.member(id)
        this.memberCache.set(id, m)
        out.push(m)
      } catch {
        /* 건너뜀 */
      }
    }
    return out
  }
}
