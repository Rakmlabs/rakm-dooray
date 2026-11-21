import { useEffect, useMemo, useState } from 'react'
import type { Channel } from '@shared/types'
import type { SearchResult } from '@shared/types-shell'
import { call, errorText } from '../api'
import { useApp, useMemberNames } from '../state'
import { navigate, type NavRequest } from '../lib/nav'
import { channelTitle } from '../lib/projects'
import { formatTime } from '../lib/format'
import { Icon } from '../components/Icon'
import { snippetParts } from './match'
import { pushRecent } from './recent'

function Snip({ text, q }: { text: string; q: string }) {
  const p = snippetParts(text, q)
  return (
    <>
      {p.before}
      {p.hit && <mark>{p.hit}</mark>}
      {p.after}
    </>
  )
}

/**
 * 전체 검색 (⌘⇧F). 메시지는 이 컴퓨터의 로컬 보관함에서, 위키는 페이지 제목 색인과 열어 본 적 있는 페이지 본문에서 찾는다.
 * scope 가 있으면 그 대화방(과 그 방의 스레드) 안에서만.
 */
export function SearchPanel({
  initial,
  scope,
  onClose
}: {
  initial: string
  scope: { channelId: string; title: string } | null
  onClose: () => void
}) {
  const { updateShell } = useApp()
  const nameOf = useMemberNames()
  const [q, setQ] = useState(initial)
  const [only, setOnly] = useState(scope)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [tab, setTab] = useState<'all' | 'messages' | 'wiki'>('all')

  useEffect(() => {
    call('shell:quickData')
      .then((d) => setChannels(d.channels))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const t = q.trim()
    if (!t) return setResult(null)
    const id = window.setTimeout(() => {
      call('shell:search', t, only?.channelId ?? null)
        .then((r) => {
          setResult(r)
          setError(null)
        })
        .catch((e) => setError(errorText(e)))
    }, 180)
    return () => window.clearTimeout(id)
  }, [q, only])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const titleOf = useMemo(() => {
    const map = new Map(channels.map((c) => [c.id, c]))
    return (id: string) => {
      const c = map.get(id)
      return c ? channelTitle(c, nameOf) : '대화방'
    }
  }, [channels, nameOf])

  function go(target: NavRequest, label: string, sub?: string) {
    if (target.kind !== 'channel' || !('messageId' in target))
      updateShell((s) => ({ ...s, layout: { ...s.layout, recent: pushRecent(s.layout.recent, { label, sub, target }) } }))
    onClose()
    navigate(target)
  }

  const msgs = tab === 'wiki' ? [] : (result?.messages ?? [])
  const wiki = tab === 'messages' ? [] : (result?.wiki ?? [])

  return (
    <div className="qs-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="qs search-panel" role="dialog" aria-modal="true" aria-label="전체 검색">
        <div className="qs-input">
          <Icon name="search" size={18} />
          <input autoFocus value={q} placeholder="메시지·위키에서 찾기" onChange={(e) => setQ(e.target.value)} aria-label="검색어" />
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="search-filters">
          {only ? (
            <button className="chip active" onClick={() => setOnly(null)} title="범위 풀기">
              # {only.title || titleOf(only.channelId)} 안에서만 ✕
            </button>
          ) : (
            <div className="tabs" role="tablist">
              {(['all', 'messages', 'wiki'] as const).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
                  {t === 'all' ? '전체' : t === 'messages' ? `메시지 ${result?.messages.length ?? ''}` : `위키 ${result?.wiki.length ?? ''}`}
                </button>
              ))}
            </div>
          )}
          <span className="muted small grow right">이 컴퓨터에 받아 둔 메시지와 위키 색인에서 찾습니다</span>
        </div>
        <div className="qs-list search-results">
          {error && <div className="banner banner-err">{error}</div>}
          {!q.trim() && <div className="qs-empty">검색어를 입력하세요. 여러 단어는 모두 들어간 것만 찾습니다.</div>}
          {result && msgs.length === 0 && wiki.length === 0 && <div className="qs-empty">찾은 것이 없습니다.</div>}
          {wiki.length > 0 && <div className="qs-group">위키</div>}
          {wiki.map((w) => (
            <button key={w.id} className="search-hit" onClick={() => go({ kind: 'wikiPage', wikiId: w.wikiId, pageId: w.id }, w.subject, w.path)}>
              <span className="qs-icon">
                <Icon name="page" size={16} />
              </span>
              <span className="qs-text">
                <span className="qs-label">
                  <Snip text={w.subject} q={q} />
                </span>
                <span className="qs-sub ellipsis">{w.path}</span>
                {w.snippet && (
                  <span className="hit-body">
                    <Snip text={w.snippet} q={q} />
                  </span>
                )}
              </span>
            </button>
          ))}
          {msgs.length > 0 && <div className="qs-group">메시지</div>}
          {msgs.map(({ message: m, parentChannelId }) => {
            const where = parentChannelId ? `${titleOf(parentChannelId)} › 스레드` : titleOf(m.channelId)
            const target: NavRequest = parentChannelId
              ? { kind: 'thread', channelId: parentChannelId, threadChannelId: m.channelId }
              : { kind: 'channel', channelId: m.channelId, messageId: m.id }
            return (
              <button key={m.channelId + m.id} className="search-hit" onClick={() => go(target, where)}>
                <span className="qs-icon">
                  <Icon name={parentChannelId ? 'thread' : 'chat'} size={16} />
                </span>
                <span className="qs-text">
                  <span className="qs-sub">
                    <b>{nameOf(m.senderId) ?? '…'}</b> · {where} · {formatTime(m.sentAt)}
                  </span>
                  <span className="hit-body">
                    <Snip text={m.text} q={q} />
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
