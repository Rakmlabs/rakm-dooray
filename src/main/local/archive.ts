import { parseSystem, systemText } from '@shared/system-message'
import { DatabaseSync, type StatementSync } from 'node:sqlite'
import type { Message } from '@shared/types'
import type { ChannelSummary, MessageHit, WikiHit, WikiIndexEntry } from '@shared/types-shell'

/**
 * 로컬 보관함 (userData/local/archive.db).
 *
 * 두레이 메시지 조회(비공식 GET .../logs)는 채널마다 최신 1000개만 주고 페이지네이션이 없다.
 * 받아 온 메시지를 여기 쌓아 두면 1000개보다 오래된 것도 계속 보고 검색할 수 있다.
 * 저장소는 Electron 45 의 내장 Node(24)에 들어 있는 node:sqlite 를 쓴다 (네이티브 빌드 불필요, 실험 플래그 불필요).
 *
 * 위키 페이지 목록(제목 색인)과 열어 본 페이지 본문도 같은 파일에 둔다.
 * 이 파일은 이 컴퓨터에만 있다. 어디로도 보내지 않는다.
 */

export interface IngestResult {
  /** 처음 보는 메시지 */
  added: Message[]
  /** 내용이 바뀐 메시지 (수정·삭제 표시·스레드 답글 수) */
  changed: number
  /** 서버에서 사라져 지운 메시지 */
  removed: number
}

const SCHEMA = `
create table if not exists messages(
  channel_id text not null,
  id text not null,
  seq integer not null,
  sent_ms integer not null,
  sender_id text,
  text text not null default '',
  data text not null,
  primary key(channel_id, id)
);
create index if not exists idx_messages_order on messages(channel_id, seq, sent_ms);
create index if not exists idx_messages_sent on messages(sent_ms);
-- 안 읽음 수(channel_id = ? and sent_ms > ?)를 채널 전체 훑기 없이 (0.1.8)
create index if not exists idx_messages_ch_sent on messages(channel_id, sent_ms);
create table if not exists threads(
  thread_channel_id text primary key,
  parent_channel_id text not null,
  root_id text not null
);
create table if not exists channel_meta(
  channel_id text primary key,
  read_ms integer,
  backfilled integer not null default 0
);
create table if not exists wiki_pages(
  id text primary key,
  wiki_id text not null,
  wiki_name text not null default '',
  parent_id text,
  subject text not null default '',
  seen_ms integer not null
);
create table if not exists wiki_bodies(
  page_id text primary key,
  content text not null,
  updated_at text
);
create table if not exists kv(k text primary key, v text);
`

function ms(iso: string | null): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : 0
}

/** LIKE 패턴용 이스케이프 */
function likeTerm(s: string): string {
  return '%' + s.replace(/[\\%_]/g, (c) => '\\' + c) + '%'
}

export function searchTerms(q: string): string[] {
  return q
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
}

/** 본문에서 검색어 주변만 잘라 보여준다 */
export function snippet(text: string, terms: string[], width = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const lower = flat.toLowerCase()
  let at = -1
  for (const t of terms) {
    at = lower.indexOf(t.toLowerCase())
    if (at >= 0) break
  }
  if (at < 0) return flat.slice(0, width * 2)
  const start = Math.max(0, at - width)
  const end = Math.min(flat.length, at + width)
  return (start > 0 ? '…' : '') + flat.slice(start, end) + (end < flat.length ? '…' : '')
}

export class LocalArchive {
  readonly db: DatabaseSync
  private readonly st: Record<string, StatementSync>

  /** readOnly: 검색 작업 스레드용 두 번째 연결 (WAL 이라 쓰는 쪽과 동시에 읽어도 된다). 스키마·고치기는 하지 않는다 */
  constructor(path: string, opts: { readOnly?: boolean } = {}) {
    this.db = new DatabaseSync(path, opts.readOnly ? { readOnly: true } : {})
    if (!opts.readOnly) {
      this.db.exec('pragma journal_mode = wal; pragma synchronous = normal;')
      this.db.exec(SCHEMA)
      // 오래 열어 두는 연결: 쿼리 계획 통계를 필요할 때만 갱신 (SQLite 권장, 보통 1ms 안쪽)
      this.db.exec('pragma optimize = 0x10002')
      // 한 번만: 예전에는 열 때마다 전체를 훑어 30만 개에서 메인 프로세스를 100ms 넘게 막았다
      if (this.db.prepare("select v from kv where k = 'fix:systemText'").get() === undefined) {
        this.fixSystemText()
        this.db.prepare("insert or replace into kv(k, v) values ('fix:systemText', '1')").run()
      }
    }
    const p = (sql: string) => this.db.prepare(sql)
    this.st = {
      get: p('select data from messages where channel_id = ? and id = ?'),
      insert: p('insert into messages(channel_id, id, seq, sent_ms, sender_id, text, data) values (?, ?, ?, ?, ?, ?, ?)'),
      update: p('update messages set seq = ?, sent_ms = ?, sender_id = ?, text = ?, data = ? where channel_id = ? and id = ?'),
      del: p('delete from messages where channel_id = ? and id = ?'),
      idsFromSeq: p('select id from messages where channel_id = ? and seq >= ?'),
      allIds: p('select id from messages where channel_id = ?'),
      thread: p('insert into threads(thread_channel_id, parent_channel_id, root_id) values (?, ?, ?) on conflict(thread_channel_id) do update set parent_channel_id = excluded.parent_channel_id, root_id = excluded.root_id'),
      parentOf: p('select parent_channel_id as p from threads where thread_channel_id = ?'),
      latest: p('select data from messages where channel_id = ? order by seq desc, sent_ms desc limit ?'),
      count: p('select count(*) as n from messages where channel_id = ?'),
      seqOf: p('select seq from messages where channel_id = ? and id = ?'),
      countFrom: p('select count(*) as n from messages where channel_id = ? and seq >= ?'),
      last: p('select data from messages where channel_id = ? order by seq desc, sent_ms desc limit 1'),
      maxSent: p('select max(sent_ms) as m from messages where channel_id = ?'),
      unread: p('select count(*) as n from messages where channel_id = ? and sent_ms > ? and sender_id is not null and sender_id <> ?'),
      meta: p('select read_ms, backfilled from channel_meta where channel_id = ?'),
      setRead: p('insert into channel_meta(channel_id, read_ms) values (?, ?) on conflict(channel_id) do update set read_ms = excluded.read_ms'),
      setBackfilled: p('insert into channel_meta(channel_id, backfilled) values (?, 1) on conflict(channel_id) do update set backfilled = 1'),
      kvGet: p('select v from kv where k = ?'),
      kvSet: p('insert into kv(k, v) values (?, ?) on conflict(k) do update set v = excluded.v'),
      total: p('select count(*) as n, count(distinct channel_id) as c from messages'),
      wikiUpsert: p(
        'insert into wiki_pages(id, wiki_id, wiki_name, parent_id, subject, seen_ms) values (?, ?, ?, ?, ?, ?) on conflict(id) do update set wiki_id = excluded.wiki_id, wiki_name = case when excluded.wiki_name = \'\' then wiki_pages.wiki_name else excluded.wiki_name end, parent_id = excluded.parent_id, subject = excluded.subject, seen_ms = excluded.seen_ms'
      ),
      wikiAll: p('select id, wiki_id, wiki_name, parent_id, subject from wiki_pages'),
      wikiPrune: p('delete from wiki_pages where wiki_id = ? and seen_ms < ?'),
      wikiBody: p('insert into wiki_bodies(page_id, content, updated_at) values (?, ?, ?) on conflict(page_id) do update set content = excluded.content, updated_at = excluded.updated_at'),
      wikiDelete: p('delete from wiki_pages where id = ?'),
      wikiBodyDelete: p('delete from wiki_bodies where page_id = ?'),
      wikiCounts: p('select (select count(*) from wiki_pages) as pages, (select count(*) from wiki_bodies) as bodies')
    }
  }

  close(): void {
    this.db.close()
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('begin')
    try {
      const r = fn()
      this.db.exec('commit')
      return r
    } catch (e) {
      this.db.exec('rollback')
      throw e
    }
  }

  /**
   * 서버에서 받은 최신 메시지 묶음을 쌓는다.
   * - 같은 id 는 새 내용으로 덮는다 (수정·삭제 표시·스레드 답글 수 반영).
   * - 서버 응답은 "최신 N개"이므로, 응답의 가장 오래된 seq 이후 구간에서 보관함에만 있는 메시지는 서버에서 지워진 것으로 보고 지운다.
   *   응답이 요청한 개수보다 적으면 대화방 전체를 받은 것이라 그 이전 것도 같은 판단을 한다.
   *   (빈 응답은 일시 오류일 수 있어 아무것도 지우지 않는다. seq 가 없는 응답도 지우지 않는다.)
   */
  ingest(channelId: string, list: Message[], requestedSize: number): IngestResult {
    const result: IngestResult = { added: [], changed: 0, removed: 0 }
    if (list.length === 0) return result
    return this.tx(() => {
      for (const m of list) {
        const data = JSON.stringify(m)
        const row = this.st.get.get(channelId, m.id) as { data: string } | undefined
        if (!row) {
          this.st.insert.run(channelId, m.id, m.seq, ms(m.sentAt), m.senderId, searchable(m), data)
          result.added.push(m)
        } else if (row.data !== data) {
          this.st.update.run(m.seq, ms(m.sentAt), m.senderId, searchable(m), data, channelId, m.id)
          result.changed++
        }
        if (m.thread) this.st.thread.run(m.thread.channelId, channelId, m.id)
      }
      const seqOk = list.every((m) => m.seq > 0)
      if (seqOk) {
        const present = new Set(list.map((m) => m.id))
        const minSeq = Math.min(...list.map((m) => m.seq))
        const whole = list.length < requestedSize && requestedSize <= 1000
        const rows = (whole ? this.st.allIds.all(channelId) : this.st.idsFromSeq.all(channelId, minSeq)) as { id: string }[]
        for (const r of rows) {
          if (!present.has(r.id)) {
            this.st.del.run(channelId, r.id)
            result.removed++
          }
        }
      }
      return result
    })
  }

  /** 보관함의 최신 limit 개 (오래된 것 → 새것). includeId 가 있으면 그 메시지까지 들어가게 늘린다. */
  page(channelId: string, limit: number, includeId: string | null = null): { messages: Message[]; hasOlder: boolean } {
    let n = Math.max(1, Math.round(limit))
    if (includeId) {
      const s = this.st.seqOf.get(channelId, includeId) as { seq: number } | undefined
      if (s) n = Math.max(n, (this.st.countFrom.get(channelId, s.seq) as { n: number }).n + 20)
    }
    const rows = this.st.latest.all(channelId, n) as { data: string }[]
    const total = (this.st.count.get(channelId) as { n: number }).n
    return { messages: rows.map((r) => JSON.parse(r.data) as Message).reverse(), hasOlder: total > rows.length }
  }

  count(channelId: string): number {
    return (this.st.count.get(channelId) as { n: number }).n
  }

  parentOf(threadChannelId: string): string | null {
    const r = this.st.parentOf.get(threadChannelId) as { p: string } | undefined
    return r?.p ?? null
  }

  // ---------- 읽음 (로컬 추정) ----------

  readMs(channelId: string): number | null {
    const r = this.st.meta.get(channelId) as { read_ms: number | null } | undefined
    return r?.read_ms ?? null
  }

  /** at 이 없으면 보관함의 가장 최근 메시지 시각까지 읽음으로 (아직 받은 것이 없으면 지금까지) */
  markRead(channelId: string, at?: number): number {
    const latest = (this.st.maxSent.get(channelId) as { m: number | null }).m ?? Date.now()
    const value = Math.max(at ?? latest, this.readMs(channelId) ?? 0)
    this.st.setRead.run(channelId, value)
    return value
  }

  isBackfilled(channelId: string): boolean {
    const r = this.st.meta.get(channelId) as { backfilled: number } | undefined
    return !!r?.backfilled
  }

  /** 0.1.3 까지는 시스템 메시지 원문 JSON 이 검색 본문에 들어갔다. 문구로 바꿔 둔다 (몇 개뿐이라 열 때마다 확인해도 싸다) */
  private fixSystemText(): void {
    try {
      const rows = this.db.prepare(`select channel_id, id, data from messages where sender_id is null and text like '{"type":"%'`).all() as {
        channel_id: string
        id: string
        data: string
      }[]
      const upd = this.db.prepare('update messages set text = ? where channel_id = ? and id = ?')
      for (const r of rows) upd.run(searchable(JSON.parse(r.data) as Message), r.channel_id, r.id)
    } catch {
      /* 검색 본문만의 문제라 실패해도 넘어간다 */
    }
  }

  setBackfilled(channelId: string): void {
    this.st.setBackfilled.run(channelId)
  }

  summary(channelId: string, meId: string | null): ChannelSummary {
    const lastRow = this.st.last.get(channelId) as { data: string } | undefined
    const last = lastRow ? (JSON.parse(lastRow.data) as Message) : null
    const read = this.readMs(channelId)
    const unread = read === null ? 0 : (this.st.unread.get(channelId, read, meId ?? '') as { n: number }).n
    return {
      unread,
      lastAt: last?.sentAt ?? null,
      lastText: last ? previewText(last) : '',
      lastSystem: last ? parseSystem(last) : null,
      lastSenderId: last?.senderId ?? null,
      readAt: read === null ? null : new Date(read).toISOString()
    }
  }

  // ---------- 검색 ----------

  searchMessages(query: string, channelId: string | null, limit = 60): MessageHit[] {
    const terms = searchTerms(query)
    if (!terms.length) return []
    const where = terms.map(() => "text like ? escape '\\'").join(' and ')
    const params: (string | number)[] = terms.map(likeTerm)
    let sql = `select channel_id, data from messages where ${where}`
    if (channelId) {
      // 대화방 안 검색은 그 방의 스레드 안 메시지도 함께
      sql += ' and (channel_id = ? or channel_id in (select thread_channel_id from threads where parent_channel_id = ?))'
      params.push(channelId, channelId)
    }
    sql += ' order by sent_ms desc limit ?'
    params.push(limit)
    const rows = this.db.prepare(sql).all(...params) as { channel_id: string; data: string }[]
    return rows.map((r) => ({ message: JSON.parse(r.data) as Message, parentChannelId: this.parentOf(r.channel_id) }))
  }

  // ---------- 위키 색인 ----------

  upsertWikiPages(
    wikiId: string,
    wikiName: string,
    pages: { id: string; parentPageId: string | null; subject: string }[],
    seenMs = Date.now()
  ): void {
    this.tx(() => {
      for (const p of pages) this.st.wikiUpsert.run(p.id, wikiId, wikiName, p.parentPageId, p.subject, seenMs)
    })
  }

  /** 전체 훑기가 끝난 위키에서 이번에 보이지 않은 페이지(지워진 것)를 뺀다 */
  pruneWiki(wikiId: string, olderThanMs: number): void {
    this.st.wikiPrune.run(wikiId, olderThanMs)
  }

  removeWikiPage(pageId: string): void {
    this.st.wikiDelete.run(pageId)
    this.st.wikiBodyDelete.run(pageId)
  }

  setWikiBody(pageId: string, content: string, updatedAt: string | null): void {
    // 아주 긴 본문은 앞부분만 (검색용)
    this.st.wikiBody.run(pageId, content.slice(0, 50_000), updatedAt)
  }

  wikiEntries(): WikiIndexEntry[] {
    const rows = this.st.wikiAll.all() as { id: string; wiki_id: string; wiki_name: string; parent_id: string | null; subject: string }[]
    const byId = new Map(rows.map((r) => [r.id, r]))
    const pathOf = (r: (typeof rows)[number]) => {
      const parts: string[] = []
      let cur = r.parent_id ? byId.get(r.parent_id) : undefined
      let guard = 0
      while (cur && guard++ < 20) {
        parts.unshift(cur.subject)
        cur = cur.parent_id ? byId.get(cur.parent_id) : undefined
      }
      return [r.wiki_name, ...parts].filter(Boolean).join(' › ')
    }
    return rows.map((r) => ({
      id: r.id,
      wikiId: r.wiki_id,
      wikiName: r.wiki_name,
      parentPageId: r.parent_id,
      subject: r.subject,
      path: pathOf(r)
    }))
  }

  searchWiki(query: string, limit = 30): WikiHit[] {
    const terms = searchTerms(query)
    if (!terms.length) return []
    const entries = new Map(this.wikiEntries().map((e) => [e.id, e]))
    const lowerTerms = terms.map((t) => t.toLowerCase())
    const hits: (WikiHit & { score: number })[] = []
    for (const e of entries.values()) {
      const s = e.subject.toLowerCase()
      if (lowerTerms.every((t) => s.includes(t))) hits.push({ ...e, snippet: null, score: s.startsWith(lowerTerms[0]) ? 3 : 2 })
    }
    const where = terms.map(() => "content like ? escape '\\'").join(' and ')
    const rows = this.db
      .prepare(`select page_id, content from wiki_bodies where ${where} limit 200`)
      .all(...terms.map(likeTerm)) as { page_id: string; content: string }[]
    for (const r of rows) {
      const e = entries.get(r.page_id)
      if (!e) continue
      const existing = hits.find((h) => h.id === e.id)
      const snip = snippet(r.content, terms)
      if (existing) existing.snippet = snip
      else hits.push({ ...e, snippet: snip, score: 1 })
    }
    return hits
      .sort((a, b) => b.score - a.score || a.subject.localeCompare(b.subject, 'ko'))
      .slice(0, limit)
      .map(({ score: _s, ...h }) => h)
  }

  // ---------- 기타 ----------

  kv(key: string): string | null {
    const r = this.st.kvGet.get(key) as { v: string } | undefined
    return r?.v ?? null
  }

  setKv(key: string, value: string): void {
    this.st.kvSet.run(key, value)
  }

  stats(): { messages: number; channels: number; wikiPages: number; wikiBodies: number } {
    const t = this.st.total.get() as { n: number; c: number }
    const w = this.st.wikiCounts.get() as { pages: number; bodies: number }
    return { messages: t.n, channels: t.c, wikiPages: w.pages, wikiBodies: w.bodies }
  }
}

/** 목록 미리보기용 한 줄 */
export function previewText(m: Message): string {
  if (m.flags === 'DELETED_ROOT') return '(삭제된 메시지)'
  const sys = parseSystem(m)
  if (sys) return systemText(sys)
  if (m.type === 'FILE' && m.file) return `[파일] ${m.file.name}`
  const t = stripMarkdown(m.text).replace(/\s+/g, ' ').trim()
  return t.length > 80 ? t.slice(0, 80) + '…' : t
}

/** 검색 색인에 넣을 본문: 시스템 메시지는 원문 JSON 대신 문구 */
function searchable(m: Message): string {
  const sys = parseSystem(m)
  return sys ? systemText(sys) : m.text
}

/** 미리보기·알림용으로 마크다운 기호만 걷어 낸다 */
export function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, ' [코드] ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[이미지]')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
}
