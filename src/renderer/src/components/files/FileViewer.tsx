// 앱 안 파일 뷰어 (전체 화면 겹침). 형식별 보기는 viewers/ 에 있고 필요할 때만 불러온다.
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { call, errorText } from '../../api'
import { formatSize, formatTime } from '../../lib/format'
import type { OpenHow } from '@shared/ipc-files'
import { FIcon } from './icons'
import { badgeOf, isMac, kindLabel, toneOf, type FileItem } from './model'
import { closeViewer, moveViewer, useViewerState } from './viewerStore'
import { ImageView } from './viewers/ImageView'
import { MediaView } from './viewers/MediaView'
import { Loading } from './viewers/common'

const PdfView = lazy(() => import('./viewers/PdfView'))
const DocxView = lazy(() => import('./viewers/DocxView'))
const XlsxView = lazy(() => import('./viewers/XlsxView'))
const PptxView = lazy(() => import('./viewers/PptxView'))
const HwpView = lazy(() => import('./viewers/HwpView'))
const TextView = lazy(() => import('./viewers/TextView'))

export function ViewerHost() {
  const s = useViewerState()
  if (!s) return null
  return <FileViewer items={s.items} index={s.index} />
}

/** 파일 저장·외부로 열기 (뷰어·대체 화면 공용) */
export async function fileAction(f: FileItem, how: 'save' | OpenHow): Promise<string | null> {
  if (how === 'save') {
    const saved = await call('files:save', f.channelId, f.fileId, f.name)
    return saved ? `저장했습니다: ${saved}` : null
  }
  await call('files:open', f.channelId, f.fileId, f.name, how)
  return null
}

function FileViewer({ items, index }: { items: FileItem[]; index: number }) {
  const f = items[index]
  const [note, setNote] = useState<{ text: string; err: boolean } | null>(null)

  useEffect(() => {
    // 대화방·모아보기 창의 Esc 보다 먼저 받는다 (캡처 단계)
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeViewer()
      } else if (!typing && e.key === 'ArrowLeft' && !e.metaKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        moveViewer(-1)
      } else if (!typing && e.key === 'ArrowRight' && !e.metaKey && !e.altKey) {
        e.preventDefault()
        e.stopPropagation()
        moveViewer(1)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => setNote(null), [f])

  async function run(how: 'save' | OpenHow) {
    try {
      const msg = await fileAction(f, how)
      if (msg) setNote({ text: msg, err: false })
    } catch (e) {
      setNote({ text: errorText(e), err: true })
    }
  }

  const multi = items.length > 1
  // 사진·동영상은 화면 양옆에도 넘김 단추를 둔다 (문서는 내용을 가리지 않게 머리글에만)
  const sideNav = multi && (f.kind === 'image' || f.kind === 'video' || f.kind === 'audio')
  return (
    <div className="fv" role="dialog" aria-modal="true" aria-label={`${f.name} 보기`}>
      <div className="fv-head">
        <span className={`fbadge tone-${toneOf(f.kind)}`}>{badgeOf(f.name)}</span>
        <div className="fv-title">
          <b className="ellipsis" title={f.name}>
            {f.name}
          </b>
          <span className="muted small">
            {kindLabel(f.kind)}
            {f.size !== null && ` · ${formatSize(f.size)}`}
            {f.sentAt && ` · ${formatTime(f.sentAt)}`}
          </span>
        </div>
        <div className="fv-actions">
          {multi && (
            <div className="fv-pager" role="group" aria-label="파일 넘기기">
              <button className="fv-btn icon" onClick={() => moveViewer(-1)} disabled={index === 0} title="이전 파일 (←)" aria-label="이전 파일">
                <FIcon name="prev" />
              </button>
              <span className="small muted">
                {index + 1} / {items.length}
              </span>
              <button className="fv-btn icon" onClick={() => moveViewer(1)} disabled={index === items.length - 1} title="다음 파일 (→)" aria-label="다음 파일">
                <FIcon name="next" />
              </button>
            </div>
          )}
          <button className="fv-btn" onClick={() => void run('save')} title="내 컴퓨터에 저장">
            <FIcon name="download" /> 저장
          </button>
          <button className="fv-btn" onClick={() => void run('default')} title="이 컴퓨터의 기본 앱으로 열기">
            <FIcon name="external" /> 기본 앱
          </button>
          {isMac && (
            <button className="fv-btn" onClick={() => void run('quicklook')} title="macOS 미리보기(Quick Look)로 열기">
              <FIcon name="eye" /> 미리보기
            </button>
          )}
          <button className="fv-btn icon" onClick={closeViewer} title="닫기 (Esc)" aria-label="닫기">
            <FIcon name="close" size={18} />
          </button>
        </div>
      </div>
      {note && <div className={`fv-note ${note.err ? 'err' : ''}`}>{note.text}</div>}
      <div className="fv-body">
        {sideNav && index > 0 && (
          <button className="fv-nav prev" onClick={() => moveViewer(-1)} title="이전 (←)" aria-label="이전 파일">
            <FIcon name="prev" size={22} />
          </button>
        )}
        <Suspense fallback={<Loading />}>
          <Body key={`${f.channelId}/${f.fileId}`} f={f} onAction={(how) => void run(how)} />
        </Suspense>
        {sideNav && index < items.length - 1 && (
          <button className="fv-nav next" onClick={() => moveViewer(1)} title="다음 (→)" aria-label="다음 파일">
            <FIcon name="next" size={22} />
          </button>
        )}
      </div>
    </div>
  )
}

function Body({ f, onAction }: { f: FileItem; onAction: (how: 'save' | OpenHow) => void }): ReactNode {
  switch (f.kind) {
    case 'image':
      return <ImageView f={f} />
    case 'video':
    case 'audio':
      return <MediaView f={f} fallback={(r) => <Fallback f={f} onAction={onAction} reason={r} />} />
    case 'pdf':
      return <PdfView f={f} fallback={(r) => <Fallback f={f} onAction={onAction} reason={r} />} />
    case 'docx':
      return <DocxView f={f} fallback={(r) => <Fallback f={f} onAction={onAction} reason={r} />} />
    case 'xlsx':
      return <XlsxView f={f} fallback={(r) => <Fallback f={f} onAction={onAction} reason={r} />} />
    case 'pptx':
      return <PptxView f={f} fallback={(r) => <Fallback f={f} onAction={onAction} reason={r} />} />
    case 'hwp':
    case 'hwpx':
      return <HwpView f={f} fallback={(r) => <Fallback f={f} onAction={onAction} reason={r} />} />
    case 'markdown':
    case 'csv':
    case 'json':
    case 'code':
    case 'text':
      return <TextView f={f} fallback={(r) => <Fallback f={f} onAction={onAction} reason={r} />} />
    default:
      return <Fallback f={f} onAction={onAction} reason="이 형식은 앱 안에서 열 수 없습니다." />
  }
}

/** 앱 안에서 못 여는 형식: 다른 방법으로 열기 */
export function Fallback({ f, onAction, reason }: { f: FileItem; onAction: (how: 'save' | OpenHow) => void; reason: string }) {
  return (
    <div className="fv-center">
      <div className="fv-fallback">
        <span className={`fbadge big tone-${toneOf(f.kind)}`}>{badgeOf(f.name)}</span>
        <b className="ellipsis">{f.name}</b>
        <span className="muted">{reason}</span>
        <div className="row">
          {isMac && (
            <button className="primary" onClick={() => onAction('quicklook')}>
              <FIcon name="eye" /> macOS 미리보기로 열기
            </button>
          )}
          <button className={isMac ? '' : 'primary'} onClick={() => onAction('default')}>
            <FIcon name="external" /> 기본 앱으로 열기
          </button>
          <button onClick={() => onAction('save')}>
            <FIcon name="download" /> 내려받기
          </button>
        </div>
      </div>
    </div>
  )
}
