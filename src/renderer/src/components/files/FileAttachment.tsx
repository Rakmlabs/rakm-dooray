// 파일 영역 소유. 메시지에 붙은 파일 하나를 보여준다 (MessageList 가 부른다). props 는 유지할 것.
// 형식별: 이미지 썸네일 / 동영상 포스터+재생 / 오디오 바로 재생 / 문서 카드(아이콘·이름·크기·열기)
import { useEffect, useMemo, useState } from 'react'
import type { Message } from '@shared/types'
import { call, errorText } from '../../api'
import { useApp } from '../../state'
import { formatSize } from '../../lib/format'
import { FIcon } from './icons'
import { badgeOf, groupOf, itemOf, kindLabel, thumbOf, toneOf, urlOf, viewable, type FileItem } from './model'
import { filesInChannel, openViewer, registerFile } from './viewerStore'

/** 동영상 첫 장면(포스터)을 미리 받아 둘 최대 크기. 더 크면 누를 때만 받는다. */
const POSTER_MAX_BYTES = 30 * 1024 * 1024

export function FileAttachment({ message }: { message: Message }) {
  const f = useMemo(() => itemOf(message), [message])
  useEffect(() => (f ? registerFile(f) : undefined), [f])
  if (!f) return null
  switch (f.kind) {
    case 'image':
      return <ImageThumb f={f} />
    case 'video':
      return <VideoCard f={f} />
    case 'audio':
      return <AudioCard f={f} />
    default:
      return <DocCard f={f} />
  }
}

/** 같은 방, 같은 묶음(사진/미디어/문서)의 파일들 사이에서 뷰어를 연다 */
export function openInChannel(f: FileItem): void {
  const g = groupOf(f.kind)
  const list = filesInChannel(f.channelId).filter((x) => groupOf(x.kind) === g)
  const i = list.findIndex((x) => x.messageId === f.messageId)
  if (i < 0) openViewer([f], 0)
  else openViewer(list, i)
}

function ImageThumb({ f }: { f: FileItem }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [retry, setRetry] = useState(0)
  if (state === 'error') {
    return <DocCard f={f} note="미리보기를 불러오지 못했습니다" onRetry={() => (setRetry((n) => n + 1), setState('loading'))} />
  }
  return (
    <button
      className={`fa-thumb ${state === 'loading' ? 'loading' : ''}`}
      onClick={() => openInChannel(f)}
      title={`${f.name}${f.size !== null ? ` · ${formatSize(f.size)}` : ''} — 눌러서 크게 보기`}
      aria-label={`${f.name} 크게 보기`}
    >
      <img
        key={retry}
        src={thumbOf(f) + (retry ? `&r=${retry}` : '')}
        alt={f.name}
        loading="lazy"
        draggable={false}
        onLoad={() => setState('ok')}
        onError={() => setState('error')}
      />
      {state === 'loading' && <span className="fa-skeleton" aria-hidden />}
    </button>
  )
}

function VideoCard({ f }: { f: FileItem }) {
  const [poster, setPoster] = useState(f.size !== null && f.size <= POSTER_MAX_BYTES)
  useEffect(() => {
    if (poster) return
    // 큰 파일이라도 이미 캐시에 있으면 첫 장면을 보여준다
    let live = true
    call('files:cached', f.channelId, [f.fileId])
      .then((ids) => live && ids.length > 0 && setPoster(true))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [f, poster])
  return (
    <button className="fa-video" onClick={() => openInChannel(f)} aria-label={`${f.name} 재생`} title={`${f.name} — 눌러서 재생`}>
      {poster && <video src={`${urlOf(f)}#t=0.5`} preload="metadata" muted playsInline tabIndex={-1} aria-hidden />}
      <span className="fa-play" aria-hidden>
        <FIcon name="play" size={22} />
      </span>
      <span className="fa-video-meta">
        <span className="ellipsis">{f.name}</span>
        {f.size !== null && <span>{formatSize(f.size)}</span>}
      </span>
    </button>
  )
}

function AudioCard({ f }: { f: FileItem }) {
  const [on, setOn] = useState(false)
  return (
    <div className="fa-card fa-audio">
      <span className={`fbadge tone-${toneOf(f.kind)}`} aria-hidden>
        <FIcon name="music" size={16} />
      </span>
      <div className="fa-info">
        <button className="fa-name link-like" onClick={() => openInChannel(f)} title="크게 열기">
          {f.name}
        </button>
        {on ? (
          // 누를 때만 받는다 (preload 없음)
          <audio src={urlOf(f)} controls autoPlay preload="none" />
        ) : (
          <span className="muted small">
            {kindLabel(f.kind)}
            {f.size !== null && ` · ${formatSize(f.size)}`}
          </span>
        )}
      </div>
      {!on && (
        <button className="small" onClick={() => setOn(true)}>
          <FIcon name="play" size={12} /> 재생
        </button>
      )}
      <SaveButton f={f} />
    </div>
  )
}

function DocCard({ f, note, onRetry }: { f: FileItem; note?: string; onRetry?: () => void }) {
  const canView = viewable(f.kind)
  return (
    <div className="fa-card">
      <span className={`fbadge tone-${toneOf(f.kind)}`} aria-hidden>
        {badgeOf(f.name)}
      </span>
      <div className="fa-info">
        <button className="fa-name link-like" onClick={() => openInChannel(f)} title={canView ? '앱 안에서 열기' : '열 방법 고르기'}>
          {f.name}
        </button>
        <span className="muted small">
          {note ?? kindLabel(f.kind)}
          {f.size !== null && ` · ${formatSize(f.size)}`}
        </span>
      </div>
      {onRetry ? (
        <button className="small" onClick={onRetry}>
          다시 시도
        </button>
      ) : (
        <button className="small" onClick={() => openInChannel(f)}>
          열기
        </button>
      )}
      <SaveButton f={f} />
    </div>
  )
}

function SaveButton({ f }: { f: FileItem }) {
  const { toast } = useApp()
  async function save() {
    try {
      const saved = await call('files:save', f.channelId, f.fileId, f.name)
      if (saved) toast(`저장했습니다: ${saved}`, 'info')
    } catch (e) {
      toast(errorText(e))
    }
  }
  return (
    <button className="icon-btn" onClick={() => void save()} title="내려받기" aria-label={`${f.name} 내려받기`}>
      <FIcon name="download" size={16} />
    </button>
  )
}
