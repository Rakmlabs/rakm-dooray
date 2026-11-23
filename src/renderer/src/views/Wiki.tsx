import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import type { Wiki, WikiComment, WikiPage, WikiPageSummary } from '@shared/types'
import type { WikiBackup, WikiServerCopy } from '@shared/types-wiki'
import { call, errorText } from '../api'
import { useApp, useMemberNames } from '../state'
import { renderMarkdown } from '../lib/markdown'
import { formatSize, formatTime } from '../lib/format'
import { Icon } from '../components/Icon'
import { PaneCollapseButton, SidePane } from '../components/SidePane'
import { Modal } from '../components/Modal'
import { BlockEditor } from '../wiki/BlockEditor'
import { buildDoc, serializeDoc, type BuiltDoc, type PMNode } from '../wiki/markdown-model'
import { usePageSave, type SaveStatus } from '../wiki/usePageSave'
import { WIcon } from '../wiki/WikiIcons'
import { WikiHtml, renderWikiMarkdown } from '../wiki/WikiHtml'
import { onNav } from '../lib/nav'

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

  // 다른 화면(⌘K, 채팅의 위키 링크, 북마크 등)에서 온 위키 페이지 이동 요청
  const wikiIdRef = useRef(wikiId)
  wikiIdRef.current = wikiId
  const pendingPage = useRef<string | null>(null)
  useEffect(
    () =>
      onNav((req) => {
        if (req.kind !== 'wikiPage') return
        if (req.wikiId === wikiIdRef.current) setPageId(req.pageId)
        else {
          pendingPage.current = req.pageId
          setWikiId(req.wikiId)
        }
      }),
    []
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
        const wanted = pendingPage.current
        pendingPage.current = null
        setPageId(wanted ?? roots.find((r) => r.id === home)?.id ?? home ?? roots[0]?.id ?? null)
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
              onClick={() => setPageId(p.id)}
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
      <SidePane id="wiki-list" label="위키 목록" className="wiki-list-col" defaultWidth={216} min={160} max={400}>
        <div className="wiki-col-head">
          <span className="col-title">위키</span>
          <span className="muted small">{list.length}</span>
          <PaneCollapseButton />
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
                if (w.id !== wikiId) setWikiId(w.id)
              }}
            >
              <Icon name="book" size={15} />
              <span className="ellipsis">{w.name}</span>
            </button>
          ))}
          {wikis !== null && filteredWikis.length === 0 && <div className="muted small pad">{wikiFilter ? '맞는 위키가 없습니다.' : '볼 수 있는 위키가 없습니다.'}</div>}
        </nav>
      </SidePane>
      <SidePane id="wiki-tree" label="페이지 목록" className="tree-col" defaultWidth={284} min={180} max={560}>
        <div className="wiki-col-head">
          <span className="col-title ellipsis">{currentWiki?.name ?? '페이지'}</span>
          {wikiId && (
            <button className="icon-btn" onClick={() => void loadChildren(null)} title="페이지 목록 새로고침" aria-label="페이지 목록 새로고침">
              <Icon name="refresh" size={15} />
            </button>
          )}
          <PaneCollapseButton />
        </div>
        <div className="list-scroll tree" role="tree">
          {wikiId ? renderTree(ROOT, 0) : <div className="muted small pad">왼쪽에서 위키를 고르세요.</div>}
        </div>
      </SidePane>
      <div className="body-col">
        {wikiId && pageId ? (
          <PageView
            key={pageId}
            wikiId={wikiId}
            pageId={pageId}
            pages={allPages}
            onOpen={setPageId}
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
  onOpen,
  onTreeChanged
}: {
  wikiId: string
  pageId: string
  pages: WikiPageSummary[]
  onOpen: (id: string) => void
  onTreeChanged: (parentId: string | null) => Promise<void>
}) {
  const { toast } = useApp()
  const [page, setPage] = useState<WikiPage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [gen, setGen] = useState(0)
  const [dialog, setDialog] = useState<'new' | 'move' | null>(null)
  const flushRef = useRef<(() => Promise<void>) | null>(null)

  const load = useCallback(async () => {
    try {
      // 다시 불러오기 전에 보류 중인 저장을 먼저 끝낸다 (내 저장을 남의 변경으로 착각하지 않게)
      await flushRef.current?.().catch(() => {})
      const p = await call('wiki:page', wikiId, pageId)
      setPage(p)
      setGen((g) => g + 1)
      setError(null)
    } catch (e) {
      setError(errorText(e))
    }
  }, [wikiId, pageId])

  useEffect(() => {
    void load()
  }, [load])

  if (error) return <div className="banner banner-err">{error}</div>
  if (!page) return <div className="empty">불러오는 중…</div>

  // 단건 조회 응답의 wikiId 를 쓴다 (목록에서 받은 위키 ID 와 다를 수 있다)
  const wid = page.wikiId || wikiId

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
    <>
      <PageBody
        key={gen}
        wikiId={wid}
        page={page}
        onReload={load}
        flushRef={flushRef}
        onTitleSaved={() => void onTreeChanged(page.parentPageId)}
        onNewChild={() => setDialog('new')}
        onMove={() => setDialog('move')}
        onRemove={() => void remove()}
      />
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
    </>
  )
}

type Mode = 'block' | 'raw'
type Built = BuiltDoc & { source: string; gen: number }

function buildFor(source: string, gen: number): Built {
  return { ...buildDoc(source), source, gen }
}

/** 한 페이지의 편집 화면. 페이지를 다시 불러오면 통째로 새로 만든다 (key). */
function PageBody({
  wikiId,
  page,
  onReload,
  flushRef,
  onTitleSaved,
  onNewChild,
  onMove,
  onRemove
}: {
  wikiId: string
  page: WikiPage
  onReload: () => Promise<void>
  flushRef: { current: (() => Promise<void>) | null }
  onTitleSaved: () => void
  onNewChild: () => void
  onMove: () => void
  onRemove: () => void
}) {
  const { toast } = useApp()
  const nameOf = useMemberNames()
  const initial = useMemo(() => buildFor(page.content, 0), [page.content])
  const [built, setBuilt] = useState<Built>(initial)
  const [mode, setMode] = useState<Mode>(initial.fatal ? 'raw' : 'block')
  const [fallback, setFallback] = useState<string | null>(initial.fatal)
  const [subject, setSubject] = useState(page.subject)
  const [rawText, setRawText] = useState(page.content)
  const [meta, setMeta] = useState({ version: page.version, updatedAt: page.updatedAt })
  const [showConflict, setShowConflict] = useState(false)
  const [showBackups, setShowBackups] = useState(false)

  const editorRef = useRef<Editor | null>(null)
  const ready = useRef(mode === 'raw')
  const st = useRef({ mode, built, subject, rawText })
  st.current = { mode, built, subject, rawText }

  const currentContent = useCallback((): string | null => {
    const s = st.current
    if (s.mode === 'raw') return s.rawText
    const ed = editorRef.current
    if (!ed || !ready.current) return null
    return serializeDoc(ed.getJSON() as PMNode, s.built.map)
  }, [])

  const save = usePageSave({
    wikiId,
    page,
    getCurrent: () => {
      const content = currentContent()
      return content === null ? null : { subject: st.current.subject.trim(), content }
    },
    onSaved: (r, prev) => {
      setMeta({ version: r.version, updatedAt: r.updatedAt })
      if (r.subject !== prev.subject) onTitleSaved()
    },
    onLostChanges: (m) => toast(m)
  })

  // 열 때 안전 검사: 편집기로 읽고 다시 쓴 결과가 원문과 바이트 단위로 같아야 블록 편집을 연다
  const onReady = useCallback(
    (ed: Editor) => {
      editorRef.current = ed
      const out = serializeDoc(ed.getJSON() as PMNode, st.current.built.map)
      if (out !== st.current.built.source) {
        ready.current = false
        setRawText(st.current.built.source)
        setFallback('편집기로 읽고 다시 쓴 결과가 원문과 달라서')
        setMode('raw')
        ready.current = true
        return
      }
      ready.current = true
    },
    []
  )

  const setEditorRef = useCallback((e: Editor | null) => {
    if (e) editorRef.current = e
  }, [])

  const toRaw = () => {
    const c = currentContent()
    if (c !== null) setRawText(c)
    ready.current = true
    setMode('raw')
  }
  const toBlock = () => {
    const b = buildFor(rawText, built.gen + 1)
    if (b.fatal) return toast(`블록 편집으로 열 수 없습니다: ${b.fatal}`)
    ready.current = false
    editorRef.current = null
    setBuilt(b)
    setFallback(null)
    setMode('block')
  }

  flushRef.current = save.flush

  // ⌘S: 기다리지 않고 지금 저장
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void save.flush()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [save])

  useEffect(() => {
    if (save.status.kind === 'conflict') setShowConflict(true)
  }, [save.status])

  const uploadImage = useCallback(
    async (file: File) => {
      try {
        toast(`이미지 올리는 중: ${file.name || '붙여넣은 이미지'}`, 'info')
        const bytes = new Uint8Array(await file.arrayBuffer())
        const name = file.name && file.name !== 'image.png' ? file.name : `image-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.png`
        return await call('wiki:uploadImage', wikiId, page.id, name, file.type || 'image/png', bytes)
      } catch (e) {
        toast(`이미지를 올리지 못했습니다: ${errorText(e)}`)
        return null
      }
    },
    [wikiId, page.id, toast]
  )

  const previewHtml = useMemo(() => (mode === 'raw' ? renderWikiMarkdown(previewSource(rawText)) : ''), [mode, rawText])
  const rawCount = built.rawBlocks.length

  return (
    <div className="page">
      <div className="page-head wk-head">
        <div className="page-meta-inline muted small ellipsis grow">
          {nameOf(page.creatorId) ?? ''} 작성 · {formatTime(meta.updatedAt)} 수정 · 버전 {meta.version}
        </div>
        <SaveBadge status={save.status} onRetry={() => void save.retry()} onConflict={() => setShowConflict(true)} />
        <div className="seg" role="group" aria-label="편집 방식">
          <button className={mode === 'block' ? 'on' : ''} aria-pressed={mode === 'block'} disabled={mode === 'block'} onClick={toBlock} title={fallback ? `블록 편집을 막았습니다: ${fallback}` : '본문을 눌러 바로 고칩니다'}>
            <WIcon name="blocks" size={13} /> 블록 편집
          </button>
          <button className={mode === 'raw' ? 'on' : ''} aria-pressed={mode === 'raw'} disabled={mode === 'raw'} onClick={toRaw} title="마크다운 원문을 보고 고칩니다">
            <WIcon name="source" size={13} /> 원문 보기
          </button>
        </div>
        <button className="icon-btn" onClick={() => setShowBackups(true)} title="되돌리기 (로컬 백업)" aria-label="되돌리기">
          <WIcon name="history" size={16} />
        </button>
        <button className="small" onClick={onNewChild}>
          <Icon name="plus" size={14} /> 하위 페이지
        </button>
        <button className="small" onClick={onMove}>
          이동
        </button>
        <button className="icon-btn" onClick={onRemove} title="삭제" aria-label="페이지 삭제">
          <Icon name="trash" size={16} />
        </button>
      </div>
      <div className="page-scroll">
        {fallback && (
          <div className="banner banner-warn wk-fallback" role="status">
            <WIcon name="lock" size={14} /> 원문 편집으로 열었습니다 — {fallback} 블록 편집으로 열면 다른 사람이 보는 원문이 바뀔 수 있습니다.
          </div>
        )}
        <div className="wk-doc">
          <input
            className="wk-title"
            value={subject}
            placeholder="제목 없음"
            aria-label="제목"
            onChange={(e) => {
              setSubject(e.target.value)
              st.current.subject = e.target.value
              save.notifyChange()
            }}
            onKeyDown={(e) => {
              if ((e.key === 'Enter' || e.key === 'ArrowDown') && mode === 'block' && editorRef.current) {
                e.preventDefault()
                editorRef.current.commands.focus('start')
              }
            }}
          />
          {mode === 'block' && rawCount > 0 && (
            <div className="wk-note muted small">두레이 전용 문법 {rawCount}곳은 원문 블록으로 그대로 보존합니다.</div>
          )}
        </div>
        {mode === 'block' ? (
          <BlockEditor
            key={built.gen}
            wikiId={wikiId}
            pageId={page.id}
            initialDoc={built.doc}
            onReady={onReady}
            onChange={() => save.notifyChange()}
            uploadImage={uploadImage}
            editorRef={setEditorRef}
          />
        ) : (
          <div className="editor wk-raw-mode">
            <textarea
              value={rawText}
              onChange={(e) => {
                setRawText(e.target.value)
                st.current.rawText = e.target.value
                save.notifyChange()
              }}
              spellCheck={false}
              aria-label="마크다운 원문"
            />
            <WikiHtml className="md preview wiki-body" html={previewHtml} wikiId={wikiId} pageId={page.id} />
          </div>
        )}
        <Attachments page={page} wikiId={wikiId} onChanged={onReload} />
        <Comments wikiId={wikiId} pageId={page.id} />
      </div>
      {showConflict && save.status.kind === 'conflict' && (
        <ConflictDialog
          server={save.status.server}
          baseVersion={save.baseRef.current.version}
          onClose={() => setShowConflict(false)}
          onOverwrite={() => {
            setShowConflict(false)
            void save.overwrite()
          }}
          onLoadServer={async () => {
            setShowConflict(false)
            await save.keepUnsaved('mine-before-reload')
            save.discard()
            toast('내 변경은 로컬에 백업했습니다. 되돌리기에서 볼 수 있습니다.', 'info')
            await onReload()
          }}
        />
      )}
      {showBackups && (
        <BackupsDialog
          pageId={page.id}
          onClose={() => setShowBackups(false)}
          onRestore={async (b) => {
            setShowBackups(false)
            await save.flush()
            const cur = currentContent()
            if (cur !== null && cur !== b.content) {
              try {
                await call('wiki:backupAdd', { pageId: page.id, wikiId, kind: 'before-restore', subject: subject.trim(), content: cur, version: meta.version })
              } catch {
                /* 백업 실패해도 되돌리기는 계속 (확인을 받았다) */
              }
            }
            if (await save.saveContent({ subject: b.subject, content: b.content })) {
              save.discard()
              await onReload()
            }
          }}
        />
      )}
    </div>
  )
}

function SaveBadge({ status, onRetry, onConflict }: { status: SaveStatus; onRetry: () => void; onConflict: () => void }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (status.kind !== 'saved') return
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [status.kind])
  switch (status.kind) {
    case 'clean':
      return null
    case 'dirty':
      return (
        <span className="wk-save is-dirty" role="status">
          <i /> 저장 안 됨
        </span>
      )
    case 'saving':
      return (
        <span className="wk-save is-saving" role="status">
          <i /> 저장 중…
        </span>
      )
    case 'saved':
      return (
        <span className="wk-save is-saved" role="status" title={new Date(status.at).toLocaleString()}>
          <i /> {new Date(status.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 저장됨
        </span>
      )
    case 'error':
      return (
        <span className="wk-save is-error" role="alert" title={status.message}>
          <i /> 저장 실패
          <button className="link" onClick={onRetry}>
            다시 시도
          </button>
        </span>
      )
    case 'conflict':
      return (
        <span className="wk-save is-error" role="alert">
          <i /> 다른 사람이 고침
          <button className="link" onClick={onConflict}>
            선택하기
          </button>
        </span>
      )
  }
}

function ConflictDialog({
  server,
  baseVersion,
  onClose,
  onOverwrite,
  onLoadServer
}: {
  server: WikiServerCopy
  baseVersion: string
  onClose: () => void
  onOverwrite: () => void
  onLoadServer: () => void
}) {
  const [confirmOverwrite, setConfirmOverwrite] = useState(false)
  return (
    <Modal title="그사이 다른 사람이 이 페이지를 고쳤습니다" onClose={onClose}>
      <p className="small">
        이 페이지를 연 뒤(버전 {baseVersion}) 서버 페이지가 바뀌었습니다(버전 {server.version}
        {server.updatedAt ? `, ${formatTime(server.updatedAt)}` : ''}). 그래서 저장하지 않고 멈췄습니다.
      </p>
      <div className="wk-conflict-preview">
        <div className="muted small">서버에 있는 지금 내용</div>
        <pre>{server.content.slice(0, 600)}{server.content.length > 600 ? '\n…' : ''}</pre>
      </div>
      <div className="wk-choices">
        <button className="primary" onClick={onLoadServer}>
          서버 것 불러오기
          <span className="small">내 변경은 로컬에 백업</span>
        </button>
        {confirmOverwrite ? (
          <button className="danger-btn" onClick={onOverwrite}>
            정말 덮어쓰기
            <span className="small">다른 사람이 고친 내용이 사라집니다</span>
          </button>
        ) : (
          <button onClick={() => setConfirmOverwrite(true)}>
            내 것으로 덮어쓰기
            <span className="small">서버 내용을 내 내용으로 바꿈</span>
          </button>
        )}
        <button onClick={onClose}>
          취소
          <span className="small">저장을 멈춘 채 계속 편집</span>
        </button>
      </div>
    </Modal>
  )
}

const BACKUP_KIND: Record<WikiBackup['kind'], string> = {
  'before-first-save': '처음 저장하기 전 원문',
  'mine-before-reload': '서버 것을 불러오기 전 내 변경',
  'unsaved-on-close': '저장하지 못한 변경',
  'before-restore': '되돌리기 전 내용'
}

function BackupsDialog({ pageId, onClose, onRestore }: { pageId: string; onClose: () => void; onRestore: (b: WikiBackup) => Promise<void> }) {
  const { toast } = useApp()
  const [list, setList] = useState<WikiBackup[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    call('wiki:backups', pageId)
      .then((l) => {
        setList(l)
        setOpen(l[0]?.id ?? null)
      })
      .catch((e) => toast(errorText(e)))
  }, [pageId, toast])
  return (
    <Modal title="되돌리기 — 이 컴퓨터에 남긴 백업" onClose={onClose} wide>
      <p className="muted small">자동 저장 전에 이 앱이 이 컴퓨터에만 남긴 원문입니다. 고르면 그 내용으로 저장합니다(지금 내용도 백업해 둡니다).</p>
      {list === null ? (
        <div className="muted small">불러오는 중…</div>
      ) : list.length === 0 ? (
        <div className="muted small pad">아직 백업이 없습니다. 이 페이지를 처음 저장할 때 원문이 백업됩니다.</div>
      ) : (
        <div className="wk-backups">
          {list.map((b) => (
            <div key={b.id} className={`wk-backup ${open === b.id ? 'open' : ''}`}>
              <button className="wk-backup-head" onClick={() => setOpen(open === b.id ? null : b.id)} aria-expanded={open === b.id}>
                <span className="grow ellipsis">
                  <b>{formatTime(b.savedAt)}</b> · {BACKUP_KIND[b.kind] ?? b.kind}
                </span>
                <span className="muted small">버전 {b.version}</span>
              </button>
              {open === b.id && (
                <div className="wk-backup-body">
                  <div className="small">
                    제목: <b>{b.subject}</b>
                  </div>
                  <pre>{b.content.slice(0, 1200)}{b.content.length > 1200 ? '\n…' : ''}</pre>
                  <div className="row end">
                    <button
                      className="primary small"
                      onClick={() => {
                        if (window.confirm(`${formatTime(b.savedAt)} 백업(${BACKUP_KIND[b.kind] ?? b.kind})으로 되돌려 저장할까요?\n지금 내용은 백업해 둡니다.`)) void onRestore(b)
                      }}
                    >
                      이 내용으로 되돌리기
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
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
