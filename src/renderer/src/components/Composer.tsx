import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

interface Props {
  placeholder: string
  onSend: (text: string) => Promise<void>
  onAttach?: () => Promise<void>
  banner?: ReactNode
  onCancelBanner?: () => void
  disabled?: boolean
  autoFocusKey?: string
}

/** Enter 전송, Shift+Enter 줄바꿈. 한글 조합 중 Enter 는 무시한다. */
export function Composer({ placeholder, onSend, onAttach, banner, onCancelBanner, disabled, autoFocusKey }: Props) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    ref.current?.focus()
  }, [autoFocusKey])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(200, el.scrollHeight)}px`
  }, [text])

  async function submit() {
    const t = text.trim()
    if (!t || sending) return
    setSending(true)
    try {
      await onSend(t)
      setText('')
    } catch {
      // 실패하면 입력한 글을 남겨 둔다 (오류 표시는 onSend 쪽에서)
    } finally {
      setSending(false)
      ref.current?.focus()
    }
  }

  return (
    <div className="composer">
      {banner && (
        <div className="composer-banner">
          <div className="grow">{banner}</div>
          {onCancelBanner && (
            <button className="icon-btn" onClick={onCancelBanner} aria-label="취소">
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      )}
      <div className="composer-row">
        {onAttach && (
          <button className="icon-btn" title="파일 첨부" aria-label="파일 첨부" onClick={() => void onAttach()} disabled={disabled}>
            <Icon name="clip" />
          </button>
        )}
        <textarea
          ref={ref}
          rows={1}
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && onCancelBanner) onCancelBanner()
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void submit()
            }
          }}
        />
        <button className="send-btn" onClick={() => void submit()} disabled={disabled || sending || !text.trim()} aria-label="보내기">
          <Icon name="send" />
        </button>
      </div>
    </div>
  )
}
