import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Member } from '@shared/types'
import { call } from '../api'
import { useMemberNames } from '../state'
import { Icon } from './Icon'
import { Avatar } from './people/Avatar'
import { ChatIcon } from './chat/ChatIcon'
import { EmojiPicker } from './chat/EmojiPicker'
import { WikiLinkDialog } from './chat/WikiLinkDialog'
import { useOrganizationId, useProfile } from './chat/chatStore'
import { activeMention, applyMentions, insideCodeFence } from './chat/composerText'
import { EDIT_LAST_EVENT, type EditLastDetail } from './MessageList'

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

/** Enter 전송, Shift+Enter 줄바꿈 (코드 블록 안에서는 Enter 도 줄바꿈, ⌘/Ctrl+Enter 는 항상 전송). 한글 조합 중 Enter 는 무시한다. */
export function Composer({
  placeholder,
  onSend,
  onAttach,
  banner,
  onCancelBanner,
  disabled,
  autoFocusKey,
  channelId,
  draftKey,
  mentionChannelId
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

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(200, el.scrollHeight)}px`
  }, [text])

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

  function insertAtCaret(s: string) {
    const el = ref.current
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    insertAt(start, end, s)
  }

  async function submit() {
    const t = text.trim()
    if (!t || sending) return
    setSending(true)
    try {
      // 실제로 남아 있는 @이름 만 멘션으로 바꾼다
      await onSend(applyMentions(t, state.mentions, organizationId))
      setState({ key, text: '', mentions: {} })
      saveDraft(key, { text: '', mentions: {} })
    } catch {
      // 실패하면 입력한 글을 남겨 둔다 (오류 표시는 onSend 쪽에서)
    } finally {
      setSending(false)
      ref.current?.focus()
    }
  }

  const syncCaret = () => setCaret(ref.current?.selectionStart ?? 0)

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
      <div className="composer-row">
        {onAttach && (
          <button className="icon-btn" title="파일 첨부" aria-label="파일 첨부" onClick={() => void onAttach()} disabled={disabled}>
            <Icon name="clip" />
          </button>
        )}
        <textarea
          ref={ref}
          rows={1}
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
              if (e.shiftKey) return
              const pos = e.currentTarget.selectionStart ?? text.length
              if (insideCodeFence(text, pos)) return // 코드 블록 안: 줄바꿈
              e.preventDefault()
              void submit()
            }
          }}
        />
        <div className="composer-tools">
          <button
            className="icon-btn"
            title="사람 멘션 (@)"
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
            <ChatIcon name="at" size={17} />
          </button>
          <button
            className="icon-btn emoji-toggle"
            title="이모지"
            aria-label="이모지"
            aria-expanded={emojiOpen}
            disabled={disabled}
            onClick={() => setEmojiOpen((v) => !v)}
          >
            <ChatIcon name="smile" size={17} />
          </button>
          <button className="icon-btn" title="위키 페이지 링크 넣기" aria-label="위키 페이지 링크 넣기" disabled={disabled} onClick={() => setWikiOpen(true)}>
            <ChatIcon name="wiki" size={17} />
          </button>
        </div>
        <button className="send-btn" onClick={() => void submit()} disabled={disabled || sending || !text.trim()} aria-label="보내기" title="보내기 (Enter)">
          <Icon name="send" />
        </button>
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
