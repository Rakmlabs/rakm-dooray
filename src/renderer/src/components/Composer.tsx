import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Member } from '@shared/types'
import { call } from '../api'
import { useMemberNames } from '../state'
import { Icon } from './Icon'
import { Avatar } from './people/Avatar'
import { ChatIcon } from './chat/ChatIcon'
import { EmojiPicker } from './chat/EmojiPicker'
import { WikiLinkDialog } from './chat/WikiLinkDialog'
import { useOrganizationId, useProfile } from './chat/chatStore'
import { activeMention, applyFormat, applyMentions, autoCloseFence, closeOpenFence, indentCode, insideCodeFence, type Edit, type FormatKind } from './chat/composerText'
import { renderMarkdown } from '../lib/markdown'
import { EDIT_LAST_EVENT, type EditLastDetail } from './MessageList'
import { sendOptimistic } from './chat/pendingStore'
import { AttachTray } from './files/AttachTray'
import { useUploadQueue } from './files/uploadQueue'

interface Props {
  placeholder: string
  onSend: (text: string) => Promise<void>
  onAttach?: () => Promise<void>
  banner?: ReactNode
  onCancelBanner?: () => void
  disabled?: boolean
  autoFocusKey?: string
  /** 이 대화방 참여자를 멘션 후보 맨 앞에 둔다. 임시 저장 키로도 쓴다 */
  channelId?: string
  /** 임시 저장 키 (없으면 channelId, 그것도 없으면 placeholder) */
  draftKey?: string
  /** 멘션 후보를 가져올 대화방 (없으면 channelId). 스레드는 원래 대화방을 넣는다 */
  mentionChannelId?: string
  /** 있으면 낙관적 전송: Enter 를 누르면 입력창을 바로 비우고, 목록(같은 키의 MessageList)에 "보내는 중" 으로 먼저 그린다.
   *  답장·스레드 시작처럼 배너가 떠 있을 때는 예전처럼 끝날 때까지 기다린다. */
  pendingKey?: string
}

// ---------- 임시 저장 (localStorage) ----------

interface Draft {
  text: string
  /** 입력창에는 @이름 으로 보이고, 보낼 때 두레이 멘션 형식으로 바꾼다 */
  mentions: Record<string, string>
}

const DRAFT_PREFIX = 'rakm.chat.draft.'

function loadDraft(key: string): Draft {
  try {
    const raw = window.localStorage.getItem(DRAFT_PREFIX + key)
    if (!raw) return { text: '', mentions: {} }
    const d = JSON.parse(raw) as Partial<Draft>
    return { text: typeof d.text === 'string' ? d.text : '', mentions: d.mentions && typeof d.mentions === 'object' ? d.mentions : {} }
  } catch {
    return { text: '', mentions: {} }
  }
}

function saveDraft(key: string, d: Draft): void {
  try {
    if (!d.text.trim()) window.localStorage.removeItem(DRAFT_PREFIX + key)
    else window.localStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(d))
  } catch {
    /* 저장소를 못 쓰면 임시 저장 없이 동작 */
  }
}

/** 입력창 최대 높이. 넘치면 안에서 스크롤 (chat.css 의 .composer-input max-height 와 같게) */
const MAX_INPUT_PX = 240
/** CSS 로 내용 높이에 맞춘다 (Chromium 123+). 그러면 글자마다 높이를 재지 않는다 = 대화 목록을 다시 배치하지 않는다 */
const FIELD_SIZING = typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content')

// 기본은 끔 (0.1.6 까지는 켬이 기본이라 키를 바꿨다)
const PREVIEW_KEY = 'rakm.chat.codePreview.v2'
function loadPreviewPref(): boolean {
  try {
    return window.localStorage.getItem(PREVIEW_KEY) === '1'
  } catch {
    return false
  }
}
function savePreviewPref(on: boolean): void {
  try {
    window.localStorage.setItem(PREVIEW_KEY, on ? '1' : '0')
  } catch {
    /* 무시 */
  }
}

// ---------- 멘션 ----------

const channelParticipants = new Map<string, Promise<string[]>>()
function participantsOf(channelId: string): Promise<string[]> {
  let p = channelParticipants.get(channelId)
  if (!p) {
    p = call('messenger:channels')
      .then((list) => list.find((c) => c.id === channelId)?.participantIds ?? [])
      .catch(() => {
        channelParticipants.delete(channelId)
        return []
      })
    channelParticipants.set(channelId, p)
  }
  return p
}

/** 서식 단축키 (두레이 웹 메신저와 같은 키): ⌘⇧C 인라인 코드, ⌘⌥C 코드 블록, ⌘⇧U 링크 */
export function formatShortcut(e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; code: string }): FormatKind | null {
  const mod = e.metaKey || e.ctrlKey
  if (!mod) return null
  if (e.code === 'KeyC' && e.altKey && !e.shiftKey) return 'block'
  if (e.code === 'KeyC' && e.shiftKey && !e.altKey) return 'inline'
  if (e.code === 'KeyU' && e.shiftKey && !e.altKey) return 'link'
  return null
}

/** Enter 전송, Shift+Enter 줄바꿈 (코드 블록 안에서는 Enter 도 줄바꿈, ⌘/Ctrl+Enter 는 항상 전송). 한글 조합 중 Enter 는 무시한다. */
export const Composer = memo(ComposerImpl)

function ComposerImpl({
  placeholder,
  onSend,
  onAttach,
  banner,
  onCancelBanner,
  disabled,
  autoFocusKey,
  channelId,
  draftKey,
  mentionChannelId,
  pendingKey
}: Props) {
  const key = draftKey ?? channelId ?? placeholder
  const [state, setState] = useState<{ key: string } & Draft>(() => ({ key, ...loadDraft(key) }))
  // 방을 옮기면 그 방의 임시 저장 글로 바꾼다
  if (state.key !== key) setState({ key, ...loadDraft(key) })
  const text = state.text
  const setText = (t: string, mentions?: Record<string, string>) => setState((s) => ({ ...s, text: t, mentions: mentions ?? s.mentions }))

  const [sending, setSending] = useState(false)
  const [caret, setCaret] = useState(0)
  const [menuIndex, setMenuIndex] = useState(0)
  const [menuClosedAt, setMenuClosedAt] = useState<number | null>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [wikiOpen, setWikiOpen] = useState(false)
  const [previewOn, setPreviewOn] = useState(() => loadPreviewPref())
  const [searchResults, setSearchResults] = useState<Member[]>([])
  const [participants, setParticipants] = useState<string[]>([])
  const ref = useRef<HTMLTextAreaElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const nameOf = useMemberNames()
  const me = useProfile('me')
  const organizationId = useOrganizationId()

  useEffect(() => {
    ref.current?.focus()
  }, [autoFocusKey])

  // field-sizing 을 못 쓰는 환경에서만: 줄 수가 바뀔 때만 잰다
  const lineCount = useMemo(() => (FIELD_SIZING ? 0 : text.split('\n').length + Math.floor(text.length / 80)), [text])
  useEffect(() => {
    const el = ref.current
    if (!el || FIELD_SIZING) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(MAX_INPUT_PX, el.scrollHeight)}px`
    el.style.overflowY = el.scrollHeight > MAX_INPUT_PX ? 'auto' : 'hidden'
  }, [lineCount])

  const uploads = useUploadQueue()
  const fileInput = useRef<HTMLInputElement>(null)
  const hasFiles = !!uploads && uploads.readyCount > 0

  // 임시 저장 (조금 모아서)
  useEffect(() => {
    const t = window.setTimeout(() => saveDraft(state.key, { text: state.text, mentions: state.mentions }), 300)
    return () => window.clearTimeout(t)
  }, [state])

  const mentionChannel = mentionChannelId ?? channelId
  useEffect(() => {
    if (!mentionChannel) return
    let alive = true
    void participantsOf(mentionChannel).then((ids) => alive && setParticipants(ids))
    return () => {
      alive = false
    }
  }, [mentionChannel])

  const mention = menuClosedAt === caret ? null : activeMention(text, caret)
  const query = mention?.query ?? null

  // 참여자 밖의 사람은 이름으로 검색 (조금 기다렸다가)
  useEffect(() => {
    if (query === null || query.length < 1) {
      setSearchResults([])
      return
    }
    const t = window.setTimeout(() => {
      call('messenger:searchMembers', query)
        .then(setSearchResults)
        .catch(() => setSearchResults([]))
    }, 250)
    return () => window.clearTimeout(t)
  }, [query])

  const candidates = useMemo(() => {
    if (query === null) return []
    const q = query.toLowerCase()
    const seen = new Set<string>()
    const out: { id: string; name: string; email: string | null; here: boolean }[] = []
    for (const id of participants) {
      const n = nameOf(id)
      if (!n || id === me?.id || seen.has(id)) continue
      if (q && !n.toLowerCase().includes(q)) continue
      seen.add(id)
      out.push({ id, name: n, email: null, here: true })
    }
    for (const m of searchResults) {
      if (seen.has(m.id) || m.id === me?.id || !m.name) continue
      seen.add(m.id)
      out.push({ id: m.id, name: m.name, email: m.email, here: false })
    }
    return out.slice(0, 8)
  }, [query, participants, searchResults, nameOf, me?.id])

  useEffect(() => setMenuIndex(0), [query])

  const menuOpen = !!mention && candidates.length > 0

  const insertAt = useCallback(
    (start: number, end: number, insert: string, mentions?: Record<string, string>) => {
      const el = ref.current
      const next = text.slice(0, start) + insert + text.slice(end)
      setText(next, mentions)
      const pos = start + insert.length
      setCaret(pos)
      requestAnimationFrame(() => {
        el?.focus()
        el?.setSelectionRange(pos, pos)
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [text]
  )

  function pickMention(c: { id: string; name: string }) {
    if (!mention) return
    insertAt(mention.start, caret, `@${c.name} `, { ...state.mentions, [c.name]: c.id })
  }

  function applyEdit(ed: Edit) {
    const el = ref.current
    setText(ed.text)
    setCaret(ed.selEnd)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(ed.selStart, ed.selEnd)
    })
  }

  function format(kind: FormatKind) {
    const el = ref.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    applyEdit(applyFormat(text, start, end, kind))
  }

  function insertAtCaret(s: string) {
    const el = ref.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    insertAt(start, end, s)
  }

  async function submit() {
    const t = text.trim()
    if (sending) return
    if (!t) {
      if (hasFiles) uploads!.sendAll()
      return
    }
    const out = applyMentions(closeOpenFence(t), state.mentions, organizationId)
    if (pendingKey && !banner) {
      // 낙관적 전송: 바로 비우고 목록에 "보내는 중" 으로. 글이 먼저, 첨부는 그 다음에 (순서를 지키려고 글이 들어간 뒤 올린다)
      setState({ key, text: '', mentions: {} })
      saveDraft(key, { text: '', mentions: {} })
      const files = hasFiles
      void sendOptimistic(pendingKey, out, onSend).then(() => files && uploads?.sendAll())
      ref.current?.focus()
      return
    }
    setSending(true)
    try {
      // 실제로 남아 있는 @이름 만 멘션으로 바꾼다
      await onSend(out)
      setState({ key, text: '', mentions: {} })
      saveDraft(key, { text: '', mentions: {} })
      if (hasFiles) uploads!.sendAll()
    } catch {
      // 실패하면 입력한 글을 남겨 둔다 (오류 표시는 onSend 쪽에서)
    } finally {
      setSending(false)
      ref.current?.focus()
    }
  }

  const syncCaret = () => setCaret(ref.current?.selectionStart ?? 0)
  const inFence = insideCodeFence(text, caret)
  // 미리보기는 입력보다 늦게 따라와도 된다 (글자를 칠 때마다 마크다운을 다시 그리지 않게)
  const previewText = useDeferredValue(previewOn ? text : '')
  const showPreview = previewOn && /```|`[^`\n]+`/.test(previewText)

  return (
    <div className="composer" ref={rootRef}>
      {banner && (
        <div className="composer-banner">
          <div className="grow">{banner}</div>
          {onCancelBanner && (
            <button className="icon-btn" onClick={onCancelBanner} aria-label="취소">
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      )}
      {menuOpen && (
        <div className="mention-menu" role="listbox" aria-label="멘션할 사람">
          <div className="mention-menu-head muted small">사람 멘션 · ↑↓ 고르기, Enter 넣기, Esc 닫기</div>
          {candidates.map((c, i) => (
            <button
              key={c.id}
              role="option"
              aria-selected={i === menuIndex}
              className={`mention-option ${i === menuIndex ? 'active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                pickMention(c)
              }}
              onMouseEnter={() => setMenuIndex(i)}
            >
              <Avatar memberId={c.id} name={c.name} size={22} />
              <span className="mention-name">{c.name}</span>
              {c.here ? <span className="mention-here">이 대화방</span> : c.email && <span className="muted small ellipsis">{c.email}</span>}
            </button>
          ))}
        </div>
      )}
      {emojiOpen && (
        <EmojiPicker
          onPick={(e) => {
            insertAtCaret(e)
            setEmojiOpen(false)
          }}
          onClose={() => setEmojiOpen(false)}
        />
      )}
      {showPreview && (
        <div className="composer-preview md" aria-label="보낼 메시지 미리보기" dangerouslySetInnerHTML={{ __html: renderMarkdown(closeOpenFence(previewText)) }} />
      )}
      <div className={`composer-box ${disabled ? 'disabled' : ''}`}>
        {uploads && <AttachTray q={uploads} />}
        <textarea
          ref={ref}
          rows={1}
          className={`composer-input ${inFence ? 'in-code' : ''}`}
          spellCheck={!inFence}
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => {
            setText(e.target.value)
            setCaret(e.target.selectionStart ?? e.target.value.length)
            setMenuClosedAt(null)
          }}
          onSelect={syncCaret}
          onClick={syncCaret}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (menuOpen) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                const d = e.key === 'ArrowDown' ? 1 : -1
                setMenuIndex((i) => (i + d + candidates.length) % candidates.length)
                return
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                pickMention(candidates[menuIndex] ?? candidates[0])
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                setMenuClosedAt(caret)
                return
              }
            }
            const fmt = formatShortcut(e)
            if (fmt) {
              e.preventDefault()
              format(fmt)
              return
            }
            if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
              const el = e.currentTarget
              const s0 = el.selectionStart ?? 0
              if (insideCodeFence(text, s0)) {
                e.preventDefault()
                applyEdit(indentCode(text, s0, el.selectionEnd ?? s0, e.shiftKey))
                return
              }
            }
            if (e.key === 'Escape') {
              if (emojiOpen) return setEmojiOpen(false)
              if (onCancelBanner) onCancelBanner()
              return
            }
            if (e.key === 'ArrowUp' && !text && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
              const detail: EditLastDetail = { from: rootRef.current ?? e.currentTarget, handled: false }
              window.dispatchEvent(new CustomEvent(EDIT_LAST_EVENT, { detail }))
              if (detail.handled) e.preventDefault()
              return
            }
            if (e.key === 'Enter') {
              if (e.metaKey || e.ctrlKey) {
                e.preventDefault()
                void submit()
                return
              }
              const pos = e.currentTarget.selectionStart ?? text.length
              const closed = pos === (e.currentTarget.selectionEnd ?? pos) ? autoCloseFence(text, pos) : null
              if (closed) {
                // ```언어 줄에서 Enter: 닫는 ``` 를 미리 넣는다
                e.preventDefault()
                applyEdit(closed)
                return
              }
              if (e.shiftKey) return
              if (insideCodeFence(text, pos)) return // 코드 블록 안: 줄바꿈
              e.preventDefault()
              void submit()
            }
          }}
        />
        <div className="composer-bar" role="toolbar" aria-label="입력 도구">
          {(onAttach || uploads) && (
            <button
              className="icon-btn tip"
              data-tip="사진·파일 첨부 — 한 번에 30개까지 (끌어 놓기·붙여넣기도 됩니다)"
              aria-label="파일 첨부"
              onClick={() => (uploads && !uploads.disabled ? fileInput.current?.click() : void onAttach?.())}
              disabled={disabled || (!!uploads && uploads.disabled && !onAttach)}
            >
              <Icon name="clip" size={16} />
            </button>
          )}
          {uploads && (
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                uploads.add(Array.from(e.target.files ?? []))
                e.target.value = ''
                ref.current?.focus()
              }}
            />
          )}
          {(onAttach || uploads) && <span className="composer-tools-sep" aria-hidden />}
          <button className="icon-btn tip" data-tip="인라인 코드 ⌘⇧C" aria-label="인라인 코드" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => format('inline')}>
            <ChatIcon name="code" size={16} />
          </button>
          <button className="icon-btn tip" data-tip="코드 블록 ⌘⌥C · ```js 처럼 언어를 적으면 색이 입혀집니다" aria-label="코드 블록" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => format('block')}>
            <ChatIcon name="codeBlock" size={16} />
          </button>
          <button className="icon-btn tip" data-tip="링크 ⌘⇧U" aria-label="링크" disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={() => format('link')}>
            <ChatIcon name="link" size={16} />
          </button>
          <span className="composer-tools-sep" aria-hidden />
          <button
            className="icon-btn tip"
            data-tip="사람 멘션 @"
            aria-label="사람 멘션"
            disabled={disabled}
            onClick={() => {
              const el = ref.current
              const pos = el?.selectionStart ?? text.length
              const needSpace = pos > 0 && !/\s/.test(text[pos - 1] ?? '')
              insertAt(pos, el?.selectionEnd ?? pos, needSpace ? ' @' : '@')
              setMenuClosedAt(null)
            }}
          >
            <ChatIcon name="at" size={16} />
          </button>
          <button
            className="icon-btn tip emoji-toggle"
            data-tip="이모지"
            aria-label="이모지"
            aria-expanded={emojiOpen}
            disabled={disabled}
            onClick={() => setEmojiOpen((v) => !v)}
          >
            <ChatIcon name="smile" size={16} />
          </button>
          <button className="icon-btn tip" data-tip="위키 페이지 링크 넣기" aria-label="위키 페이지 링크 넣기" disabled={disabled} onClick={() => setWikiOpen(true)}>
            <ChatIcon name="wiki" size={16} />
          </button>
          <span className="composer-status" aria-live="polite">
            {inFence ? '코드 블록 · Enter 줄바꿈 · Tab 들여쓰기 · ⌘Enter 보내기' : ''}
          </span>
          <button
            className={`icon-btn tip tip-right ${previewOn ? 'on' : ''}`}
            data-tip={previewOn ? '코드 미리보기 끄기' : '코드 미리보기 켜기 (코드가 있을 때 입력창 위에 보낼 모양을 띄웁니다)'}
            aria-label="코드 미리보기"
            aria-pressed={previewOn}
            disabled={disabled}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setPreviewOn(!previewOn)
              savePreviewPref(!previewOn)
            }}
          >
            <ChatIcon name="eye" size={16} />
          </button>
          <button className="send-btn tip tip-right" data-tip="보내기 Enter · 줄바꿈 Shift+Enter" onClick={() => void submit()} disabled={disabled || sending || (!text.trim() && !hasFiles)} aria-label="보내기">
            <Icon name="send" size={15} />
          </button>
        </div>
      </div>
      {wikiOpen && (
        <WikiLinkDialog
          onClose={() => setWikiOpen(false)}
          onPick={(md) => {
            setWikiOpen(false)
            insertAtCaret(md + ' ')
          }}
        />
      )}
    </div>
  )
}
