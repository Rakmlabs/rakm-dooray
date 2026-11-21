import type { Message } from '@shared/types'
import { call, errorText } from '../api'
import { useChannelLogs } from '../lib/hooks'
import { parseTopic } from '../lib/projects'
import { renderMarkdown } from '../lib/markdown'
import { formatTime } from '../lib/format'
import { useApp, useMemberNames } from '../state'
import { MessageList } from './MessageList'
import { Composer } from './Composer'
import { Icon } from './Icon'

export interface OpenThread {
  threadChannelId: string
  parentChannelId: string
  root: Message | null
  /** root 가 아직 없을 때(방금 만든 스레드) 보여줄 제목 */
  title?: string
}

/** 스레드는 두레이에서 별도 채널이다. 스레드 채널 ID 로 logs 를 읽고, 같은 ID 로 보내면 스레드에 이어진다. */
export function ThreadPanel({ thread, meId, onClose }: { thread: OpenThread; meId: string | null; onClose: () => void }) {
  const { toast } = useApp()
  const nameOf = useMemberNames()
  const { messages, error, reload, loadMore, canLoadMore } = useChannelLogs(thread.threadChannelId, true, 100)
  const topic = parseTopic(thread.root?.text ?? thread.title ?? '')

  return (
    <aside className="thread-col" aria-label="스레드">
      <div className="pane-head">
        <div className="grow ellipsis">
          {topic.project && <span className="tag">{topic.project}</span>}
          <b>{topic.title || '스레드'}</b>
        </div>
        <button className="icon-btn" onClick={() => void reload()} title="새로고침" aria-label="새로고침">
          <Icon name="refresh" size={16} />
        </button>
        <button className="icon-btn" onClick={onClose} title="닫기 (Esc)" aria-label="스레드 닫기">
          <Icon name="close" size={16} />
        </button>
      </div>
      {thread.root && (
        <div className="thread-root">
          <div className="msg-head">
            <span className="msg-sender">{nameOf(thread.root.senderId) ?? '…'}</span>
            <span className="msg-time">{formatTime(thread.root.sentAt)}</span>
          </div>
          <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(thread.root.text) }} />
        </div>
      )}
      {error && <div className="banner banner-err">{error}</div>}
      <MessageList
        messages={messages}
        meId={meId}
        inThread
        onChanged={() => void reload()}
        canLoadMore={canLoadMore}
        onLoadMore={loadMore}
      />
      <Composer
        placeholder="스레드에 답글"
        autoFocusKey={thread.threadChannelId}
        onSend={async (text) => {
          try {
            await call('messenger:send', thread.threadChannelId, text)
            await reload()
          } catch (e) {
            toast(errorText(e))
            throw e
          }
        }}
        onAttach={async () => {
          try {
            if (await call('messenger:uploadFile', thread.threadChannelId)) await reload()
          } catch (e) {
            toast(errorText(e))
          }
        }}
      />
    </aside>
  )
}
