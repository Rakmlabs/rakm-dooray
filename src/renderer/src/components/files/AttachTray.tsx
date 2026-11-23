// 파일 영역 소유. 입력창 안, 보내기 전 첨부 트레이 (Composer 가 그린다).
// 썸네일 줄: 끌어서 순서 바꾸기, × 로 빼기, 실패한 것은 눌러 다시 보내기. 보내는 동안은 위에 진행 막대.
// 메시지 전송과 같은 원칙: 1초 안에 끝나면 진행 표시가 보이지 않는다 (CSS 지연), 상태가 바뀌어도 머리줄·썸네일 크기는 그대로.
// 높이는 고정(줄 하나 + 머리줄)이라 사진 수가 늘어도 입력창이 더 자라지 않는다 (옆으로 스크롤).
import { useState } from 'react'
import { formatSize } from '../../lib/format'
import { FIcon } from './icons'
import { badgeOf, toneOf } from './model'
import { MAX_BATCH, type UploadQueue } from './uploadQueue'

const DRAG_TYPE = 'application/x-rakm-tray'

export function AttachTray({ q }: { q: UploadQueue }) {
  const [dragId, setDragId] = useState<number | null>(null)
  const [overIdx, setOverIdx] = useState<number | null>(null)
  if (q.items.length === 0) return null
  const images = q.items.filter((x) => x.kind === 'image').length
  const others = q.items.length - images
  const bytes = q.items.reduce((s, x) => s + x.file.size, 0)
  const failed = q.items.filter((x) => x.status === 'error').length
  const label = [images ? `사진 ${images}장` : '', others ? `파일 ${others}개` : ''].filter(Boolean).join(' · ')

  return (
    <div className="tray" aria-label="보낼 첨부">
      <div className="tray-head">
        <span className="tray-count">
          {label} · {formatSize(bytes)}
          <span className="muted"> / 최대 {MAX_BATCH}개</span>
        </span>
        {q.progress ? (
          <span className="tray-progress" role="progressbar" aria-valuemin={0} aria-valuemax={q.progress.total} aria-valuenow={q.progress.done}>
            <span className="tray-bar">
              <span style={{ transform: `scaleX(${Math.max(0.04, q.progress.ratio)})` }} />
            </span>
            올리는 중 {q.progress.done}/{q.progress.total}
          </span>
        ) : failed ? (
          <button className="link-like small err" onClick={q.sendAll}>
            실패 {failed}개 다시 보내기
          </button>
        ) : (
          <span className="muted small">Enter 로 보내기 · 끌어서 순서 바꾸기</span>
        )}
        {/* 올리는 동안에도 자리는 남겨 둔다 (머리줄 글자가 옆으로 밀리지 않게) */}
        <button className="link-like small muted" onClick={q.clear} disabled={q.busy} style={q.busy ? { visibility: 'hidden' } : undefined}>
          모두 빼기
        </button>
      </div>
      <ul
        className="tray-strip"
        onDragOver={(e) => {
          if (dragId !== null && e.dataTransfer.types.includes(DRAG_TYPE)) e.preventDefault()
        }}
      >
        {q.items.map((x, i) => {
          const locked = x.status === 'sending' || x.status === 'queued'
          return (
            <li
              key={x.id}
              className={`tray-item st-${x.status} ${x.bad ? 'bad' : ''} ${dragId === x.id ? 'dragging' : ''} ${overIdx === i && dragId !== x.id ? 'drop-before' : ''}`}
              draggable={!locked}
              onDragStart={(e) => {
                e.dataTransfer.setData(DRAG_TYPE, String(x.id))
                e.dataTransfer.effectAllowed = 'move'
                setDragId(x.id)
              }}
              onDragEnter={() => dragId !== null && setOverIdx(i)}
              onDragOver={(e) => {
                if (dragId !== null) e.preventDefault()
              }}
              onDrop={(e) => {
                if (dragId === null) return
                e.preventDefault()
                e.stopPropagation()
                q.move(dragId, i)
                setDragId(null)
                setOverIdx(null)
              }}
              onDragEnd={() => {
                setDragId(null)
                setOverIdx(null)
              }}
              title={`${x.name} · ${formatSize(x.file.size)}${x.bad ? ` — ${x.bad}라 보낼 수 없습니다` : ''}${x.error ? ` — ${x.error}` : ''}`}
            >
              <button
                className="tray-tile"
                aria-label={x.status === 'error' ? `${x.name} 다시 보내기` : x.name}
                onClick={() => x.status === 'error' && q.retry(x.id)}
                onKeyDown={(e) => {
                  if ((e.key === 'Backspace' || e.key === 'Delete') && !locked) {
                    e.preventDefault()
                    q.remove(x.id)
                  } else if ((e.metaKey || e.altKey) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
                    e.preventDefault()
                    q.move(x.id, i + (e.key === 'ArrowLeft' ? -1 : 1))
                  }
                }}
              >
                {x.thumb ? (
                  <img src={x.thumb} alt="" draggable={false} />
                ) : (
                  <span className={`fbadge tone-${toneOf(x.kind)}`}>{badgeOf(x.name)}</span>
                )}
                {x.kind !== 'image' && <span className="tray-name">{x.name}</span>}
                {x.status === 'sending' && <span className="tray-spin" aria-label="올리는 중" />}
                {x.status === 'queued' && <span className="tray-wait" aria-label="차례 기다리는 중" />}
                {x.status === 'error' && (
                  <span className="tray-err" aria-label="실패 — 눌러서 다시 보내기">
                    <FIcon name="rotate" size={16} />
                  </span>
                )}
                {x.bad && <span className="tray-bad">{x.bad}</span>}
              </button>
              {!locked && (
                <button className="tray-x" onClick={() => q.remove(x.id)} aria-label={`${x.name} 빼기`} title="빼기">
                  <FIcon name="close" size={12} />
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
