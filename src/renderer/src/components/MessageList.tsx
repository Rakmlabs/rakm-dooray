import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Message } from '@shared/types'
import { call, errorText } from '../api'
import { useApp, useMemberNames } from '../state'
import { formatDay, formatTime } from '../lib/format'
import { renderMarkdown } from '../lib/markdown'
import { parseTopic } from '../lib/projects'
import { Icon } from './Icon'
import { FileAttachment } from './files/FileAttachment'

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
}

export function MessageList(props: Props) {
  const { messages, meId } = props
  const scroller = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const lastCount = useRef(0)

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

  let lastDay = ''
  let lastSender: string | null = null
  let lastTime = 0

  return (
    <div className="messages" ref={scroller} onScroll={onScroll}>
      {props.canLoadMore && (
        <button className="load-more" onClick={props.onLoadMore}>
          이전 메시지 더 보기
        </button>
      )}
      {!props.canLoadMore && messages.length > 0 && messages.length >= 1000 && (
        <div className="muted center small">두레이 API 제약으로 최신 1000개까지만 볼 수 있습니다.</div>
      )}
      {messages.map((m) => {
        const day = m.sentAt ? formatDay(m.sentAt) : ''
        const showDay = day && day !== lastDay
        const t = m.sentAt ? Date.parse(m.sentAt) : 0
        const grouped = !showDay && lastSender === m.senderId && t - lastTime < 5 * 60 * 1000 && !m.thread
        lastDay = day || lastDay
        lastSender = m.senderId
        lastTime = t
        return (
          <div key={m.id}>
            {showDay && (
              <div className="day-sep">
                <span>{day}</span>
              </div>
            )}
            <MessageItem {...props} m={m} mine={!!meId && m.senderId === meId} grouped={grouped} />
          </div>
        )
      })}
    </div>
  )
}

function MessageItem({
  m,
  mine,
  grouped,
  inThread,
  onReply,
  onOpenThread,
  onStartThread,
  onChanged,
  highlightId
}: Props & { m: Message; mine: boolean; grouped: boolean }) {
  const nameOf = useMemberNames()
  const { toast } = useApp()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.text)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (highlightId === m.id) ref.current?.scrollIntoView({ block: 'center' })
  }, [highlightId, m.id])

  const deleted = m.flags === 'DELETED_ROOT'
  const system = m.senderType && m.senderType !== 'member' && m.senderType !== 'app'
  const sender = m.senderType === 'app' ? '봇' : (nameOf(m.senderId) ?? '…')
  const topic = m.thread ? parseTopic(m.text) : null

  async function saveEdit() {
    if (!draft.trim() || draft === m.text) return setEditing(false)
    setBusy(true)
    try {
      await call('messenger:update', m.channelId, m.id, draft)
      setEditing(false)
      onChanged()
    } catch (e) {
      toast(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!window.confirm('이 메시지를 삭제할까요? 되돌릴 수 없습니다.')) return
    try {
      await call('messenger:delete', m.channelId, m.id)
      onChanged()
    } catch (e) {
      toast(errorText(e))
    }
  }

  if (system) {
    return <div className="msg-system">{m.text}</div>
  }

  return (
    <div
      ref={ref}
      className={`msg ${grouped ? 'grouped' : ''} ${mine ? 'mine' : ''} ${highlightId === m.id ? 'highlight' : ''}`}
    >
      {!grouped && (
        <div className="msg-head">
          <span className="msg-sender">{sender}</span>
          <span className="msg-time">{formatTime(m.sentAt)}</span>
        </div>
      )}
      {editing ? (
        <div className="msg-edit">
          <textarea
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false)
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
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
          </div>
        </div>
      ) : deleted ? (
        <div className="msg-body muted">(삭제된 메시지)</div>
      ) : (
        <>
          {m.type === 'REPLY' && <div className="reply-badge">답장</div>}
          {m.text && <div className="msg-body md" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />}
        </>
      )}
      {m.file && <FileAttachment message={m} />}
      {m.thread && !inThread && (
        <button className="thread-chip" onClick={() => onOpenThread?.(m)}>
          <Icon name="thread" size={14} />
          {topic?.project && <span className="tag">{topic.project}</span>}
          <span>스레드 {m.thread.totalCount}개</span>
          {m.thread.lastUpdatedAt && <span className="muted">· {formatTime(m.thread.lastUpdatedAt)}</span>}
        </button>
      )}
      {!editing && !deleted && (
        <div className="msg-actions" role="toolbar" aria-label="메시지 동작">
          {onReply && (
            <button title="답장" aria-label="답장" onClick={() => onReply(m)}>
              <Icon name="reply" size={15} />
            </button>
          )}
          {!inThread && !m.thread && onStartThread && (
            <button title="이 메시지로 스레드 시작" aria-label="스레드 시작" onClick={() => onStartThread(m)}>
              <Icon name="thread" size={15} />
            </button>
          )}
          {mine && m.type !== 'FILE' && (
            <button
              title="수정"
              aria-label="수정"
              onClick={() => {
                setDraft(m.text)
                setEditing(true)
              }}
            >
              <Icon name="edit" size={15} />
            </button>
          )}
          {mine && (
            <button title="삭제" aria-label="삭제" onClick={() => void remove()}>
              <Icon name="trash" size={15} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
