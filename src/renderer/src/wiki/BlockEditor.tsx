// 블록 단위 WYSIWYG 위키 편집기.
// - 본문을 바로 눌러 고친다 (보기/편집 모드 없음)
// - '/' 명령 메뉴, 마크다운 단축 입력(Tiptap 입력 규칙), 블록 왼쪽 손잡이로 순서 바꾸기
// - 글자를 고르면 서식 툴바, 이미지 붙여넣기·끌어 놓기 업로드
// 마크다운 변환은 markdown-model.ts, 스키마는 extensions.ts.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type Editor, type NodeViewProps } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Extension, type Range } from '@tiptap/core'
import Suggestion, { type SuggestionProps } from '@tiptap/suggestion'
import { Placeholder } from '@tiptap/extensions'
import { NodeSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { call } from '../api'
import { renderMarkdown } from '../lib/markdown'
import { schemaExtensions } from './extensions'
import type { PMNode } from './markdown-model'
import { WIcon } from './WikiIcons'

interface EditorEnv {
  wikiId: string
  pageId: string
  editable: boolean
}
const EnvCtx = createContext<EditorEnv>({ wikiId: '', pageId: '', editable: true })

/* ───────────── 노드 뷰 ───────────── */

function ImageView({ node, selected }: NodeViewProps) {
  const env = useContext(EnvCtx)
  const src = String(node.attrs.src ?? '')
  const alt = String(node.attrs.alt ?? '')
  const direct = /^(data:image\/|blob:)/.test(src)
  const [url, setUrl] = useState<string | null | undefined>(direct ? src : undefined)
  useEffect(() => {
    if (direct) return setUrl(src)
    let alive = true
    setUrl(undefined)
    call('wiki:image', env.wikiId, env.pageId, src)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setUrl(null))
    return () => {
      alive = false
    }
  }, [src, direct, env.wikiId, env.pageId])
  return (
    <NodeViewWrapper as="span" className={`wk-img ${selected ? 'is-selected' : ''}`} data-drag-handle="">
      {url ? (
        <img src={url} alt={alt} title={alt || undefined} draggable={false} />
      ) : (
        <span className="wk-img-missing">
          <WIcon name="image" size={15} />
          {url === undefined ? '이미지 불러오는 중…' : `이미지를 보여줄 수 없습니다${alt ? ` (${alt})` : ''}`}
        </span>
      )}
    </NodeViewWrapper>
  )
}

function RawView({ node, updateAttributes, selected, deleteNode }: NodeViewProps) {
  const env = useContext(EnvCtx)
  const source = String(node.attrs.source ?? '')
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(source)
  const isToc = source.trim() === '${toc}'
  const html = useMemo(() => renderMarkdown(source.replace(/\$\{toc\}/g, ''), { breaks: false }), [source])
  const finish = () => {
    setEditing(false)
    if (text !== source) {
      if (!text.trim()) deleteNode()
      else updateAttributes({ source: text.replace(/\s+$/, '') })
    }
  }
  return (
    <NodeViewWrapper className={`wk-raw ${selected ? 'is-selected' : ''} ${isToc ? 'is-toc' : ''}`} data-drag-handle="">
      <div className="wk-raw-label" contentEditable={false}>
        <WIcon name="source" size={12} />
        {isToc ? '목차 — 두레이 웹에서 자동으로 만들어집니다' : '원문 블록 — 두레이 전용 문법이라 원문 그대로 보존합니다'}
        {env.editable && !editing && !isToc && (
          <button className="link" onClick={() => (setText(source), setEditing(true))}>
            원문 고치기
          </button>
        )}
      </div>
      {editing ? (
        <div className="wk-raw-edit" contentEditable={false}>
          <textarea
            value={text}
            autoFocus
            spellCheck={false}
            rows={Math.min(14, text.split('\n').length + 1)}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setText(source)
                setEditing(false)
              }
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') finish()
            }}
            aria-label="원문 블록 마크다운"
          />
          <div className="row end">
            <button className="small" onClick={() => (setText(source), setEditing(false))}>
              취소
            </button>
            <button className="small primary" onClick={finish}>
              완료
            </button>
          </div>
        </div>
      ) : (
        !isToc && <div className="md wk-raw-preview" contentEditable={false} dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </NodeViewWrapper>
  )
}

/* ───────────── '/' 명령 ───────────── */

interface SlashItem {
  id: string
  label: string
  hint: string
  icon: string
  keys: string
  run: (editor: Editor, range: Range) => void
}

function slashItems(pickImage: () => void): SlashItem[] {
  const base = (e: Editor, r: Range) => e.chain().focus().deleteRange(r)
  return [
    { id: 'p', label: '본문', hint: '', icon: 'text', keys: 'text paragraph 본문 문단 글', run: (e, r) => base(e, r).setParagraph().run() },
    { id: 'h1', label: '제목 1', hint: '# ', icon: 'h1', keys: 'h1 heading title 제목 큰', run: (e, r) => base(e, r).setNode('heading', { level: 1 }).run() },
    { id: 'h2', label: '제목 2', hint: '## ', icon: 'h2', keys: 'h2 heading 제목 중간', run: (e, r) => base(e, r).setNode('heading', { level: 2 }).run() },
    { id: 'h3', label: '제목 3', hint: '### ', icon: 'h3', keys: 'h3 heading 제목 작은', run: (e, r) => base(e, r).setNode('heading', { level: 3 }).run() },
    { id: 'ul', label: '글머리 목록', hint: '- ', icon: 'bullet', keys: 'bullet list ul 목록 글머리', run: (e, r) => base(e, r).toggleBulletList().run() },
    { id: 'ol', label: '번호 목록', hint: '1. ', icon: 'ordered', keys: 'number ordered list ol 번호 목록', run: (e, r) => base(e, r).toggleOrderedList().run() },
    { id: 'todo', label: '체크리스트', hint: '[] ', icon: 'check', keys: 'todo task check 체크 할일 할 일', run: (e, r) => base(e, r).toggleTaskList().run() },
    { id: 'table', label: '표', hint: '', icon: 'table', keys: 'table 표 테이블', run: (e, r) => base(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { id: 'code', label: '코드', hint: '```', icon: 'codeblock', keys: 'code 코드 블록', run: (e, r) => base(e, r).setCodeBlock().run() },
    { id: 'quote', label: '인용', hint: '> ', icon: 'quote', keys: 'quote blockquote 인용', run: (e, r) => base(e, r).setBlockquote().run() },
    { id: 'hr', label: '구분선', hint: '---', icon: 'hr', keys: 'divider hr line 구분선 선', run: (e, r) => base(e, r).setHorizontalRule().run() },
    {
      id: 'image',
      label: '이미지',
      hint: '',
      icon: 'image',
      keys: 'image picture 이미지 그림 사진',
      run: (e, r) => {
        base(e, r).run()
        pickImage()
      }
    }
  ]
}

interface SlashBridge {
  set: (p: SuggestionProps<SlashItem, SlashItem> | null) => void
  key: (e: KeyboardEvent) => boolean
  items: () => SlashItem[]
}

function slashExtension(bridge: SlashBridge) {
  return Extension.create({
    name: 'wikiSlash',
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem, SlashItem>({
          editor: this.editor,
          char: '/',
          items: ({ query }) => {
            const q = query.trim().toLowerCase()
            return bridge.items().filter((i) => !q || i.label.toLowerCase().includes(q) || i.keys.includes(q))
          },
          allow: ({ editor }) => !editor.isActive('codeBlock'),
          command: ({ editor, range, props }) => props.run(editor, range),
          render: () => ({
            onStart: (p) => bridge.set(p),
            onUpdate: (p) => bridge.set(p),
            onExit: () => bridge.set(null),
            onKeyDown: ({ event }) => bridge.key(event)
          })
        })
      ]
    }
  })
}

function SlashMenu({ state, index, onPick, onHover }: { state: SuggestionProps<SlashItem, SlashItem>; index: number; onPick: (i: SlashItem) => void; onHover: (n: number) => void }) {
  const rect = state.clientRect?.()
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
  }, [index])
  if (!rect) return null
  const below = rect.bottom + 320 < window.innerHeight
  const style = below ? { left: rect.left, top: rect.bottom + 6 } : { left: rect.left, bottom: window.innerHeight - rect.top + 6 }
  return (
    <div className="wk-slash" style={style} role="listbox" aria-label="블록 추가" ref={listRef} onMouseDown={(e) => e.preventDefault()}>
      {state.items.length === 0 ? (
        <div className="wk-slash-empty">맞는 블록이 없습니다</div>
      ) : (
        <>
          <div className="wk-slash-head">블록 추가</div>
          {state.items.map((it, n) => (
            <button key={it.id} role="option" aria-selected={n === index} className={n === index ? 'on' : ''} onMouseEnter={() => onHover(n)} onClick={() => onPick(it)}>
              <span className="wk-slash-icon">
                <WIcon name={it.icon} size={16} />
              </span>
              <span className="wk-slash-label">{it.label}</span>
              <span className="wk-slash-hint">{it.hint}</span>
            </button>
          ))}
        </>
      )}
    </div>
  )
}

/* ───────────── 블록 손잡이 (끌어서 순서 바꾸기) ───────────── */

function topBlockAt(view: EditorView, target: EventTarget | null, y: number): HTMLElement | null {
  const root = view.dom
  let el = target instanceof Node ? (target instanceof HTMLElement ? target : target.parentElement) : null
  if (el && root.contains(el) && el !== root) {
    while (el && el.parentElement !== root) el = el.parentElement
    return el
  }
  for (const c of Array.from(root.children) as HTMLElement[]) {
    const r = c.getBoundingClientRect()
    if (y >= r.top - 4 && y <= r.bottom + 4) return c
  }
  return null
}

function blockPos(view: EditorView, el: HTMLElement): number {
  let found = -1
  view.state.doc.forEach((_n, offset) => {
    if (found < 0 && view.nodeDOM(offset) === el) found = offset
  })
  return found
}

function DragHandle({ editor, wrapRef }: { editor: Editor; wrapRef: RefObject<HTMLDivElement | null> }) {
  const [box, setBox] = useState<{ top: number; el: HTMLElement } | null>(null)
  const dragging = useRef(false)
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const onMove = (e: MouseEvent) => {
      if (dragging.current) return
      if ((e.target as HTMLElement | null)?.closest?.('.wk-handle')) return
      const el = topBlockAt(editor.view, e.target, e.clientY)
      if (!el) return setBox(null)
      const r = el.getBoundingClientRect()
      const w = wrap.getBoundingClientRect()
      const style = getComputedStyle(el)
      const line = parseFloat(style.lineHeight) || 24
      const firstLine = Math.min(r.height, el.tagName === 'HR' ? r.height : line + parseFloat(style.paddingTop || '0'))
      setBox({ top: r.top - w.top + firstLine / 2 - 12, el })
    }
    const onLeave = () => !dragging.current && setBox(null)
    wrap.addEventListener('mousemove', onMove)
    wrap.addEventListener('mouseleave', onLeave)
    return () => {
      wrap.removeEventListener('mousemove', onMove)
      wrap.removeEventListener('mouseleave', onLeave)
    }
  }, [editor, wrapRef])
  if (!box || !editor.isEditable) return null
  const select = () => {
    const pos = blockPos(editor.view, box.el)
    if (pos < 0) return null
    const sel = NodeSelection.create(editor.state.doc, pos)
    editor.view.dispatch(editor.state.tr.setSelection(sel))
    return sel
  }
  return (
    <button
      className="wk-handle"
      style={{ top: box.top }}
      draggable
      title="끌어서 옮기기 · 눌러서 블록 고르기"
      aria-label="블록 옮기기"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={() => {
        select()
        editor.view.focus()
      }}
      onDragStart={(e) => {
        const sel = select()
        if (!sel) return e.preventDefault()
        dragging.current = true
        const slice = sel.content()
        const { dom, text } = editor.view.serializeForClipboard(slice)
        e.dataTransfer.clearData()
        e.dataTransfer.setData('text/html', dom.innerHTML)
        e.dataTransfer.setData('text/plain', text)
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setDragImage(box.el, 0, 0)
        editor.view.dragging = { slice, move: true }
      }}
      onDragEnd={() => {
        dragging.current = false
        setBox(null)
      }}
    >
      <WIcon name="grip" size={16} />
    </button>
  )
}

/* ───────────── 서식 툴바 ───────────── */

function normalizeHref(v: string): string | null {
  const s = v.trim()
  if (!s) return null
  if (/^(https?:|mailto:|\/|#)/i.test(s)) return s
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(s)) return 'https://' + s
  return s
}

// BubbleMenu 는 props 가 바뀌면 플러그인을 다시 등록한다 → 매번 새 함수·객체를 주면 무한 렌더. 모듈 상수로 둔다.
const BUBBLE_OPTIONS = { placement: 'top' as const, offset: 8 }
const bubbleShouldShow = ({ editor: ed, state }: { editor: Editor; state: Editor['state'] }) => {
  const { selection } = state
  if (!ed.isEditable || selection.empty || selection instanceof NodeSelection) return false
  return !ed.isActive('codeBlock')
}

function FormatBar({ editor }: { editor: Editor }) {
  const [linking, setLinking] = useState(false)
  const [href, setHref] = useState('')
  const btn = (name: string, label: string, active: boolean, run: () => void, shortcut?: string) => (
    <button className={active ? 'on' : ''} aria-pressed={active} title={shortcut ? `${label} (${shortcut})` : label} aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={run}>
      <WIcon name={name} size={16} />
    </button>
  )
  return (
    <BubbleMenu
      editor={editor}
      className="wk-bubble"
      options={BUBBLE_OPTIONS}
      shouldShow={bubbleShouldShow}
    >
      {linking ? (
        <form
          className="wk-link-form"
          onSubmit={(e) => {
            e.preventDefault()
            const url = normalizeHref(href)
            const chain = editor.chain().focus().extendMarkRange('link')
            if (url) chain.setLink({ href: url }).run()
            else chain.unsetLink().run()
            setLinking(false)
          }}
        >
          <input autoFocus value={href} placeholder="주소 붙여넣기 (비우면 링크 해제)" onChange={(e) => setHref(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setLinking(false)} aria-label="링크 주소" />
          <button className="small primary">적용</button>
        </form>
      ) : (
        <>
          {btn('bold', '굵게', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), '⌘B')}
          {btn('italic', '기울임', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), '⌘I')}
          {btn('strike', '취소선', editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run(), '⌘⇧S')}
          {btn('code', '인라인 코드', editor.isActive('code'), () => editor.chain().focus().toggleCode().run(), '⌘E')}
          <span className="wk-bubble-sep" />
          {btn('link', '링크', editor.isActive('link'), () => {
            setHref(String(editor.getAttributes('link').href ?? ''))
            setLinking(true)
          })}
          {editor.isActive('link') && btn('unlink', '링크 해제', false, () => editor.chain().focus().extendMarkRange('link').unsetLink().run())}
        </>
      )}
    </BubbleMenu>
  )
}

/* ───────────── 편집기 ───────────── */

export interface BlockEditorProps {
  wikiId: string
  pageId: string
  initialDoc: PMNode
  editable?: boolean
  /** 편집기가 만들어진 직후 (원문과 같은지 검사용) */
  onReady: (editor: Editor) => void
  onChange: (editor: Editor) => void
  /** 이미지 바이트를 올리고 본문용 경로를 받는다 */
  uploadImage: (file: File) => Promise<{ src: string; name: string } | null>
  /** 제목 칸에서 ↓/Enter 로 내려올 때 쓰려고 편집기를 넘긴다 */
  editorRef?: (e: Editor | null) => void
}

function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) => f.type.startsWith('image/'))
}

export function BlockEditor({ wikiId, pageId, initialDoc, editable = true, onReady, onChange, uploadImage, editorRef }: BlockEditorProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [slash, setSlash] = useState<SuggestionProps<SlashItem, SlashItem> | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const live = useRef({ slash, slashIndex, onChange, onReady, uploadImage })
  live.current = { slash, slashIndex, onChange, onReady, uploadImage }
  const editorBox = useRef<Editor | null>(null)

  const insertImages = async (files: File[], at?: number) => {
    const ed = editorBox.current
    if (!ed) return
    for (const f of files) {
      const r = await live.current.uploadImage(f)
      if (!r) continue
      const node = { type: 'image', attrs: { src: r.src, alt: r.name } }
      if (at !== undefined) ed.chain().focus().insertContentAt(at, node).run()
      else ed.chain().focus().insertContent(node).run()
    }
  }

  const extensions = useMemo(() => {
    const bridge: SlashBridge = {
      set: (p) => {
        setSlash(p)
        if (!p) setSlashIndex(0)
      },
      key: (e) => {
        const s = live.current.slash
        if (!s) return false
        const n = s.items.length
        if (e.key === 'ArrowDown') return setSlashIndex((i) => (n ? (i + 1) % n : 0)), true
        if (e.key === 'ArrowUp') return setSlashIndex((i) => (n ? (i - 1 + n) % n : 0)), true
        if (e.key === 'Enter' || e.key === 'Tab') {
          const it = s.items[Math.min(live.current.slashIndex, n - 1)]
          if (it) s.command(it)
          return !!it
        }
        if (e.key === 'Escape') return setSlash(null), true
        return false
      },
      items: () => slashItems(() => fileRef.current?.click())
    }
    return [
      ...schemaExtensions({
        image: ReactNodeViewRenderer(ImageView),
        mdRaw: ReactNodeViewRenderer(RawView, {
          stopEvent: ({ event }) => !!(event.target as HTMLElement | null)?.closest?.('textarea, button, input')
        })
      }),
      Placeholder.configure({
        placeholder: ({ node }) => (node.type.name === 'heading' ? '제목' : "내용을 쓰거나 '/' 로 블록 추가"),
        showOnlyCurrent: true
      }),
      slashExtension(bridge)
    ]
  }, [])

  const editor = useEditor(
    {
      extensions,
      content: initialDoc,
      editable,
      immediatelyRender: true,
      shouldRerenderOnTransaction: true,
      editorProps: {
        attributes: { class: 'wk-editor md', 'aria-label': '위키 본문', spellcheck: 'false' },
        handlePaste: (_view, event) => {
          const files = imageFiles(event.clipboardData?.files)
          if (!files.length) return false
          event.preventDefault()
          void insertImages(files)
          return true
        },
        handleDrop: (view, event, _slice, moved) => {
          if (moved) return false
          const files = imageFiles((event as DragEvent).dataTransfer?.files)
          if (!files.length) return false
          event.preventDefault()
          const pos = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY })
          void insertImages(files, pos?.pos)
          return true
        },
        handleClickOn: (_view, _pos, _node, _nodePos, event) => {
          const a = (event.target as HTMLElement | null)?.closest?.('a')
          if (a && (event.metaKey || event.ctrlKey)) {
            const href = a.getAttribute('href') ?? ''
            if (/^(https?:|mailto:)/i.test(href)) void call('shell:openExternal', href)
            return true
          }
          return false
        }
      },
      onCreate: ({ editor: ed }) => {
        editorBox.current = ed
        live.current.onReady(ed)
      },
      onUpdate: ({ editor: ed }) => live.current.onChange(ed)
    },
    []
  )

  useEffect(() => {
    editorRef?.(editor)
    return () => editorRef?.(null)
  }, [editor, editorRef])

  const env = useMemo(() => ({ wikiId, pageId, editable }), [wikiId, pageId, editable])

  return (
    <EnvCtx.Provider value={env}>
      <div className="wk-wrap" ref={wrapRef}>
        {editor && <DragHandle editor={editor} wrapRef={wrapRef} />}
        <EditorContent editor={editor} />
        {editor && <FormatBar editor={editor} />}
        {slash && <SlashMenu state={slash} index={Math.min(slashIndex, Math.max(0, slash.items.length - 1))} onHover={setSlashIndex} onPick={(it) => slash.command(it)} />}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const files = imageFiles(e.target.files)
            e.target.value = ''
            void insertImages(files)
          }}
        />
      </div>
    </EnvCtx.Provider>
  )
}
