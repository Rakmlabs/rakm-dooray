// 동영상·오디오 재생. rakm-file:// 가 Range 를 지원해 되감기·탐색이 된다.
import { useState, type ReactNode } from 'react'
import { FIcon } from '../icons'
import { urlOf, type FileItem } from '../model'

export function MediaView({ f, fallback }: { f: FileItem; fallback: (reason: string) => ReactNode }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <>{fallback('이 형식은 앱 안에서 재생하지 못했습니다. (코덱 미지원일 수 있습니다)')}</>
  if (f.kind === 'audio') {
    return (
      <div className="fv-center">
        <div className="mv-audio">
          <div className="mv-audio-art" aria-hidden>
            <FIcon name="music" size={44} />
          </div>
          <b className="ellipsis">{f.name}</b>
          <audio src={urlOf(f)} controls autoPlay onError={() => setFailed(true)} />
        </div>
      </div>
    )
  }
  return (
    <div className="mv-video">
      <video src={urlOf(f)} controls autoPlay playsInline onError={() => setFailed(true)} />
    </div>
  )
}
