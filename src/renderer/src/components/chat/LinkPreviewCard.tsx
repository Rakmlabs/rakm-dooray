// 메시지 속 첫 외부 링크의 미리보기 카드. 실제 요청은 main 이 한다 (쿠키 없이, 내부 주소 차단, 시간·크기 제한).
import { useEffect, useState } from 'react'
import type { LinkPreview } from '@shared/types-chat'
import { call } from '../../api'
import { useChatPrefs } from './chatStore'

const cache = new Map<string, LinkPreview | null>()
const pending = new Map<string, Promise<LinkPreview | null>>()

function load(url: string): Promise<LinkPreview | null> {
  if (cache.has(url)) return Promise.resolve(cache.get(url) ?? null)
  let p = pending.get(url)
  if (!p) {
    p = call('chat:linkPreview', url)
      .catch(() => null)
      .then((v) => {
        cache.set(url, v)
        pending.delete(url)
        return v
      })
    pending.set(url, p)
  }
  return p
}

export function LinkPreviewCard({ url }: { url: string }) {
  const [prefs] = useChatPrefs()
  const [data, setData] = useState<LinkPreview | null | undefined>(cache.get(url))
  useEffect(() => {
    if (!prefs.linkPreview) return
    let alive = true
    void load(url).then((v) => alive && setData(v))
    return () => {
      alive = false
    }
  }, [url, prefs.linkPreview])
  if (!prefs.linkPreview || !data) return null
  return (
    <a className={`link-card ${data.image ? 'has-image' : ''}`} href={data.finalUrl} target="_blank" rel="noopener noreferrer">
      <div className="link-card-text">
        {data.siteName && <div className="link-card-site">{data.siteName}</div>}
        {data.title && <div className="link-card-title">{data.title}</div>}
        {data.description && <div className="link-card-desc">{data.description}</div>}
      </div>
      {data.image && <img className="link-card-img" src={data.image} alt="" loading="lazy" />}
    </a>
  )
}
