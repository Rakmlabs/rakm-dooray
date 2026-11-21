// 파일 영역 소유. 방별 "파일 모아보기" (사진/동영상/문서). Messenger 의 대화방 머리글 버튼이 연다. props 는 유지할 것.
import { useMemo, useState } from 'react'
import type { Message } from '@shared/types'
import { formatSize, formatTime } from '../../lib/format'
import { Modal } from '../Modal'
import { FIcon } from './icons'
import { badgeOf, groupOf, itemOf, kindLabel, thumbOf, toneOf, type FileGroup, type FileItem } from './model'
import { openViewer } from './viewerStore'

const TABS: { id: FileGroup; label: string }[] = [
  { id: 'photo', label: '사진' },
  { id: 'media', label: '동영상·오디오' },
  { id: 'doc', label: '문서·기타' }
]

export function FileGallery({ messages, onClose }: { channelId: string; messages: Message[]; onClose: () => void }) {
  // 새 것이 먼저
  const all = useMemo(
    () =>
      messages
        .map(itemOf)
        .filter((f): f is FileItem => !!f)
        .sort((a, b) => b.seq - a.seq),
    [messages]
  )
  const by = useMemo(() => {
    const m: Record<FileGroup, FileItem[]> = { photo: [], media: [], doc: [] }
    for (const f of all) m[groupOf(f.kind)].push(f)
    return m
  }, [all])
  const [tab, setTab] = useState<FileGroup>(() => (by.photo.length ? 'photo' : by.media.length ? 'media' : 'doc'))
  const list = by[tab]

  return (
    <Modal title="파일 모아보기" onClose={onClose} wide>
      <div className="fg">
        <div className="fg-head">
          <div className="tabs" role="tablist">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
                {t.label} <span className="count">{by[t.id].length}</span>
              </button>
            ))}
          </div>
          <span className="muted small">지금 불러온 최근 메시지에서 모았습니다.</span>
        </div>
        {list.length === 0 ? (
          <div className="fg-empty muted">
            <FIcon name={tab === 'photo' ? 'image' : tab === 'media' ? 'video' : 'file'} size={28} />
            <span>{tab === 'photo' ? '사진이' : tab === 'media' ? '동영상·오디오가' : '문서가'} 없습니다.</span>
          </div>
        ) : tab === 'photo' ? (
          <div className="fg-grid">
            {list.map((f, i) => (
              <button key={f.messageId} className="fg-photo" onClick={() => openViewer(list, i)} title={f.name} aria-label={`${f.name} 크게 보기`}>
                <img src={thumbOf(f)} alt={f.name} loading="lazy" draggable={false} />
              </button>
            ))}
          </div>
        ) : (
          <ul className="fg-list">
            {list.map((f, i) => (
              <li key={f.messageId}>
                <button className="fg-row" onClick={() => openViewer(list, i)}>
                  <span className={`fbadge tone-${toneOf(f.kind)}`}>
                    {f.kind === 'video' ? <FIcon name="video" size={15} /> : f.kind === 'audio' ? <FIcon name="music" size={15} /> : badgeOf(f.name)}
                  </span>
                  <span className="fg-name ellipsis">{f.name}</span>
                  <span className="muted small">{kindLabel(f.kind)}</span>
                  <span className="muted small fg-size">{f.size !== null ? formatSize(f.size) : ''}</span>
                  <span className="muted small fg-date">{formatTime(f.sentAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
