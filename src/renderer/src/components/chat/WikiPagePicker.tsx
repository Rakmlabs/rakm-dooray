// 위키 → 페이지 트리에서 하나를 고르는 작은 탐색기 (위키로 보내기, 위키 링크 넣기에서 쓴다).
// 기존 wiki:list / wiki:pages IPC 만 쓴다. 트리는 펼칠 때 한 단계씩 읽는다.
import { useEffect, useState } from 'react'
import type { Wiki, WikiPageSummary } from '@shared/types'
import { call, errorText } from '../../api'
import { ChatIcon } from './ChatIcon'

export interface PickedPage {
  wiki: Wiki
  page: WikiPageSummary | null
}

export function WikiPagePicker({
  value,
  onChange,
  allowWikiRoot
}: {
  value: PickedPage | null
  onChange: (v: PickedPage) => void
  /** 페이지를 고르지 않고 위키 자체(최상위)를 고를 수 있게 */
  allowWikiRoot?: boolean
}) {
  const [wikis, setWikis] = useState<Wiki[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [wikiId, setWikiId] = useState<string | null>(value?.wiki.id ?? null)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    call('wiki:list')
      .then((w) => {
        setWikis(w)
        if (!wikiId && w[0]) setWikiId(w[0].id)
      })
      .catch((e) => setError(errorText(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const wiki = wikis?.find((w) => w.id === wikiId) ?? null

  return (
    <div className="wiki-picker">
      {error && <div className="banner banner-err">{error}</div>}
      <div className="wiki-picker-row">
        <select value={wikiId ?? ''} onChange={(e) => setWikiId(e.target.value)} aria-label="위키">
          {(wikis ?? []).map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="펼친 페이지에서 찾기" aria-label="페이지 찾기" />
      </div>
      <div className="wiki-picker-tree" role="tree">
        {!wikis && !error && <div className="muted small pad">불러오는 중…</div>}
        {wiki && allowWikiRoot && (
          <button
            role="treeitem"
            aria-selected={value?.wiki.id === wiki.id && !value.page}
            className={`wp-row ${value?.wiki.id === wiki.id && !value.page ? 'active' : ''}`}
            onClick={() => onChange({ wiki, page: null })}
          >
            <ChatIcon name="wiki" size={14} /> <b>{wiki.name}</b> <span className="muted small">(맨 위)</span>
          </button>
        )}
        {wiki && <Level key={wiki.id} wiki={wiki} parent={null} depth={0} value={value} onChange={onChange} filter={filter.trim().toLowerCase()} />}
      </div>
    </div>
  )
}

function Level({
  wiki,
  parent,
  depth,
  value,
  onChange,
  filter
}: {
  wiki: Wiki
  parent: string | null
  depth: number
  value: PickedPage | null
  onChange: (v: PickedPage) => void
  filter: string
}) {
  const [pages, setPages] = useState<WikiPageSummary[] | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  useEffect(() => {
    call('wiki:pages', wiki.id, parent)
      .then((list) => {
        setPages(list)
        // 위키 맨 위 페이지가 하나(홈)뿐이면 바로 펼쳐 둔다
        if (depth === 0 && list.length === 1) setOpen({ [list[0].id]: true })
      })
      .catch(() => setPages([]))
  }, [wiki.id, parent, depth])
  if (!pages) return <div className="muted small" style={{ paddingLeft: 12 + depth * 16 }}>…</div>
  return (
    <>
      {pages.map((p) => {
        const hidden = filter && !p.subject.toLowerCase().includes(filter) && !open[p.id]
        const active = value?.page?.id === p.id
        return (
          <div key={p.id}>
            {!hidden && (
              <div className={`wp-row ${active ? 'active' : ''}`} style={{ paddingLeft: 6 + depth * 16 }}>
                <button
                  className={`wp-toggle ${open[p.id] ? 'open' : ''}`}
                  aria-label={open[p.id] ? '접기' : '펼치기'}
                  onClick={() => setOpen((o) => ({ ...o, [p.id]: !o[p.id] }))}
                >
                  <ChatIcon name="chevron" size={12} />
                </button>
                <button role="treeitem" aria-selected={active} className="wp-label" onClick={() => onChange({ wiki, page: p })}>
                  <ChatIcon name="page" size={13} /> {p.subject || '(제목 없음)'}
                </button>
              </div>
            )}
            {open[p.id] && <Level wiki={wiki} parent={p.id} depth={depth + 1} value={value} onChange={onChange} filter={filter} />}
          </div>
        )
      })}
      {pages.length === 0 && depth > 0 && (
        <div className="muted small" style={{ paddingLeft: 26 + depth * 16 }}>
          하위 페이지 없음
        </div>
      )}
    </>
  )
}
