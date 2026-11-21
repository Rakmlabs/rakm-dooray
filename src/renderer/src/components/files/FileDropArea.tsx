// 파일 영역 소유. 대화방 본문(메시지 목록+입력창)을 감싸 드래그 앤 드롭·붙여넣기 업로드를 받는다 (Messenger 의 ChannelPane 이 감싼다).
// props 는 유지할 것. 감싸는 div 는 세로 flex 를 그대로 이어받아 레이아웃을 바꾸지 않는다 (.fdrop).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { UPLOAD_MAX_BYTES, fileKind, mimeFromName } from '@shared/types-files'
import { call, errorText } from '../../api'
import { formatSize } from '../../lib/format'
import { Modal } from '../Modal'
import { FIcon } from './icons'
import { badgeOf, kindLabel, toneOf } from './model'

interface Pending {
  id: number
  file: File
  name: string
  preview: string | null
  status: 'ready' | 'sending' | 'done' | 'error'
  error?: string
}

let seq = 0

/** 붙여넣은 스크린샷은 이름이 image.png 하나뿐이라 시각을 붙인다 */
function nameFor(file: File, pasted: boolean): string {
  if (pasted && (/^image\.(png|jpe?g|gif|webp)$/i.test(file.name) || !file.name)) {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
    return `스크린샷 ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}.${ext}`
  }
  return file.name || '파일'
}

export function FileDropArea({ channelId, onUploaded, children }: { channelId: string; onUploaded: () => void; children: ReactNode }) {
  const [items, setItems] = useState<Pending[]>([])
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  function add(files: File[], pasted: boolean) {
    if (files.length === 0) return
    setItems((cur) => [
      ...cur,
      ...files.map((file) => ({
        id: ++seq,
        file,
        name: nameFor(file, pasted),
        preview: file.type.startsWith('image/') && file.size < 40 * 1024 * 1024 ? URL.createObjectURL(file) : null,
        status: 'ready' as const
      }))
    ])
  }

  // 방을 옮기면 올리려던 목록은 버린다
  useEffect(() => () => setItems([]), [channelId])

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

  return (
    <div
      className={`fdrop ${over ? 'over' : ''}`}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        depth.current++
        setOver(true)
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setOver(false)
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return
        e.preventDefault()
        depth.current = 0
        setOver(false)
        add(Array.from(e.dataTransfer.files), false)
      }}
      onPaste={(e) => {
        const files = Array.from(e.clipboardData.files)
        if (files.length === 0) return // 글자 붙여넣기는 그대로
        e.preventDefault()
        add(files, true)
      }}
    >
      {children}
      {over && (
        <div className="fdrop-hint" aria-hidden>
          <div>
            <FIcon name="upload" size={28} />
            <b>여기에 놓으면 이 대화방에 올립니다</b>
            <span>올리기 전에 한 번 더 확인합니다</span>
          </div>
        </div>
      )}
      {items.length > 0 && (
        <UploadDialog
          channelId={channelId}
          items={items}
          setItems={setItems}
          onDone={(sent) => {
            if (sent > 0) onUploaded()
          }}
        />
      )}
    </div>
  )
}

function UploadDialog({
  channelId,
  items,
  setItems,
  onDone
}: {
  channelId: string
  items: Pending[]
  setItems: React.Dispatch<React.SetStateAction<Pending[]>>
  onDone: (sent: number) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tooBig = (p: Pending) => p.file.size > UPLOAD_MAX_BYTES
  const empty = (p: Pending) => p.file.size === 0
  const sendable = items.filter((p) => p.status !== 'done' && !tooBig(p) && !empty(p))

  function close() {
    if (busy) return
    for (const p of items) if (p.preview) URL.revokeObjectURL(p.preview)
    setItems([])
  }
  function remove(id: number) {
    setItems((cur) => {
      const p = cur.find((x) => x.id === id)
      if (p?.preview) URL.revokeObjectURL(p.preview)
      return cur.filter((x) => x.id !== id)
    })
  }

  async function send() {
    setBusy(true)
    setError(null)
    let sent = 0
    for (const p of sendable) {
      setItems((cur) => cur.map((x) => (x.id === p.id ? { ...x, status: 'sending' } : x)))
      try {
        const bytes = new Uint8Array(await p.file.arrayBuffer())
        const mime = p.file.type || mimeFromName(p.name)
        await call('files:upload', channelId, p.name, mime, bytes)
        sent++
        setItems((cur) => cur.map((x) => (x.id === p.id ? { ...x, status: 'done' } : x)))
      } catch (e) {
        setItems((cur) => cur.map((x) => (x.id === p.id ? { ...x, status: 'error', error: errorText(e) } : x)))
        setError(`${p.name} 을(를) 올리지 못했습니다. 나머지는 멈췄습니다.`)
        break
      }
    }
    setBusy(false)
    onDone(sent)
    // 전부 올렸으면 닫는다
    setItems((cur) => {
      if (cur.every((x) => x.status === 'done' || tooBig(x) || empty(x))) {
        for (const x of cur) if (x.preview) URL.revokeObjectURL(x.preview)
        return []
      }
      return cur.filter((x) => x.status !== 'done')
    })
  }

  const total = sendable.reduce((s, p) => s + p.file.size, 0)
  return (
    <Modal title="파일 올리기" onClose={close}>
      <div
        className="up"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !busy && sendable.length > 0) {
            e.preventDefault()
            void send()
          }
        }}
      >
        <ul className="up-list">
          {items.map((p) => {
            const kind = fileKind(p.name, p.file.type)
            const bad = tooBig(p) ? `${Math.round(UPLOAD_MAX_BYTES / 1024 / 1024)}MB 를 넘어 올릴 수 없습니다` : empty(p) ? '빈 파일입니다' : null
            return (
              <li key={p.id} className={`up-item ${bad || p.status === 'error' ? 'bad' : ''}`}>
                {p.preview ? (
                  <img className="up-thumb" src={p.preview} alt="" />
                ) : (
                  <span className={`fbadge big tone-${toneOf(kind)}`}>{badgeOf(p.name)}</span>
                )}
                <div className="up-info">
                  <b className="ellipsis" title={p.name}>
                    {p.name}
                  </b>
                  <span className="small muted">
                    {kindLabel(kind)} · {formatSize(p.file.size)}
                    {p.status === 'sending' && ' · 올리는 중…'}
                    {p.status === 'done' && ' · 올림'}
                  </span>
                  {(bad || p.error) && <span className="small err">{bad ?? p.error}</span>}
                </div>
                <button className="icon-btn" onClick={() => remove(p.id)} disabled={busy} title="빼기" aria-label={`${p.name} 빼기`}>
                  <FIcon name="close" size={16} />
                </button>
              </li>
            )
          })}
        </ul>
        {error && <div className="banner banner-err">{error}</div>}
        <div className="up-foot">
          <span className="muted small grow">
            {sendable.length}개 · {formatSize(total)} · 한 파일 최대 {Math.round(UPLOAD_MAX_BYTES / 1024 / 1024)}MB
          </span>
          <button onClick={close} disabled={busy}>
            취소
          </button>
          <button className="primary" onClick={() => void send()} disabled={busy || sendable.length === 0} autoFocus>
            {busy ? '올리는 중…' : `보내기 (${sendable.length})`}
          </button>
        </div>
      </div>
    </Modal>
  )
}
