import { useEffect, useState } from 'react'
import type { Message } from '@shared/types'
import { call, errorText } from '../api'
import { useChannelLogs } from '../lib/hooks'
import { useReportSeen } from '../lib/receipts'
import { parseTopic } from '../lib/projects'
import { renderMarkdown } from '../lib/markdown'
import { formatTime } from '../lib/format'
import { useApp, useMemberNames } from '../state'
import { MessageList, useRichContentClicks } from './MessageList'
import { Composer } from './Composer'
import { Icon } from './Icon'
import { Avatar } from './people/Avatar'
import { ChatIcon } from './chat/ChatIcon'
import { FileDropArea } from './files/FileDropArea'
import { ThreadDeleteDialog, ThreadMenu, setThreadHidden, threadDeleteMessage, useHiddenThreads } from './chat/threadActions'

export interface OpenThread {
  threadChannelId: string
  parentChannelId: string
  root: Message | null
  /** root 가 아직 없을 때(방금 만든 스레드) 보여줄 제목 */
  title?: string
  /**
   * true 면 아직 스레드가 없는 root 메시지에서 "스레드로 답하기"를 시작한 상태.
   * threadChannelId 는 비워 두고, 첫 답글을 보낼 때 messenger:threadFromMessage 로 스레드를 만든다.
   */
  startFrom?: boolean
}

/** 스레드는 두레이에서 별도 채널이다. 스레드 채널 ID 로 logs 를 읽고, 같은 ID 로 보내면 스레드에 이어진다. */
export function ThreadPanel({
  thread,
  meId,
  onClose,
  visible = true
}: {
  thread: OpenThread
  meId: string | null
  onClose: () => void
  /** 메신저 화면이 보일 때만 읽은 위치를 알린다 */
  visible?: boolean
}) {
  const { toast } = useApp()
  const nameOf = useMemberNames()
  // "스레드로 답하기"로 연 경우 첫 답글을 보내면 생기는 스레드 채널 ID
  const [createdId, setCreatedId] = useState<string | null>(null)
  useEffect(() => setCreatedId(null), [thread])
  const threadId = thread.threadChannelId || createdId
  const { messages, error, reload, loadMore, canLoadMore } = useChannelLogs(threadId || null, true, 100)
  useReportSeen(threadId || null, messages, visible)
  const topic = parseTopic(thread.root?.text ?? thread.title ?? '')
  const rich = useRichContentClicks(meId)
  const pending = !threadId && !!thread.startFrom && !!thread.root
  const hiddenSet = useHiddenThreads()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [deleting, setDeleting] = useState(false)

  return (
    <aside className="thread-col" aria-label="스레드">
      <div className="pane-head">
        <div className="grow ellipsis">
          {topic.project && <span className="tag">{topic.project}</span>}
          <b>{pending ? '스레드로 답하기' : topic.title || '스레드'}</b>
        </div>
        {!pending && (
          <button className="icon-btn" onClick={() => void reload()} title="새로고침" aria-label="새로고침">
            <Icon name="refresh" size={16} />
          </button>
        )}
        {threadId && (
          <button
            className="icon-btn"
            title="스레드 메뉴 (숨기기·삭제)"
            aria-label="스레드 메뉴"
            aria-haspopup="menu"
            aria-expanded={!!menu}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setMenu({ x: r.right - 180, y: r.bottom + 4 })
            }}
          >
            <ChatIcon name="more" size={16} />
          </button>
        )}
        <button className="icon-btn" onClick={onClose} title="닫기 (Esc)" aria-label="스레드 닫기">
          <Icon name="close" size={16} />
        </button>
      </div>
      {thread.root && (
        <div className="thread-root" onClick={rich.onClick} onKeyDown={rich.onKeyDown}>
          <div className="thread-root-head">
            <button className="avatar-btn" onClick={(e) => thread.root?.senderId && rich.open(thread.root.senderId, e.currentTarget)} aria-label="프로필">
              <Avatar memberId={thread.root.senderId} size={28} />
            </button>
            <span className="msg-sender">{nameOf(thread.root.senderId) ?? '…'}</span>
            <span className="msg-time">{formatTime(thread.root.sentAt)}</span>
          </div>
          <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(thread.root.text) }} />
          {rich.node}
        </div>
      )}
      {error && <div className="banner banner-err">{error}</div>}
      {menu && threadId && (
        <ThreadMenu
          x={menu.x}
          y={menu.y}
          hidden={hiddenSet.has(threadId)}
          onToggleHidden={() => {
            const on = !hiddenSet.has(threadId)
            setThreadHidden(threadId, on)
            toast(on ? '스레드를 목록에서 숨겼습니다. 스레드 탭의 "숨긴 스레드"에서 다시 볼 수 있습니다.' : '숨김을 해제했습니다.', 'info')
          }}
          onDelete={() => setDeleting(true)}
          onClose={() => setMenu(null)}
        />
      )}
      {deleting && threadId && (
        <ThreadDeleteDialog
          target={{ threadChannelId: threadId, parentChannelId: thread.parentChannelId, root: thread.root }}
          meId={meId}
          title={topic.title}
          onClose={() => setDeleting(false)}
          onDone={(r) => {
            setDeleting(false)
            toast(threadDeleteMessage(r), r.failed ? 'error' : 'info')
            if (r.deleted > 0 || r.hidden) onClose()
          }}
        />
      )}
      <FileDropArea channelId={threadId || `pending:${thread.root?.id ?? ''}`} onUploaded={() => void reload()} disabled={!threadId}>
      {pending ? (
        <div className="messages thread-pending">
          <div className="muted small center pad">첫 답글을 보내면 이 메시지에 스레드가 만들어집니다.</div>
        </div>
      ) : (
        <MessageList
          messages={messages}
          meId={meId}
          inThread
          parentChannelId={thread.parentChannelId}
          onChanged={() => void reload()}
          canLoadMore={canLoadMore}
          onLoadMore={loadMore}
        />
      )}
      <Composer
        placeholder={pending ? '스레드에 첫 답글' : '스레드에 답글'}
        autoFocusKey={(threadId || `start:${thread.root?.id ?? ''}`) + (thread.startFrom ? ':s' : '')}
        draftKey={threadId ? `thread:${threadId}` : `thread-start:${thread.root?.id ?? ''}`}
        mentionChannelId={thread.parentChannelId}
        onSend={async (text) => {
          try {
            if (!threadId && thread.root) {
              const r = await call('messenger:threadFromMessage', thread.parentChannelId, thread.root.id, text)
              // 응답에 스레드 채널 ID 가 없으면(원래 방 ID 가 돌아오면) 원래 방에 잘못 보내지 않도록 패널을 닫는다
              if (!r.channelId || r.channelId === thread.parentChannelId) {
                toast('스레드를 만들었습니다. 대화방에서 스레드를 열어 이어서 보세요.', 'info')
                onClose()
                return
              }
              setCreatedId(r.channelId)
              return
            }
            await call('messenger:send', threadId!, text)
            await reload()
          } catch (e) {
            toast(errorText(e))
            throw e
          }
        }}
        onAttach={
          threadId
            ? async () => {
                try {
                  if (await call('messenger:uploadFile', threadId)) await reload()
                } catch (e) {
                  toast(errorText(e))
                }
              }
            : undefined
        }
      />
      </FileDropArea>
    </aside>
  )
}
