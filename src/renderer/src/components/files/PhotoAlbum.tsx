// 파일 영역 소유. 같은 사람이 연달아 보낸 사진 메시지 묶음을 카톡처럼 격자(앨범)로 그린다 (MessageList 가 부른다).
// 칸 크기는 장수로만 정해진다 → 그림이 늦게 떠도 높이가 바뀌지 않아 목록이 튀지 않는다.
// 누르면 뷰어가 이 묶음 안에서 좌우로 넘긴다.
import { memo, useEffect, useMemo, useState } from 'react'
import type { Message } from '@shared/types'
import { fileKind } from '@shared/types-files'
import { itemOf, thumbOf, type FileItem } from './model'
import { openViewer, registerFile } from './viewerStore'

/** 격자에 그리는 최대 칸. 넘으면 마지막 칸에 +N */
const MAX_TILES = 9
/** 묶음으로 볼 간격: 같은 사람이 이 안에 이어 보낸 사진 */
export const ALBUM_GAP_MS = 2 * 60 * 1000

export function isAlbumPhoto(m: Message): boolean {
  return !!m.file && m.flags !== 'DELETED_ROOT' && !m.thread && m.type !== 'REPLY' && fileKind(m.file.name, m.file.mimeType) === 'image'
}

/** 칸 배치: 2장 2열, 3장 3열, 4장 2×2, 그 이상 3열 */
export function albumColumns(n: number): number {
  if (n <= 2) return n
  if (n === 4) return 2
  return 3
}

export const PhotoAlbum = memo(function PhotoAlbum({ messages }: { messages: Message[] }) {
  const items = useMemo(() => messages.map(itemOf).filter((x): x is FileItem => !!x), [messages])
  useEffect(() => {
    const offs = items.map(registerFile)
    return () => offs.forEach((f) => f())
  }, [items])
  const shown = items.slice(0, MAX_TILES)
  const more = items.length - shown.length
  const cols = albumColumns(Math.min(items.length, MAX_TILES))
  return (
    <div className={`album cols-${cols}`} role="group" aria-label={`사진 ${items.length}장`}>
      {shown.map((f, i) => (
        <AlbumTile key={f.messageId} f={f} more={i === shown.length - 1 && more > 0 ? more : 0} onOpen={() => openViewer(items, i)} />
      ))}
    </div>
  )
})

function AlbumTile({ f, more, onOpen }: { f: FileItem; more: number; onOpen: () => void }) {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  return (
    <button className={`album-tile ${state}`} data-msg-id={f.messageId} onClick={onOpen} title={`${f.name} — 눌러서 크게 보기`} aria-label={`${f.name} 크게 보기`}>
      {state !== 'error' && <img src={thumbOf(f)} alt="" loading="lazy" decoding="async" draggable={false} onLoad={() => setState('ok')} onError={() => setState('error')} />}
      {state === 'error' && <span className="album-err">미리보기 없음</span>}
      {more > 0 && <span className="album-more">+{more}</span>}
    </button>
  )
}
