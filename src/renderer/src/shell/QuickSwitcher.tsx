import { useEffect, useMemo, useRef, useState } from 'react'
import type { Member } from '@shared/types'
import type { QuickData } from '@shared/types-shell'
import { call } from '../api'
import { useApp, useMemberNames } from '../state'
import { navigate, type NavRequest } from '../lib/nav'
import { channelTitle, directPartner } from '../lib/projects'
import { Icon, type IconName } from '../components/Icon'
import { Avatar } from '../components/people/Avatar'
import { matchScore } from './match'
import { pushRecent, targetKey } from './recent'

interface Item {
  key: string
  icon: IconName | 'avatar'
  avatarId?: string
  label: string
  sub?: string
  badge?: number
  target: NavRequest | null
  run?: () => void
  score: number
}

/** ⌘K 빠른 이동: 대화방·사람·위키 페이지를 한 곳에서. 키보드만으로 (↑↓ Enter Esc). */
export function QuickSwitcher({ onClose, onSearchAll }: { onClose: () => void; onSearchAll: (q: string) => void }) {
  const { shell, updateShell, unread } = useApp()
  const nameOf = useMemberNames()
  const [q, setQ] = useState('')
  const [data, setData] = useState<QuickData | null>(null)
  const [found, setFound] = useState<Member[]>([])
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    call('shell:quickData')
      .then(setData)
      .catch(() => setData({ channels: [], members: [], wikiPages: [], meId: null }))
  }, [])

  // 조직의 다른 사람은 이름으로 찾는다 (대화방에 없는 사람도)
  useEffect(() => {
    const t = q.trim()
    if (t.length < 1 || /^[ㄱ-ㅎ]+$/.test(t)) return setFound([])
    const id = window.setTimeout(() => {
      call('messenger:searchMembers', t)
        .then(setFound)
        .catch(() => setFound([]))
    }, 250)
    return () => window.clearTimeout(id)
  }, [q])

  const recent = shell?.layout.recent ?? []

  const items = useMemo<Item[]>(() => {
    if (!data) return []
    const query = q.trim()
    const recentRank = new Map(recent.map((r, i) => [r.key, i]))
    const boost = (key: string) => {
      const i = recentRank.get(key)
      return i === undefined ? 0 : 20 - Math.min(19, i)
    }
    const out: Item[] = []
    const channelIds = new Set(data.channels.map((c) => c.id))
    for (const c of data.channels) {
      if (c.status === 'deleted') continue
      const title = channelTitle(c, nameOf)
      const target: NavRequest = { kind: 'channel', channelId: c.id }
      const key = targetKey(target)
      const s = matchScore(title, query)
      if (!s) continue
      const partner = directPartner(c)
      const n = unread.summaries[c.id]?.unread ?? 0
      out.push({
        key,
        icon: partner ? 'avatar' : 'chat',
        avatarId: partner ?? undefined,
        label: title,
        sub: partner ? '1:1 대화' : '대화방',
        badge: n || undefined,
        target,
        score: s + boost(key) + (n ? 3 : 0)
      })
    }
    // 이미 1:1 방이 있는 사람은 그 방 항목 하나로 충분하다
    const withDirect = new Set(data.channels.map(directPartner).filter((x): x is string => !!x))
    const people = new Map<string, Member>()
    for (const m of [...data.members, ...found]) if (m.id !== data.meId && !withDirect.has(m.id)) people.set(m.id, m)
    for (const m of people.values()) {
      const target: NavRequest = { kind: 'direct', memberId: m.id }
      const key = targetKey(target)
      const s = matchScore(m.name, query)
      if (!s || !query) continue
      out.push({ key, icon: 'avatar', avatarId: m.id, label: m.name, sub: m.email ?? '사람 — 1:1 대화', target, score: s - 2 + boost(key) })
    }
    if (query) {
      for (const p of data.wikiPages) {
        const target: NavRequest = { kind: 'wikiPage', wikiId: p.wikiId, pageId: p.id }
        const key = targetKey(target)
        // 경로(위키 이름 › 상위 페이지)로도 찾되 낮게. 초성 질의는 경로까지 보면 너무 많이 걸려 제목만 본다
        const byPath = /[ㄱ-ㅎ]/.test(query) ? 0 : matchScore(p.path, query) - 30
        const s = Math.max(matchScore(p.subject, query), byPath)
        if (s <= 0) continue
        out.push({ key, icon: 'page', label: p.subject, sub: p.path, target, score: s - 4 + boost(key) })
      }
    }
    // 최근 항목 (스레드·지금 목록에 없는 것 포함)
    const have = new Set(out.map((i) => i.key))
    for (const r of recent) {
      if (have.has(r.key)) continue
      if (r.target.kind === 'channel' && !channelIds.has(r.target.channelId)) continue
      const s = matchScore(r.label, query)
      if (!s) continue
      out.push({
        key: r.key,
        icon: r.target.kind === 'thread' ? 'thread' : r.target.kind === 'wikiPage' ? 'page' : r.target.kind === 'direct' ? 'user' : 'chat',
        label: r.label,
        sub: r.sub,
        target: r.target,
        score: s + boost(r.key)
      })
    }
    let list: Item[]
    if (!query) {
      // 빈 입력: 최근 → 안 읽은 방 → 나머지 최근 대화방
      list = out.sort((a, b) => b.score - a.score).slice(0, 14)
    } else {
      list = out.sort((a, b) => b.score - a.score).slice(0, 40)
      list.push({ key: 'search-all', icon: 'search', label: `전체 검색: “${query}”`, sub: '메시지·위키 본문까지 (⌘⇧F)', target: null, run: () => onSearchAll(query), score: 0 })
    }
    return list
  }, [data, found, q, recent, unread, nameOf, onSearchAll])

  useEffect(() => setIndex(0), [q])
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  function choose(item: Item | undefined) {
    if (!item) return
    if (item.run) return item.run()
    if (!item.target) return
    const label = item.label
    updateShell((s) => ({ ...s, layout: { ...s.layout, recent: pushRecent(s.layout.recent, { label, sub: item.sub, target: item.target! }) } }))
    onClose()
    navigate(item.target)
  }

  return (
    <div className="qs-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="qs" role="dialog" aria-modal="true" aria-label="빠른 이동">
        <div className="qs-input">
          <Icon name="search" size={18} />
          <input
            autoFocus
            value={q}
            placeholder="대화방, 사람, 위키 페이지 이름 (초성도 됩니다: ㅇㅍ)"
            onChange={(e) => setQ(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="qs-list"
            aria-activedescendant={items[index] ? `qs-${index}` : undefined}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIndex((i) => Math.min(items.length - 1, i + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIndex((i) => Math.max(0, i - 1))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                choose(items[index])
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              }
            }}
          />
          <kbd>esc</kbd>
        </div>
        <div className="qs-list" id="qs-list" role="listbox" ref={listRef}>
          {!data && <div className="qs-empty">불러오는 중…</div>}
          {data && items.length === 0 && <div className="qs-empty">맞는 항목이 없습니다.</div>}
          {data && !q.trim() && items.length > 0 && <div className="qs-group">{recent.length ? '최근·안 읽음' : '대화방'}</div>}
          {items.map((it, i) => (
            <button
              key={it.key}
              id={`qs-${i}`}
              role="option"
              aria-selected={i === index}
              data-active={i === index}
              className={`qs-item ${i === index ? 'active' : ''}`}
              onMouseMove={() => setIndex(i)}
              onClick={() => choose(it)}
            >
              <span className="qs-icon">
                {it.icon === 'avatar' ? <Avatar memberId={it.avatarId ?? null} size={22} /> : <Icon name={it.icon} size={16} />}
              </span>
              <span className="qs-text">
                <span className="qs-label ellipsis">{it.label}</span>
                {it.sub && <span className="qs-sub ellipsis">{it.sub}</span>}
              </span>
              {it.badge ? <span className="badge">{it.badge > 99 ? '99+' : it.badge}</span> : null}
              {i === index && <kbd className="qs-enter">↵</kbd>}
            </button>
          ))}
        </div>
        <div className="qs-foot muted small">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> 고르기
          </span>
          <span>
            <kbd>↵</kbd> 열기
          </span>
          <span>
            <kbd>⌘⇧F</kbd> 전체 검색
          </span>
        </div>
      </div>
    </div>
  )
}
