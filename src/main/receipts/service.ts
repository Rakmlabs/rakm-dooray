import type { IpcEventName, IpcEvents } from '@shared/ipc'
import type { Member, Wiki } from '@shared/types'
import type { PeerReceipts, ReceiptPosition, ReceiptsSnapshot, ReceiptsState, ReceiptsStatus } from '@shared/types-receipts'
import {
  RECEIPTS_ROOT_TITLE,
  compareIds,
  isRootBody,
  memberIdFromTitle,
  memberPageBody,
  memberPageTitle,
  mergePositions,
  parseMemberBody,
  rootPageBody,
  type MemberDoc
} from '@shared/receipts'
import { NotConfiguredError } from '../dooray/http'
import type { MessengerApi } from '../dooray/messenger'
import type { WikiApi } from '../dooray/wiki'
import { jsonStore } from '../store'

/**
 * 읽음 확인: 앱끼리 "어디까지 읽었는지"를 두레이 위키 페이지로 주고받는다 (서버를 두지 않는다).
 *
 * 저장 위치 (두 사람의 앱이 같은 곳을 고르도록 결정적으로 정한다)
 *   1) 보이는 위키(개인 위키 제외) 홈 아래에서 제목이 RECEIPTS_ROOT_TITLE 이고 표식이 있는 페이지를 모두 찾아,
 *      (위키 ID, 페이지 ID) 가 가장 작은 것을 쓴다. 둘이 동시에 만들어 여럿이 되어도 결국 같은 곳으로 모인다.
 *   2) 없으면 ID 가 가장 작은 위키의 홈 아래에 만든다.
 *   3) 그 아래 사람마다 "읽음 위치 · 이름 (멤버ID)" 페이지 하나. 본문에 표식과 JSON.
 *   표식이 없는 페이지에는 절대 쓰지 않는다.
 *
 * 상대 페이지 목록은 5분마다(아직 못 찾았으면 30초마다) 다시 본다.
 * 요청량: 쓰기는 읽은 위치가 바뀌었을 때만, 30초에 한 번까지 묶어서 (조회 1 + 수정 1).
 *   읽기는 창이 앞에 있을 때 10초, 보이기만 할 때 60초마다 상대 페이지 1건씩. 숨기면 쉰다.
 *   실패하면 15초부터 5분까지 늘려 가며 조용히 다시 시도한다. 메시지 수신과 별개 타이머라 수신을 늦추지 않는다.
 */

interface Cfg {
  enabled: boolean
  manualWikiId: string | null
  location: { wikiId: string; wikiName: string; rootPageId: string; myPageId: string | null; resolvedAt: number } | null
  /** 아직 페이지에 못 쓴 것까지 포함한 내 읽은 위치 (앱을 다시 켜도 이어서) */
  mine: Record<string, ReceiptPosition>
  since: number | null
}

export interface ReceiptsDeps {
  messenger: MessengerApi
  wiki: WikiApi
  emit: <E extends IpcEventName>(event: E, payload: IpcEvents[E]) => void
  /** 창 상태: 앞에 있음 / 보이기만 함 / 숨김 */
  windowState: () => 'focused' | 'visible' | 'hidden'
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

const TICK_MS = 2_000
const WRITE_GAP_MS = 30_000
const WRITE_SETTLE_MS = 1_500
const READ_FOCUSED_MS = 10_000
const READ_VISIBLE_MS = 60_000
const DISCOVER_MS = 5 * 60_000
/** 아직 상대 기록을 못 찾았으면 더 자주 본다 (상대가 나중에 기능을 켠 경우) */
const DISCOVER_EMPTY_MS = 30_000
const RESCAN_MS = 6 * 60 * 60_000
const SCAN_GAP_MS = 300
const MAX_WIKIS_SCANNED = 40

export class ReceiptsService {
  private readonly store = jsonStore<Cfg>('receipts.json', { enabled: true, manualWikiId: null, location: null, mine: {}, since: null })
  private cfg: Cfg
  private me: Member | null = null
  private state: ReceiptsState = 'waiting'
  private detail = ''
  private peers = new Map<string, { pageId: string; data: PeerReceipts | null }>()
  private dirtySince = 0
  private lastWrite = 0
  private lastRead = 0
  private lastDiscover = 0
  private failures = 0
  private retryAt = 0
  private busy = false
  private timer: NodeJS.Timeout | null = null
  private rendererFocused = false
  private lastWriteAt: number | null = null
  private lastReadAt: number | null = null
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly deps: ReceiptsDeps) {
    this.now = deps.now ?? Date.now
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    const c = this.store.read()
    this.cfg = {
      enabled: c.enabled !== false,
      manualWikiId: c.manualWikiId ?? null,
      location: c.location ?? null,
      mine: c.mine && typeof c.mine === 'object' ? c.mine : {},
      since: typeof c.since === 'number' ? c.since : null
    }
    if (!this.cfg.enabled) this.state = 'off'
  }

  start(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  // ---------- renderer 가 부르는 것 ----------

  snapshot(): ReceiptsSnapshot {
    const peers: Record<string, PeerReceipts> = {}
    for (const [id, p] of this.peers) if (p.data) peers[id] = p.data
    return { enabled: this.cfg.enabled && this.state === 'ready', meId: this.me?.id ?? null, peers }
  }

  status(): ReceiptsStatus {
    const l = this.cfg.location
    return {
      enabled: this.cfg.enabled,
      state: this.state,
      detail: this.detail,
      location: l ? { wikiId: l.wikiId, wikiName: l.wikiName, rootPageId: l.rootPageId, rootTitle: RECEIPTS_ROOT_TITLE, myPageId: l.myPageId } : null,
      manual: !!this.cfg.manualWikiId,
      peerCount: [...this.peers.values()].filter((p) => p.data).length,
      lastWriteAt: this.lastWriteAt ? new Date(this.lastWriteAt).toISOString() : null,
      lastReadAt: this.lastReadAt ? new Date(this.lastReadAt).toISOString() : null
    }
  }

  /** 화면에 보이는 대화방의 마지막 메시지. 앞으로만 간다 */
  seen(channelId: string, seq: number, at: number): void {
    if (!this.cfg.enabled || !channelId || !Number.isFinite(seq) || !Number.isFinite(at)) return
    const cur = this.cfg.mine[channelId]
    if (cur && cur.seq >= seq) return
    this.cfg.mine[channelId] = { seq, at }
    if (!this.dirtySince) this.dirtySince = this.now()
    this.save()
  }

  /** 아직 쓰지 않은 읽은 위치가 있으면 30초 간격을 기다리지 않고 지금 쓴다 (업데이트 재시작 전). 실패는 무시 */
  async flush(timeoutMs = 10_000): Promise<void> {
    if (!this.dirtySince || !this.cfg.enabled || this.state !== 'ready') return
    const until = this.now() + timeoutMs
    while (this.busy && this.now() < until) await this.sleep(100)
    if (!this.dirtySince || this.busy) return
    this.busy = true
    try {
      await this.writeMine(false)
    } catch {
      /* 다음에 다시 쓴다 */
    } finally {
      this.busy = false
    }
  }

  setRendererFocused(v: boolean): void {
    this.rendererFocused = v
  }

  async setEnabled(enabled: boolean): Promise<ReceiptsStatus> {
    if (this.cfg.enabled === enabled) return this.status()
    this.cfg.enabled = enabled
    this.save()
    if (!enabled) {
      // 상대 화면에서 내 숫자가 굳지 않게 "껐음"을 한 번 써 둔다 (실패해도 상관없다)
      try {
        await this.writeMine(true)
      } catch {
        /* 무시 */
      }
      this.state = 'off'
      this.peers.clear()
    } else {
      this.state = 'waiting'
      this.retryAt = 0
      this.failures = 0
    }
    this.publish()
    return this.status()
  }

  async chooseWiki(wikiId: string | null): Promise<ReceiptsStatus> {
    this.cfg.manualWikiId = wikiId
    this.cfg.location = null
    this.peers.clear()
    this.save()
    this.retryAt = 0
    this.failures = 0
    this.state = this.cfg.enabled ? 'waiting' : 'off'
    this.publish()
    return this.status()
  }

  async wikiChoices(): Promise<{ id: string; name: string }[]> {
    const list = await this.deps.wiki.wikis()
    return list.filter((w) => !!w.homePageId).map((w) => ({ id: w.id, name: w.name }))
  }

  // ---------- 타이머 ----------

  private async tick(): Promise<void> {
    if (this.busy || !this.cfg.enabled) return
    const now = this.now()
    if (now < this.retryAt) return
    this.busy = true
    try {
      const l = this.cfg.location
      if (!l || !l.myPageId || (!this.cfg.manualWikiId && now - l.resolvedAt > RESCAN_MS)) {
        await this.resolve()
        this.lastDiscover = 0
      }
      if (this.state !== 'ready') return
      const t = this.now()
      if (t - this.lastDiscover > (this.peers.size ? DISCOVER_MS : DISCOVER_EMPTY_MS)) {
        await this.discover()
        this.lastDiscover = t
        this.lastRead = 0
      }
      if (this.dirtySince && t - this.dirtySince >= WRITE_SETTLE_MS && t - this.lastWrite >= WRITE_GAP_MS) {
        await this.writeMine(false)
      }
      const w = this.deps.windowState()
      const focused = w === 'focused' || (w === 'visible' && this.rendererFocused)
      const gap = focused ? READ_FOCUSED_MS : w === 'visible' ? READ_VISIBLE_MS : Infinity
      if (t - this.lastRead >= gap) await this.readPeers()
      this.failures = 0
    } catch (e) {
      if (e instanceof NotConfiguredError) {
        // 요청을 보내지 않은 실패라 짧게 다시 본다
        this.retryAt = this.now() + 15_000
        this.setState('waiting', '두레이 토큰을 넣으면 시작합니다.')
        return
      }
      this.failures++
      this.retryAt = this.now() + Math.min(5 * 60_000, 15_000 * 2 ** (this.failures - 1))
      if (this.state !== 'ready') {
        this.setState('error', `잠시 후 다시 시도합니다: ${e instanceof Error ? e.message : String(e)}`)
      }
    } finally {
      this.busy = false
    }
  }

  // ---------- 저장 위치 ----------

  private async resolve(): Promise<void> {
    this.setState('resolving', '저장 위치를 찾는 중…')
    this.me ??= await this.deps.messenger.me()
    const wikis = await this.deps.wiki.wikis()
    let cands: Wiki[]
    if (this.cfg.manualWikiId) {
      cands = wikis.filter((w) => w.id === this.cfg.manualWikiId && w.homePageId)
      if (!cands.length) return this.setState('needsChoice', '고른 위키를 찾을 수 없습니다. 다시 골라 주세요.')
    } else {
      // 개인 위키는 상대가 볼 수 없어 뺀다
      cands = wikis.filter((w) => w.homePageId && w.type !== 'private').sort((a, b) => compareIds(a.id, b.id))
      if (!cands.length) return this.setState('needsChoice', '함께 쓰는 위키를 찾지 못했습니다. 두 사람이 모두 볼 수 있는 위키를 골라 주세요.')
    }
    const roots: { wikiId: string; wikiName: string; pageId: string }[] = []
    for (const w of cands.slice(0, MAX_WIKIS_SCANNED)) {
      const children = await this.deps.wiki.pages(w.id, w.homePageId)
      for (const p of children.filter((x) => x.subject === RECEIPTS_ROOT_TITLE)) {
        const full = await this.deps.wiki.page(w.id, p.id)
        if (isRootBody(full.content)) roots.push({ wikiId: full.wikiId || w.id, wikiName: w.name, pageId: p.id })
      }
      await this.sleep(SCAN_GAP_MS)
    }
    roots.sort((a, b) => compareIds(a.wikiId, b.wikiId) || compareIds(a.pageId, b.pageId))
    let root = roots[0]
    if (!root) {
      const w = cands[0]
      const { id } = await this.deps.wiki.create(w.id, w.homePageId, RECEIPTS_ROOT_TITLE, rootPageBody())
      if (!id) throw new Error('저장 페이지를 만들지 못했습니다.')
      root = { wikiId: w.id, wikiName: w.name, pageId: id }
      // 두 사람이 같은 순간 처음 켜서 둘 다 만들었을 수 있다: 잠깐 뒤 다시 보고 ID 가 가장 작은 쪽으로 모인다
      await this.sleep(2_000)
      const again = (await this.deps.wiki.pages(w.id, w.homePageId)).filter((x) => x.subject === RECEIPTS_ROOT_TITLE)
      for (const p of again.sort((x, y) => compareIds(x.id, y.id))) {
        if (compareIds(p.id, root.pageId) >= 0) break
        const full = await this.deps.wiki.page(w.id, p.id)
        if (isRootBody(full.content)) {
          root = { wikiId: w.id, wikiName: w.name, pageId: p.id }
          break
        }
      }
    }
    const myPageId = await this.ensureMyPage(root.wikiId, root.pageId)
    this.cfg.location = { ...root, rootPageId: root.pageId, myPageId, resolvedAt: this.now() }
    this.save()
    this.setState('ready', '')
  }

  /** 내 페이지를 찾거나 만든다. 페이지에 있던 위치(다른 컴퓨터에서 쓴 것)와 합친다 */
  private async ensureMyPage(wikiId: string, rootPageId: string): Promise<string> {
    const me = this.me!
    const children = await this.deps.wiki.pages(wikiId, rootPageId)
    for (const p of children.filter((x) => memberIdFromTitle(x.subject) === me.id)) {
      const full = await this.deps.wiki.page(wikiId, p.id)
      const doc = parseMemberBody(full.content, me.id)
      if (!doc) continue // 표식이 없거나 망가진 페이지에는 쓰지 않는다
      if (mergePositions(this.cfg.mine, doc.channels)) this.dirtySince ||= this.now()
      this.cfg.since = Math.min(this.cfg.since ?? doc.since, doc.since)
      if (!doc.enabled) this.dirtySince ||= this.now() // 껐다가 다시 켠 것을 알린다
      return p.id
    }
    this.cfg.since ??= this.now()
    const doc = this.doc(true)
    const { id } = await this.deps.wiki.create(wikiId, rootPageId, memberPageTitle(me.name, me.id), memberPageBody(doc))
    if (!id) throw new Error('내 읽음 위치 페이지를 만들지 못했습니다.')
    this.lastWrite = this.now()
    this.lastWriteAt = this.lastWrite
    this.dirtySince = 0
    return id
  }

  private doc(enabled: boolean): MemberDoc {
    return {
      v: 1,
      memberId: this.me!.id,
      enabled,
      since: this.cfg.since ?? this.now(),
      updatedAt: this.now(),
      channels: { ...this.cfg.mine }
    }
  }

  // ---------- 쓰기·읽기 ----------

  /** 내 페이지를 고친다. 쓰기 전에 표식을 확인한다 */
  private async writeMine(disabling: boolean): Promise<void> {
    const l = this.cfg.location
    if (!l?.myPageId || !this.me) return
    const full = await this.deps.wiki.page(l.wikiId, l.myPageId)
    const current = parseMemberBody(full.content, this.me.id)
    if (!current) {
      // 표식이 없다: 사람이 고쳤거나 다른 페이지다. 쓰지 않고 위치를 다시 정한다
      this.cfg.location = { ...l, myPageId: null }
      this.save()
      throw new Error('읽음 위치 페이지의 표식이 없어 쓰지 않았습니다.')
    }
    mergePositions(this.cfg.mine, current.channels)
    const next = this.doc(!disabling)
    const same =
      current.enabled === next.enabled &&
      Object.keys(next.channels).length === Object.keys(current.channels).length &&
      Object.entries(next.channels).every(([k, v]) => current.channels[k]?.seq === v.seq)
    this.dirtySince = 0
    if (same) return
    await this.deps.wiki.updateContent(full.wikiId || l.wikiId, l.myPageId, memberPageBody(next))
    this.lastWrite = this.now()
    this.lastWriteAt = this.lastWrite
    this.save()
    this.publishStatus()
  }

  /** 저장 위치 아래의 다른 사람 페이지 목록 */
  private async discover(): Promise<void> {
    const l = this.cfg.location!
    const children = await this.deps.wiki.pages(l.wikiId, l.rootPageId)
    const seen = new Set<string>()
    for (const p of children) {
      const id = memberIdFromTitle(p.subject)
      if (!id || id === this.me?.id) continue
      seen.add(id)
      const prev = this.peers.get(id)
      if (!prev || prev.pageId !== p.id) this.peers.set(id, { pageId: p.id, data: null })
    }
    for (const id of [...this.peers.keys()]) if (!seen.has(id)) this.peers.delete(id)
  }

  private async readPeers(): Promise<void> {
    const l = this.cfg.location!
    let changed = false
    for (const [id, p] of this.peers) {
      const full = await this.deps.wiki.page(l.wikiId, p.pageId)
      const doc = parseMemberBody(full.content, id)
      // 페이지를 만든 사람과 기록의 주인이 다르면 믿지 않는다
      const trusted = doc && doc.enabled && (!full.creatorId || full.creatorId === id)
      const data: PeerReceipts | null = trusted ? { memberId: id, since: doc.since, updatedAt: doc.updatedAt, channels: doc.channels } : null
      if (JSON.stringify(data) !== JSON.stringify(p.data)) {
        p.data = data
        changed = true
      }
    }
    this.lastRead = this.now()
    this.lastReadAt = this.lastRead
    if (changed) this.publish()
  }

  // ---------- 알림 ----------

  private setState(s: ReceiptsState, detail: string): void {
    if (this.state === s && this.detail === detail) return
    this.state = s
    this.detail = detail
    this.publish()
  }

  private publishStatus(): void {
    this.deps.emit('receipts:status', this.status())
  }

  private publish(): void {
    this.deps.emit('receipts:snapshot', this.snapshot())
    this.publishStatus()
  }

  private save(): void {
    this.store.write(this.cfg)
  }
}
