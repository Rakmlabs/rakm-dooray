// 북마크한 메시지 목록 (이 컴퓨터에만 저장). 셸이 원하는 곳에 <BookmarksPanel onClose /> 로 붙인다.
import { useMemo, useState } from 'react'
import { useMemberNames } from '../../state'
import { formatTime } from '../../lib/format'
import { navigate } from '../../lib/nav'
import { nameColorClass } from '../people/nameColor'
import { ChatIcon } from './ChatIcon'
import { plainSummary, useBookmarks } from './chatStore'

export function BookmarksPanel({ onClose, channelId }: { onClose: () => void; /** 주면 이 대화방 것만 먼저 거른다 */ channelId?: string }) {
  const { list, remove } = useBookmarks()
  const nameOf = useMemberNames()
  const [q, setQ] = useState('')
  const [onlyHere, setOnlyHere] = useState(!!channelId)
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return list.filter(
      (b) =>
        (!onlyHere || !channelId || b.channelId === channelId || b.parentChannelId === channelId) &&
        (!t || b.text.toLowerCase().includes(t) || (nameOf(b.senderId) ?? '').toLowerCase().includes(t))
    )
  }, [list, q, onlyHere, channelId, nameOf])

  return (
    <aside className="bookmarks-panel" aria-label="북마크">
      <div className="pane-head">
        <div className="grow">
          <b>북마크</b> <span className="muted small">{list.length}개 · 이 컴퓨터에만 저장</span>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="북마크 닫기" title="닫기 (Esc)">
          ✕
        </button>
      </div>
      <div className="bookmarks-tools">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="북마크에서 찾기" aria-label="북마크에서 찾기" />
        {channelId && (
          <label className="check-inline">
            <input type="checkbox" checked={onlyHere} onChange={(e) => setOnlyHere(e.target.checked)} /> 이 대화방만
          </label>
        )}
      </div>
      <div className="bookmarks-list">
        {shown.length === 0 && (
          <div className="empty-note">
            <ChatIcon name="bookmark" size={22} />
            <p>{list.length === 0 ? '메시지에 마우스를 올리고 북마크 버튼을 누르면 여기에 모입니다.' : '찾는 북마크가 없습니다.'}</p>
          </div>
        )}
        {shown.map((b) => (
          <div key={b.key} className="bookmark-row">
            <button
              className="bookmark-open"
              onClick={() => {
                if (b.parentChannelId) navigate({ kind: 'thread', channelId: b.parentChannelId, threadChannelId: b.channelId })
                else navigate({ kind: 'channel', channelId: b.channelId, messageId: b.messageId })
              }}
              title="이 메시지로 가기"
            >
              <span className="bookmark-main">
                <span className="bookmark-meta">
                  <b className={nameColorClass(b.senderId)}>{nameOf(b.senderId) ?? '…'}</b>
                  <span className="muted small">{formatTime(b.sentAt)}</span>
                  {b.parentChannelId && <span className="tag small-tag">스레드</span>}
                </span>
                <span className="bookmark-text">{plainSummary(b.text, 160) || '(내용 없음)'}</span>
              </span>
            </button>
            <button className="icon-btn bookmark-remove" aria-label="북마크 빼기" title="북마크 빼기" onClick={() => void remove(b.key)}>
              <ChatIcon name="bookmarkFill" size={15} />
            </button>
          </div>
        ))}
      </div>
    </aside>
  )
}
