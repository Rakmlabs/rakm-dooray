// 파일 영역 소유. 대화방 본문(메시지 목록+입력창)을 감싸 드래그 앤 드롭·붙여넣기 업로드를 받는다 (Messenger 의 ChannelPane 이 감싼다).
// props 는 유지할 것. 감싸는 div 는 세로 flex 를 그대로 이어받아 레이아웃을 바꾸지 않는다 (.fdrop).
import { useRef, useState, type ReactNode } from 'react'
import { useApp } from '../../state'
import { FIcon } from './icons'
import { MAX_BATCH, UploadQueueProvider, useUploadQueueState } from './uploadQueue'

export function FileDropArea({
  channelId,
  onUploaded,
  children,
  disabled
}: {
  channelId: string
  onUploaded: () => void
  children: ReactNode
  /** 아직 올릴 곳이 없을 때 (첫 답글 전의 스레드) */
  disabled?: boolean
}) {
  const { toast } = useApp()
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  // 보내기 전 첨부는 입력창 안 트레이에 모인다 (Composer 가 그린다). 여기서는 끌어 놓기·붙여넣기를 받아 넣기만 한다
  const queue = useUploadQueueState({ channelId, disabled: !!disabled, onUploaded, onNotice: toast })
  const add = queue.add

  const hasFiles = (e: React.DragEvent) => !disabled && Array.from(e.dataTransfer.types).includes('Files')

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
        if (files.length === 0 || disabled) return // 글자 붙여넣기는 그대로
        e.preventDefault()
        add(files, true)
      }}
    >
      <UploadQueueProvider value={queue}>{children}</UploadQueueProvider>
      {over && (
        <div className="fdrop-hint" aria-hidden>
          <div>
            <FIcon name="upload" size={28} />
            <b>여기에 놓으면 입력창에 첨부합니다</b>
            <span>보내기 전에 순서를 바꾸거나 뺄 수 있습니다 · 한 번에 {MAX_BATCH}개까지</span>
          </div>
        </div>
      )}
    </div>
  )
}
