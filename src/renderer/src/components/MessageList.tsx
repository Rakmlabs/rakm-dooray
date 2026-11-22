import { parseSystem, systemText } from '@shared/system-message'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { Message } from '@shared/types'
import type { ReplyRef } from '@shared/types-chat'
import { call, errorText } from '../api'
import { useApp, useMemberNames } from '../state'
import { formatDay, formatTime } from '../lib/format'
import { firstPreviewUrl, parseWikiUrl, renderMarkdown } from '../lib/markdown'
import { navigate } from '../lib/nav'
import { parseTopic } from '../lib/projects'
import { Icon } from './Icon'
import { FileAttachment } from './files/FileAttachment'
import { Avatar } from './people/Avatar'
import { useProfileCard } from './people/ProfileCard'
import { ChatIcon } from './chat/ChatIcon'
import { closeOpenFence, insideCodeFence } from './chat/composerText'
import { ThreadDeleteDialog, deleteReasonHint, threadDeleteMessage } from './chat/threadActions'
import { LinkPreviewCard } from './chat/LinkPreviewCard'
import { BookmarksPanel } from './chat/BookmarksPanel'
import { WikiSendDialog } from './chat/WikiSendDialog'
import { bookmarkKey, copyText, notePendingReply, plainSummary, useBookmarks, useReplyRefs } from './chat/chatStore'
import { lastSeqBySender, unreadBy } from '@shared/receipts'
import { membersOf, useReceipts } from '../lib/receipts'

interface Props {
  messages: Message[]
  meId: string | null
  /** 메시지 액션. 스레드 안에서는 스레드 관련 액션을 숨긴다 */
  inThread?: boolean
  onReply?: (m: Message) => void
  onOpenThread?: (m: Message) => void
  onStartThread?: (m: Message) => void
  onChanged: () => void
  canLoadMore?: boolean
  onLoadMore?: () => void
  highlightId?: string | null
  /** 이 시각 이후 메시지 앞에 "여기까지 읽음" 구분선 (셸이 넘긴다, 채팅 영역이 그린다) */
  readMarkerAt?: string | null
  /** 스레드 안 목록이면 스레드가 달린 원래 대화방 (북마크에서 다시 찾아갈 때 쓴다) */
  parentChannelId?: string | null
  /** 목록 오른쪽 위 북마크 진입 버튼 (기본: 스레드 밖에서만 보임) */
  showBookmarksEntry?: boolean
}

const NO_IDS: string[] = []

/** 같은 사람이 이 간격 안에 이어 보낸 메시지는 묶는다 */
const GROUP_GAP_MS = 5 * 60 * 1000

/** 입력창(Composer)이 빈 칸에서 ↑ 를 누르면 보내는 이벤트. 같은 영역의 목록이 받아 내 마지막 메시지를 수정 모드로 연다. */
export const EDIT_LAST_EVENT = 'rakm-chat:edit-last'
export interface EditLastDetail {
  from: Element
  handled: boolean
}

/** 마크다운 본문 안의 멘션(프로필 카드)·위키 링크(앱 안 이동) 클릭을 처리한다 */
export function useRichContentClicks(meId: string | null) {
  const card = useProfileCard(meId)
  const onClick = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      const t = e.target as HTMLElement
      const mention = t.closest<HTMLElement>('.mention[data-member-id]')
      if (mention?.dataset.memberId) {
        e.preventDefault()
        card.open(mention.dataset.memberId, mention)
        return
      }
      const a = t.closest<HTMLAnchorElement>('a[href]')
      if (a) {
        const w = parseWikiUrl(a.href)
        if (w) {
          e.preventDefault()
          navigate({ kind: 'wikiPage', ...w })
        }
      }
    },
    [card]
  )
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const t = e.target as HTMLElement
      if ((e.key === 'Enter' || e.key === ' ') && t.matches('.mention[data-member-id]')) {
        e.preventDefault()
        card.open(t.dataset.memberId!, t)
      }
    },
    [card]
  )
  return { onClick, onKeyDown, open: card.open, node: card.node }
}

export function MessageList(props: Props) {
  const { messages, meId, inThread, readMarkerAt } = props
  // 읽음 확인: 내 메시지를 아직 이 앱에서 읽지 않은 사람 (기록이 있는 사람만 센다)
  const receipts = useReceipts()
  const laterBy = useMemo(() => lastSeqBySender(messages), [messages])
  const receiptMembers = membersOf(props.parentChannelId ?? messages[0]?.channelId)
  const { toast } = useApp()
  const scroller = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const lastCount = useRef(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [wikiSend, setWikiSend] = useState<Message | null>(null)
  const [bookmarksOpen, setBookmarksOpen] = useState(false)
  const rich = useRichContentClicks(meId)
  const channelId = messages[0]?.channelId ?? null
  const replyRefs = useReplyRefs(channelId, messages, meId)
  const bookmarks = useBookmarks()
  const bookmarked = useMemo(() => new Set(bookmarks.list.map((b) => b.key)), [bookmarks.list])

  // 새 메시지가 오면, 사용자가 맨 아래를 보고 있을 때만 따라 내려간다
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    if (stickToBottom.current || lastCount.current === 0) el.scrollTop = el.scrollHeight
    lastCount.current = messages.length
  }, [messages])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
  }

  // 빈 입력창에서 ↑ → 내 마지막 메시지 수정
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<EditLastDetail>).detail
      const el = scroller.current
      if (!el || d.handled || !el.parentElement?.contains(d.from)) return
      const last = [...messages].reverse().find((m) => meId && m.senderId === meId && m.type !== 'FILE' && m.flags !== 'DELETED_ROOT' && m.text)
      if (!last) return
      d.handled = true
      setEditingId(last.id)
      el.querySelector(`[data-msg-id="${CSS.escape(last.id)}"]`)?.scrollIntoView({ block: 'nearest' })
    }
    window.addEventListener(EDIT_LAST_EVENT, h)
    return () => window.removeEventListener(EDIT_LAST_EVENT, h)
  }, [messages, meId])

  const jumpTo = useCallback(
    (id: string) => {
      const el = scroller.current?.querySelector(`[data-msg-id="${CSS.escape(id)}"]`)
      if (!el) {
        toast('원 메시지가 지금 불러온 범위에 없습니다. 위로 올려 이전 메시지를 더 불러오세요.', 'info')
        return
      }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setFlashId(id)
      window.setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 1800)
    },
    [toast]
  )

  // "여기까지 읽음": 표시 시각 이후 처음 온 남의 메시지 앞
  const markerId = useMemo(() => {
    if (!readMarkerAt) return null
    const at = Date.parse(readMarkerAt)
    if (Number.isNaN(at)) return null
    const first = messages.find((m) => m.sentAt && Date.parse(m.sentAt) > at && m.senderId !== meId)
    return first?.id ?? null
  }, [messages, readMarkerAt, meId])

  const showEntry = props.showBookmarksEntry ?? !inThread

  let lastDay = ''
  let lastSender: string | null = null
  let lastTime = 0
  let lastHadThread = false

  return (
    <div className="messages" ref={scroller} onScroll={onScroll} onClick={rich.onClick} onKeyDown={rich.onKeyDown}>
      {showEntry && (
        <div className="msgs-tools">
          <button className="msgs-tool-btn" onClick={() => setBookmarksOpen(true)} title="북마크한 메시지 보기">
            <ChatIcon name="bookmark" size={14} />
            북마크{bookmarks.list.length > 0 && <span className="count">{bookmarks.list.length}</span>}
          </button>
        </div>
      )}
      {props.canLoadMore && (
        <button className="load-more" onClick={props.onLoadMore}>
          이전 메시지 더 보기
        </button>
      )}
      {!props.canLoadMore && messages.length > 0 && messages.length >= 1000 && (
        <div className="muted center small">이 컴퓨터에 받아 둔 기록은 여기까지입니다.</div>
      )}
      {messages.map((m) => {
        const day = m.sentAt ? formatDay(m.sentAt) : ''
        const showDay = !!day && day !== lastDay
        const showMarker = m.id === markerId
        const t = m.sentAt ? Date.parse(m.sentAt) : 0
        const system = (!!m.senderType && m.senderType !== 'member' && m.senderType !== 'app') || !!parseSystem(m)
        const grouped =
          !showDay && !showMarker && !system && !lastHadThread && lastSender === m.senderId && t - lastTime < GROUP_GAP_MS && t >= lastTime && m.type !== 'REPLY'
        lastDay = day || lastDay
        lastSender = system ? null : m.senderId
        lastTime = t
        lastHadThread = !!m.thread
        return (
          <div key={m.id}>
            {showDay && (
              <div className="day-sep">
                <span>{day}</span>
              </div>
            )}
            {showMarker && (
              <div className="read-marker" role="separator" aria-label="여기까지 읽음">
                <span>여기까지 읽음</span>
              </div>
            )}
            <MessageItem
              {...props}
              m={m}
              mine={!!meId && m.senderId === meId}
              unreadIds={receipts.enabled && meId && m.senderId === meId ? unreadBy(m, receiptMembers, receipts, laterBy) : NO_IDS}
              grouped={grouped}
              system={system}
              editing={editingId === m.id}
              setEditing={(v) => setEditingId(v ? m.id : null)}
              flash={flashId === m.id}
              replyRef={m.type === 'REPLY' ? (replyRefs.get(m.id) ?? null) : null}
              onJump={jumpTo}
              onOpenProfile={rich.open}
              isBookmarked={bookmarked.has(bookmarkKey(m))}
              onToggleBookmark={async () => {
                try {
                  const on = await bookmarks.toggle(m, inThread ? (props.parentChannelId ?? null) : null)
                  toast(on ? '북마크에 넣었습니다.' : '북마크에서 뺐습니다.', 'info')
                } catch (e) {
                  toast(errorText(e))
                }
              }}
              onSendToWiki={() => setWikiSend(m)}
            />
          </div>
        )
      })}
      {rich.node}
      {wikiSend && <WikiSendDialog messages={[wikiSend]} onClose={() => setWikiSend(null)} />}
      {bookmarksOpen && (
        <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setBookmarksOpen(false)}>
          <DrawerEsc onClose={() => setBookmarksOpen(false)} />
          <BookmarksPanel onClose={() => setBookmarksOpen(false)} channelId={props.parentChannelId ?? channelId ?? undefined} />
        </div>
      )}
    </div>
  )
}

function DrawerEsc({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return null
}

interface ItemProps extends Props {
  m: Message
  mine: boolean
  /** 이 내 메시지를 아직 이 앱에서 읽지 않은 사람 */
  unreadIds: string[]
  grouped: boolean
  system: boolean
  editing: boolean
  setEditing: (v: boolean) => void
  flash: boolean
  replyRef: ReplyRef | null
  onJump: (id: string) => void
  onOpenProfile: (memberId: string, el: Element) => void
  isBookmarked: boolean
  onToggleBookmark: () => void
  onSendToWiki: () => void
}

function clockOf(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

function MessageItem({
  m,
  mine,
  unreadIds,
  grouped,
  system,
  inThread,
  onReply,
  onOpenThread,
  onStartThread,
  onChanged,
  highlightId,
  editing,
  setEditing,
  flash,
  replyRef,
  onJump,
  onOpenProfile,
  isBookmarked,
  onToggleBookmark,
  onSendToWiki
}: ItemProps) {
  const nameOf = useMemberNames()
  const { toast } = useApp()
  const [draft, setDraft] = useState(m.text)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (highlightId === m.id) ref.current?.scrollIntoView({ block: 'center' })
  }, [highlightId, m.id])

  useEffect(() => {
    if (editing) setDraft(m.text)
  }, [editing, m.text])

  const html = useMemo(() => (m.text ? renderMarkdown(m.text) : ''), [m.text])
  const previewUrl = useMemo(() => (m.text ? firstPreviewUrl(m.text) : null), [m.text])

  const deleted = m.flags === 'DELETED_ROOT'
  const isApp = m.senderType === 'app'
  const sender = isApp ? '봇' : (nameOf(m.senderId) ?? '…')
  const topic = m.thread ? parseTopic(m.text) : null

  async function saveEdit() {
    if (!draft.trim() || draft === m.text) return setEditing(false)
    setBusy(true)
    try {
      await call('messenger:update', m.channelId, m.id, closeOpenFence(draft))
      setEditing(false)
      onChanged()
    } catch (e) {
      toast(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const [deletingThread, setDeletingThread] = useState(false)

  async function remove() {
    // 스레드가 달린 메시지: 스레드 안 내 답글까지 같이 지울지 묻는 창으로
    if (m.thread && !inThread) return setDeletingThread(true)
    if (!window.confirm('이 메시지를 삭제할까요? 되돌릴 수 없습니다.')) return
    try {
      await call('messenger:delete', m.channelId, m.id)
      onChanged()
    } catch (e) {
      toast(deleteReasonHint(errorText(e)))
    }
  }

  async function copy() {
    const text = m.text.replace(/\[@([^\]]+)\]\(dooray:\/\/[^)]*\)/g, '@$1')
    const ok = await copyText(text)
    toast(ok ? '메시지를 복사했습니다.' : '복사하지 못했습니다.', ok ? 'info' : 'error')
  }

  if (system) {
    const sys = parseSystem(m)
    return <div className="msg-system">{sys ? systemText(sys, nameOf) : m.text}</div>
  }

  const profileBtn = (el: Element) => m.senderId && !isApp && onOpenProfile(m.senderId, el)

  return (
    <div
      ref={ref}
      data-msg-id={m.id}
      className={`msg ${grouped ? 'grouped' : ''} ${mine ? 'mine' : ''} ${highlightId === m.id || flash ? 'highlight' : ''} ${editing ? 'editing' : ''}`}
    >
      <div className="msg-gutter">
        {grouped ? (
          <span className="msg-hover-time" title={formatTime(m.sentAt)}>
            {clockOf(m.sentAt)}
          </span>
        ) : (
          <button className="avatar-btn" onClick={(e) => profileBtn(e.currentTarget)} aria-label={`${sender} 프로필`} disabled={!m.senderId || isApp}>
            <Avatar memberId={isApp ? null : m.senderId} name={isApp ? '봇' : undefined} size={36} />
          </button>
        )}
      </div>
      <div className="msg-main">
        {!grouped && (
          <div className="msg-head">
            <button className="msg-sender" onClick={(e) => profileBtn(e.currentTarget)} disabled={!m.senderId || isApp}>
              {sender}
            </button>
            <span className="msg-time" title={m.sentAt ? new Date(m.sentAt).toLocaleString('ko-KR') : undefined}>
              {formatTime(m.sentAt)}
            </span>
          </div>
        )}
        {m.type === 'REPLY' && !deleted && <ReplyQuote refInfo={replyRef} onJump={onJump} />}
        {editing ? (
          <div className="msg-edit">
            <textarea
              value={draft}
              className={/```/.test(draft) ? 'has-code' : undefined}
              autoFocus
              onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setEditing(false)
                }
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  // 코드 블록 안에서는 줄바꿈 (⌘Enter 는 저장)
                  if (!e.metaKey && !e.ctrlKey && insideCodeFence(draft, e.currentTarget.selectionStart ?? draft.length)) return
                  e.preventDefault()
                  void saveEdit()
                }
              }}
            />
            <div className="row">
              <button className="primary small" disabled={busy} onClick={() => void saveEdit()}>
                저장
              </button>
              <button className="small" onClick={() => setEditing(false)}>
                취소
              </button>
              <span className="muted small">Enter 저장 · Esc 취소 · 코드 블록 안에서는 ⌘Enter 저장</span>
            </div>
          </div>
        ) : deleted ? (
          <div className="msg-body muted">(삭제된 메시지)</div>
        ) : (
          m.text && <div className="msg-body md" dangerouslySetInnerHTML={{ __html: html }} />
        )}
        {!editing && !deleted && previewUrl && <LinkPreviewCard url={previewUrl} />}
        {m.file && <FileAttachment message={m} />}
        {m.thread && !inThread && (
          <button className="thread-chip" onClick={() => onOpenThread?.(m)}>
            <Icon name="thread" size={14} />
            {topic?.project && <span className="tag">{topic.project}</span>}
            <span>스레드 {m.thread.totalCount}개</span>
            {m.thread.lastUpdatedAt && <span className="muted">· {formatTime(m.thread.lastUpdatedAt)}</span>}
          </button>
        )}
      </div>
      {unreadIds.length > 0 && !deleted && (
        <span
          className="receipt-unread"
          title={`${unreadIds.map((id) => nameOf(id)).join(', ')}님이 이 앱에서 아직 읽지 않음 (두레이 모바일·웹에서 읽은 것은 표시되지 않습니다)`}
          aria-label={`안 읽은 사람 ${unreadIds.length}명`}
        >
          {unreadIds.length}
        </span>
      )}
      {deletingThread && m.thread && (
        <ThreadDeleteDialog
          target={{ threadChannelId: m.thread.channelId, parentChannelId: m.channelId, root: m }}
          meId={m.senderId}
          title={topic?.title ?? ''}
          onClose={() => setDeletingThread(false)}
          onDone={(r) => {
            setDeletingThread(false)
            toast(threadDeleteMessage(r), r.failed ? 'error' : 'info')
            onChanged()
          }}
        />
      )}
      {!editing && !deleted && (
        <div className="msg-actions" role="toolbar" aria-label="메시지 동작">
          {onReply && (
            <button
              title="답장"
              aria-label="답장"
              onClick={() => {
                notePendingReply(m)
                onReply(m)
              }}
            >
              <Icon name="reply" size={15} />
            </button>
          )}
          {!inThread && !m.thread && onStartThread && (
            <button title="스레드로 답하기" aria-label="스레드로 답하기" onClick={() => onStartThread(m)}>
              <Icon name="thread" size={15} />
            </button>
          )}
          <button
            title={isBookmarked ? '북마크 빼기' : '북마크'}
            aria-label={isBookmarked ? '북마크 빼기' : '북마크'}
            aria-pressed={isBookmarked}
            className={isBookmarked ? 'on' : ''}
            onClick={onToggleBookmark}
          >
            <ChatIcon name={isBookmarked ? 'bookmarkFill' : 'bookmark'} size={15} />
          </button>
          <button title="위키로 보내기" aria-label="위키로 보내기" onClick={onSendToWiki}>
            <ChatIcon name="wiki" size={15} />
          </button>
          {m.text && (
            <button title="복사" aria-label="복사" onClick={() => void copy()}>
              <ChatIcon name="copy" size={15} />
            </button>
          )}
          {mine && m.type !== 'FILE' && (
            <button title="수정 (빈 입력창에서 ↑)" aria-label="수정" onClick={() => setEditing(true)}>
              <Icon name="edit" size={15} />
            </button>
          )}
          {mine && (
            <button title="삭제" aria-label="삭제" className="danger" onClick={() => void remove()}>
              <Icon name="trash" size={15} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ReplyQuote({ refInfo, onJump }: { refInfo: ReplyRef | null; onJump: (id: string) => void }) {
  const nameOf = useMemberNames()
  if (!refInfo) {
    return (
      <div className="reply-badge" title="두레이 API 가 원 메시지 정보를 주지 않아, 이 앱에서 보낸 답장만 원문을 보여줍니다.">
        <Icon name="reply" size={12} /> 답장
      </div>
    )
  }
  return (
    <button className="reply-quote" onClick={() => onJump(refInfo.originalId)} title="원 메시지로 이동">
      <span className="reply-quote-who">
        <Avatar memberId={refInfo.originalSenderId} size={16} />
        <b>{nameOf(refInfo.originalSenderId) ?? '…'}</b>
      </span>
      <span className="reply-quote-text">{plainSummary(refInfo.originalText, 140) || '(내용 없음)'}</span>
    </button>
  )
}
