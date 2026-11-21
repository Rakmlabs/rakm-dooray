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

export function WikiView() {
  const { settings, toast } = useApp()
  const configured = !!settings && settings.dooray.tokenSource !== 'none'
  const [wikis, setWikis] = useState<Wiki[]>([])
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
      })
      .catch((e) => setError(errorText(e)))
  }, [configured])

  const loadChildren = useCallback(
    async (parent: string | null) => {
      if (!wikiId) return
      try {
        const list = await call('wiki:pages', wikiId, parent)
        setChildren((c) => ({ ...c, [parent ?? ROOT]: list }))
      } catch (e) {
        toast(errorText(e))
      }
    },
    [wikiId, toast]
  )

  useEffect(() => {
    setChildren({})
    setExpanded(new Set())
    setPageId(null)
    if (wikiId) void loadChildren(null)
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

  const filteredWikis = wikiFilter ? wikis.filter((w) => w.name.toLowerCase().includes(wikiFilter.toLowerCase())) : wikis

  const renderTree = (parent: string, depth: number) =>
    (children[parent] ?? []).map((p) => (
      <div key={p.id}>
        <div className={`tree-row ${pageId === p.id ? 'active' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}>
          <button className={`chev ${expanded.has(p.id) ? 'open' : ''}`} onClick={() => toggle(p)} aria-label="하위 페이지 펼치기">
            <Icon name="chevron" size={12} />
          </button>
          <button
            className="tree-title ellipsis"
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
        {expanded.has(p.id) &&
          (children[p.id] ? (
            children[p.id].length ? (
              renderTree(p.id, depth + 1)
            ) : (
              <div className="muted small" style={{ paddingLeft: 30 + depth * 14 }}>
                하위 페이지 없음
              </div>
            )
          ) : (
            <div className="muted small" style={{ paddingLeft: 30 + depth * 14 }}>
              …
            </div>
          ))}
      </div>
    ))

  return (
    <div className="cols">
      <aside className="list-col" aria-label="위키 목록">
        <div className="pane-head column">
          <input className="search" placeholder="위키 찾기" value={wikiFilter} onChange={(e) => setWikiFilter(e.target.value)} />
          <select
            value={wikiId}
            onChange={(e) => {
              if (guard()) {
                setDirty(false)
                setWikiId(e.target.value)
              }
            }}
            aria-label="위키 선택"
          >
            <option value="">위키 선택 ({filteredWikis.length})</option>
            {filteredWikis.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
        {error && <div className="banner banner-err">{error}</div>}
        <div className="list-scroll">{wikiId && renderTree(ROOT, 0)}</div>
        {wikiId && (
          <div className="list-foot">
            <button className="small" onClick={() => void loadChildren(null)}>
              <Icon name="refresh" size={14} /> 새로고침
            </button>
          </div>
        )}
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
          <div className="empty">{wikiId ? '왼쪽에서 페이지를 고르세요.' : '위키를 고르세요.'}</div>
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

  const dirty = !!page && editing && (subject !== page.subject || content !== page.content)
  useEffect(() => onDirty(dirty), [dirty, onDirty])

  const previewHtml = useMemo(() => renderMarkdown(previewSource(editing ? content : (page?.content ?? '')), { breaks: false }), [
    editing,
    content,
    page?.content
  ])

  if (error) return <div className="banner banner-err">{error}</div>
  if (!page) return <div className="empty">불러오는 중…</div>

  async function save() {
    if (!subject.trim()) return toast('제목을 입력하세요.')
    setSaving(true)
    try {
      await call('wiki:update', wikiId, pageId, subject.trim(), content)
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
      await call('wiki:delete', wikiId, pageId)
      await onTreeChanged(page!.parentPageId)
      if (page!.parentPageId) onOpen(page!.parentPageId)
    } catch (e) {
      toast(errorText(e))
    }
  }

  return (
    <div className="page">
      <div className="pane-head">
        {editing ? (
          <input className="title-input grow" value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="제목" />
        ) : (
          <h2 className="grow ellipsis">{page.subject}</h2>
        )}
        {editing ? (
          <>
            <button
              onClick={() => {
                if (!dirty || window.confirm('변경을 버릴까요?')) {
                  setSubject(page.subject)
                  setContent(page.content)
                  setEditing(false)
                }
              }}
            >
              취소
            </button>
            <button className="primary" disabled={saving || !dirty} onClick={() => void save()}>
              {saving ? '저장 중…' : '저장'}
            </button>
          </>
        ) : (
          <>
            <button className="primary small" onClick={() => setEditing(true)}>
              <Icon name="edit" size={14} /> 편집
            </button>
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
      {!editing && (
        <div className="muted small pad">
          {nameOf(page.creatorId) ?? ''} · 수정 {formatTime(page.updatedAt)} · 버전 {page.version}
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
          <Attachments page={page} wikiId={wikiId} onChanged={load} />
          <Comments wikiId={wikiId} pageId={pageId} />
        </div>
      )}
      {dialog === 'new' && (
        <NewPageDialog
          parent={page}
          onClose={() => setDialog(null)}
          onCreate={async (title) => {
            const r = await call('wiki:create', wikiId, pageId, title, `# ${title}\n`)
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
            await call('wiki:move', wikiId, pageId, target)
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
