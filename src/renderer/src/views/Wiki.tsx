import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Wiki, WikiComment, WikiPage, WikiPageSummary } from '@shared/types'
import { call, errorText } from '../api'
import { useApp, useMemberNames } from '../state'
import { renderMarkdown } from '../lib/markdown'
import { formatSize, formatTime } from '../lib/format'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'

const ROOT = '__root__'

/** 두레이 위키 본문의 ${toc} 같은 두레이 전용 매크로는 미리보기에서 지운다 */
function previewSource(md: string): string {
  return md.replace(/\$\{toc\}/g, '')
}

const LAST_WIKI = 'wiki:last'

function readLast(): string {
  try {
    return localStorage.getItem(LAST_WIKI) ?? ''
  } catch {
    return ''
  }
}

export function WikiView() {
  const { settings, toast } = useApp()
  const configured = !!settings && settings.dooray.tokenSource !== 'none'
  const [wikis, setWikis] = useState<Wiki[] | null>(null)
  const [wikiId, setWikiId] = useState<string>('')
  const [children, setChildren] = useState<Record<string, WikiPageSummary[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [pageId, setPageId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wikiFilter, setWikiFilter] = useState('')

  useEffect(() => {
    if (!configured) return
    call('wiki:list')
      .then((list) => {
        setWikis(list)
        setError(null)
        // 지난번에 보던 위키가 있으면 그것을, 없으면 첫 위키를 바로 연다
        setWikiId((cur) => cur || (list.find((w) => w.id === readLast()) ?? list[0])?.id || '')
      })
      .catch((e) => setError(errorText(e)))
  }, [configured])

  const fetchChildren = useCallback(
    async (wid: string, parent: string | null) => {
      const list = await call('wiki:pages', wid, parent)
      setChildren((c) => ({ ...c, [parent ?? ROOT]: list }))
      return list
    },
    []
  )

  const loadChildren = useCallback(
    async (parent: string | null) => {
      if (!wikiId) return
      try {
        await fetchChildren(wikiId, parent)
      } catch (e) {
        toast(errorText(e))
      }
    },
    [wikiId, fetchChildren, toast]
  )

  // 위키를 고르면: 최상위 페이지를 불러와 첫 단계를 펼치고, 홈(없으면 첫 페이지)을 바로 연다
  useEffect(() => {
    setChildren({})
    setExpanded(new Set())
    setPageId(null)
    if (!wikiId) return
    try {
      localStorage.setItem(LAST_WIKI, wikiId)
    } catch {
      /* 저장 못 해도 동작에는 지장 없음 */
    }
    let cancelled = false
    void (async () => {
      try {
        const roots = await fetchChildren(wikiId, null)
        if (cancelled) return
        const home = wikis?.find((w) => w.id === wikiId)?.homePageId
        setPageId(roots.find((r) => r.id === home)?.id ?? home ?? roots[0]?.id ?? null)
        setExpanded(new Set(roots.map((r) => r.id)))
        await Promise.all(roots.map((r) => fetchChildren(wikiId, r.id).catch(() => [])))
      } catch (e) {
        if (!cancelled) toast(errorText(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [wikiId]) // eslint-disable-line react-hooks/exhaustive-deps

  const allPages = useMemo(() => Object.values(children).flat(), [children])

  const guard = () => !dirty || window.confirm('저장하지 않은 변경이 있습니다. 버릴까요?')

  const toggle = (p: WikiPageSummary) => {
    setExpanded((s) => {
      const n = new Set(s)
      if (n.has(p.id)) n.delete(p.id)
      else {
        n.add(p.id)
        if (!children[p.id]) void loadChildren(p.id)
      }
      return n
    })
  }

  const refreshParent = async (parentId: string | null) => {
    await loadChildren(parentId)
  }

  if (!configured) return <div className="empty">설정 화면에서 두레이 개인 API 토큰을 먼저 입력하세요.</div>

  const list = wikis ?? []
  const filteredWikis = wikiFilter ? list.filter((w) => w.name.toLowerCase().includes(wikiFilter.toLowerCase())) : list
  const currentWiki = list.find((w) => w.id === wikiId)

  const renderTree = (parent: string, depth: number) =>
    (children[parent] ?? []).map((p) => {
      const kids = children[p.id]
      const leaf = kids !== undefined && kids.length === 0
      return (
        <div key={p.id} role="treeitem" aria-expanded={leaf ? undefined : expanded.has(p.id)} aria-selected={pageId === p.id}>
          <div className={`tree-row ${pageId === p.id ? 'active' : ''}`} style={{ paddingLeft: 6 + depth * 16 }}>
            {leaf ? (
              <span className="chev-space" />
            ) : (
              <button className={`chev ${expanded.has(p.id) ? 'open' : ''}`} onClick={() => toggle(p)} aria-label="하위 페이지 펼치기">
                <Icon name="chevron" size={12} />
              </button>
            )}
            <button
              className="tree-title ellipsis"
              title={p.subject}
              onClick={() => {
                if (guard()) {
                  setDirty(false)
                  setPageId(p.id)
                }
              }}
            >
              {p.subject}
            </button>
          </div>
          {expanded.has(p.id) && !leaf && (kids ? <div role="group">{renderTree(p.id, depth + 1)}</div> : <div className="tree-loading" style={{ paddingLeft: 30 + depth * 16 }}>불러오는 중…</div>)}
        </div>
      )
    })

  return (
    <div className="cols wiki">
      <aside className="wiki-list-col" aria-label="위키 목록">
        <div className="wiki-col-head">
          <span className="col-title">위키</span>
          <span className="muted small">{list.length}</span>
        </div>
        <div className="wiki-filter">
          <input className="search" placeholder="위키 찾기" value={wikiFilter} onChange={(e) => setWikiFilter(e.target.value)} />
        </div>
        {error && <div className="banner banner-err">{error}</div>}
        <nav className="list-scroll wiki-list">
          {wikis === null && !error && <div className="muted small pad">불러오는 중…</div>}
          {filteredWikis.map((w) => (
            <button
              key={w.id}
              className={`wiki-item ${w.id === wikiId ? 'active' : ''}`}
              aria-current={w.id === wikiId ? 'true' : undefined}
              title={w.name}
              onClick={() => {
                if (w.id !== wikiId && guard()) {
                  setDirty(false)
                  setWikiId(w.id)
                }
              }}
            >
              <Icon name="book" size={15} />
              <span className="ellipsis">{w.name}</span>
            </button>
          ))}
          {wikis !== null && filteredWikis.length === 0 && <div className="muted small pad">{wikiFilter ? '맞는 위키가 없습니다.' : '볼 수 있는 위키가 없습니다.'}</div>}
        </nav>
      </aside>
      <aside className="tree-col" aria-label="페이지 목록">
        <div className="wiki-col-head">
          <span className="col-title ellipsis">{currentWiki?.name ?? '페이지'}</span>
          {wikiId && (
            <button className="icon-btn" onClick={() => void loadChildren(null)} title="페이지 목록 새로고침" aria-label="페이지 목록 새로고침">
              <Icon name="refresh" size={15} />
            </button>
          )}
        </div>
        <div className="list-scroll tree" role="tree">
          {wikiId ? renderTree(ROOT, 0) : <div className="muted small pad">왼쪽에서 위키를 고르세요.</div>}
        </div>
      </aside>
      <div className="body-col">
        {wikiId && pageId ? (
          <PageView
            key={pageId}
            wikiId={wikiId}
            pageId={pageId}
            pages={allPages}
            onDirty={setDirty}
            onOpen={(id) => {
              setDirty(false)
              setPageId(id)
            }}
            onTreeChanged={refreshParent}
          />
        ) : (
          <div className="empty">{wikiId ? '페이지를 불러오는 중이거나, 이 위키에 페이지가 없습니다.' : '위키를 고르세요.'}</div>
        )}
      </div>
    </div>
  )
}

function PageView({
  wikiId,
  pageId,
  pages,
  onDirty,
  onOpen,
  onTreeChanged
}: {
  wikiId: string
  pageId: string
  pages: WikiPageSummary[]
  onDirty: (d: boolean) => void
  onOpen: (id: string) => void
  onTreeChanged: (parentId: string | null) => Promise<void>
}) {
  const { toast } = useApp()
  const nameOf = useMemberNames()
  const [page, setPage] = useState<WikiPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [subject, setSubject] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [dialog, setDialog] = useState<'new' | 'move' | null>(null)

  const load = useCallback(async () => {
    try {
      const p = await call('wiki:page', wikiId, pageId)
      setPage(p)
      setSubject(p.subject)
      setContent(p.content)
      setError(null)
    } catch (e) {
      setError(errorText(e))
    }
  }, [wikiId, pageId])

  useEffect(() => {
    void load()
  }, [load])

  // 단건 조회 응답의 wikiId 를 쓴다 (목록에서 받은 위키 ID 와 다를 수 있다)
  const wid = page?.wikiId || wikiId
  const dirty = !!page && editing && (subject !== page.subject || content !== page.content)
  useEffect(() => onDirty(dirty), [dirty, onDirty])

  const previewHtml = useMemo(() => renderMarkdown(previewSource(editing ? content : (page?.content ?? '')), { breaks: false }), [
    editing,
    content,
    page?.content
  ])

  if (error) return <div className="banner banner-err">{error}</div>
  if (!page) return <div className="empty">불러오는 중…</div>

  function cancelEdit() {
    if (!dirty || window.confirm('변경을 버릴까요?')) {
      setSubject(page!.subject)
      setContent(page!.content)
      setEditing(false)
    }
  }

  async function save() {
    if (!subject.trim()) return toast('제목을 입력하세요.')
    setSaving(true)
    try {
      await call('wiki:update', wid, pageId, subject.trim(), content)
      setEditing(false)
      await load()
      await onTreeChanged(page!.parentPageId)
      toast('저장했습니다.', 'info')
    } catch (e) {
      toast(errorText(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!window.confirm(`'${page!.subject}' 페이지를 삭제할까요? 하위 페이지도 함께 영향을 받을 수 있습니다.`)) return
    try {
      await call('wiki:delete', wid, pageId)
      await onTreeChanged(page!.parentPageId)
      if (page!.parentPageId) onOpen(page!.parentPageId)
    } catch (e) {
      toast(errorText(e))
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        {editing ? (
          <input className="title-input grow" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="제목" />
        ) : (
          <h1 className="page-title grow ellipsis" title={page.subject}>
            {page.subject}
          </h1>
        )}
        <div className="seg" role="group" aria-label="보기 방식">
          <button className={!editing ? 'on' : ''} aria-pressed={!editing} onClick={() => !editing || cancelEdit()}>
            보기
          </button>
          <button className={editing ? 'on' : ''} aria-pressed={editing} onClick={() => setEditing(true)}>
            <Icon name="edit" size={13} /> 편집
          </button>
        </div>
        {editing ? (
          <button className="primary" disabled={saving || !dirty} onClick={() => void save()} title="⌘S">
            {saving ? '저장 중…' : '저장'}
          </button>
        ) : (
          <>
            <button className="small" onClick={() => setDialog('new')}>
              <Icon name="plus" size={14} /> 하위 페이지
            </button>
            <button className="small" onClick={() => setDialog('move')}>
              이동
            </button>
            <button className="icon-btn" onClick={() => void remove()} title="삭제" aria-label="페이지 삭제">
              <Icon name="trash" size={16} />
            </button>
          </>
        )}
      </div>
      {editing ? (
        <div className="edit-hint muted small">왼쪽에 마크다운을 쓰면 오른쪽에 결과가 보입니다. ⌘S 로 저장.</div>
      ) : (
        <div className="page-meta muted small">
          {nameOf(page.creatorId) ?? ''} 작성 · {formatTime(page.updatedAt)} 수정 · 버전 {page.version}
        </div>
      )}
      {editing ? (
        <div className="editor">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
            aria-label="마크다운 본문"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault()
                void save()
              }
            }}
          />
          <div className="md preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
      ) : (
        <div className="page-scroll">
          <article className="md wiki-body" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          <Attachments page={page} wikiId={wid} onChanged={load} />
          <Comments wikiId={wid} pageId={pageId} />
        </div>
      )}
      {dialog === 'new' && (
        <NewPageDialog
          parent={page}
          onClose={() => setDialog(null)}
          onCreate={async (title) => {
            const r = await call('wiki:create', wid, pageId, title, `# ${title}\n`)
            setDialog(null)
            await onTreeChanged(pageId)
            onOpen(r.id)
          }}
        />
      )}
      {dialog === 'move' && (
        <MoveDialog
          page={page}
          pages={pages}
          onClose={() => setDialog(null)}
          onMove={async (target) => {
            await call('wiki:move', wid, pageId, target)
            setDialog(null)
            await onTreeChanged(page.parentPageId)
            await onTreeChanged(target)
            await load()
          }}
        />
      )}
    </div>
  )
}

function Attachments({ page, wikiId, onChanged }: { page: WikiPage; wikiId: string; onChanged: () => Promise<void> }) {
  const { toast } = useApp()
  return (
    <section className="attachments">
      <div className="section-title">
        <span>첨부 파일 {page.files.length}</span>
        <button
          className="small"
          onClick={async () => {
            try {
              if (await call('wiki:uploadFile', wikiId, page.id)) await onChanged()
            } catch (e) {
              toast(errorText(e))
            }
          }}
        >
          <Icon name="clip" size={14} /> 파일 올리기
        </button>
      </div>
      {page.files.map((f) => (
        <button
          key={f.id}
          className="file-chip"
          onClick={async () => {
            try {
              const saved = await call('wiki:downloadFile', wikiId, page.id, f.id, f.name)
              if (saved) toast(`저장했습니다: ${saved}`, 'info')
            } catch (e) {
              toast(errorText(e))
            }
          }}
        >
          <Icon name="download" size={14} />
          {f.name} <span className="muted">{formatSize(f.size)}</span>
        </button>
      ))}
    </section>
  )
}

function Comments({ wikiId, pageId }: { wikiId: string; pageId: string }) {
  const { toast } = useApp()
  const nameOf = useMemberNames()
  const [list, setList] = useState<WikiComment[]>([])
  const [text, setText] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [meId, setMeId] = useState<string | null>(null)

  const load = useCallback(() => {
    call('wiki:comments', wikiId, pageId)
      .then(setList)
      .catch((e) => toast(errorText(e)))
  }, [wikiId, pageId, toast])

  useEffect(() => {
    load()
    call('messenger:me')
      .then((m) => setMeId(m.id))
      .catch(() => {})
  }, [load])

  return (
    <section className="comments">
      <div className="section-title">
        <span>댓글 {list.length}</span>
      </div>
      {list.map((c) => (
        <div key={c.id} className="comment">
          <div className="msg-head">
            <span className="msg-sender">{nameOf(c.creatorId) ?? '…'}</span>
            <span className="msg-time">{formatTime(c.createdAt)}</span>
            {meId && c.creatorId === meId && editId !== c.id && (
              <span className="comment-actions">
                <button
                  className="link"
                  onClick={() => {
                    setEditId(c.id)
                    setEditText(c.content)
                  }}
                >
                  수정
                </button>
                <button
                  className="link"
                  onClick={async () => {
                    if (!window.confirm('댓글을 삭제할까요?')) return
                    try {
                      await call('wiki:deleteComment', wikiId, pageId, c.id)
                      load()
                    } catch (e) {
                      toast(errorText(e))
                    }
                  }}
                >
                  삭제
                </button>
              </span>
            )}
          </div>
          {editId === c.id ? (
            <div className="msg-edit">
              <textarea value={editText} onChange={(e) => setEditText(e.target.value)} />
              <div className="row">
                <button
                  className="primary small"
                  onClick={async () => {
                    try {
                      await call('wiki:updateComment', wikiId, pageId, c.id, editText)
                      setEditId(null)
                      load()
                    } catch (e) {
                      toast(errorText(e))
                    }
                  }}
                >
                  저장
                </button>
                <button className="small" onClick={() => setEditId(null)}>
                  취소
                </button>
              </div>
            </div>
          ) : (
            <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(c.content) }} />
          )}
        </div>
      ))}
      <form
        className="row"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!text.trim()) return
          try {
            await call('wiki:addComment', wikiId, pageId, text.trim())
            setText('')
            load()
          } catch (err) {
            toast(errorText(err))
          }
        }}
      >
        <textarea className="grow" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="댓글 쓰기" />
        <button className="primary" disabled={!text.trim()}>
          등록
        </button>
      </form>
    </section>
  )
}

function NewPageDialog({ parent, onClose, onCreate }: { parent: WikiPage; onClose: () => void; onCreate: (t: string) => Promise<void> }) {
  const { toast } = useApp()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={`'${parent.subject}' 아래 새 페이지`} onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!title.trim()) return
          setBusy(true)
          try {
            await onCreate(title.trim())
          } catch (err) {
            toast(errorText(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        <label>
          <span>제목</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required />
        </label>
        <div className="row end">
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button className="primary" disabled={busy || !title.trim()}>
            만들기
          </button>
        </div>
      </form>
    </Modal>
  )
}

function MoveDialog({
  page,
  pages,
  onClose,
  onMove
}: {
  page: WikiPage
  pages: WikiPageSummary[]
  onClose: () => void
  onMove: (target: string) => Promise<void>
}) {
  const { toast } = useApp()
  const [target, setTarget] = useState('')
  const options = pages.filter((p) => p.id !== page.id && p.id !== page.parentPageId)
  return (
    <Modal title={`'${page.subject}' 이동`} onClose={onClose}>
      <p className="muted small">왼쪽 트리에서 펼쳐 본 페이지만 목록에 나옵니다. 하위 페이지도 함께 옮겨집니다.</p>
      <select value={target} onChange={(e) => setTarget(e.target.value)} aria-label="새 상위 페이지">
        <option value="">새 상위 페이지 선택</option>
        {options.map((p) => (
          <option key={p.id} value={p.id}>
            {p.subject}
          </option>
        ))}
      </select>
      <div className="row end">
        <button onClick={onClose}>취소</button>
        <button
          className="primary"
          disabled={!target}
          onClick={async () => {
            try {
              await onMove(target)
            } catch (e) {
              toast(errorText(e))
            }
          }}
        >
          이동
        </button>
      </div>
    </Modal>
  )
}
