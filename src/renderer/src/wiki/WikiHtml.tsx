// 마크다운 미리보기 HTML. 본문의 두레이 이미지 경로(/wikis/..../files/...)는 인증이 필요해 직접 못 불러오므로
// main 에서 받아 data URL 로 바꿔 넣는다 (file:// 로 잘못 요청하지 않게 src 를 먼저 떼어 둔다).
import { useEffect, useMemo, useRef } from 'react'
import { Marked } from 'marked'
import DOMPurify from 'dompurify'
import { call } from '../api'
import { replaceMentions } from '../lib/markdown'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

// 이미지 src 를 data-wk-src 로만 내보낸다: 살균(DOMPurify) 중에도 file:// 로 요청이 나가지 않게
const wikiMarked = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    image({ href, title, text }) {
      const direct = /^(data:image\/|blob:)/.test(href)
      return `<img ${direct ? 'src' : 'data-wk-src'}="${esc(href)}" alt="${esc(text)}"${title ? ` title="${esc(title)}"` : ''}>`
    }
  }
})

/** 위키 미리보기용 마크다운 렌더링 (lib/markdown 의 renderMarkdown 과 같은 살균 규칙) */
export function renderWikiMarkdown(src: string): string {
  const html = wikiMarked.parse(replaceMentions(src), { async: false }) as string
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'iframe', 'form', 'input'], FORBID_ATTR: ['style'] })
}

export function WikiHtml({ html, wikiId, pageId, className }: { html: string; wikiId: string; pageId: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const safe = useMemo(() => html.replace(/<img([^>]*?)\ssrc="(?!data:|blob:)([^"]*)"/g, '<img$1 data-wk-src="$2"'), [html])
  // (HTML 블록 안의 <img src> 는 살균 단계에서 이미 요청될 수 있다 — 원문 HTML 이라 막지 않는다)
  // 이미지는 화면 가까이 올 때 받는다 (사진이 많은 페이지를 열 때 한꺼번에 받지 않게)
  useEffect(() => {
    let alive = true
    const load = (img: HTMLImageElement) => {
      const src = img.getAttribute('data-wk-src') ?? ''
      img.removeAttribute('data-wk-src')
      img.decoding = 'async'
      call('wiki:image', wikiId, pageId, src)
        .then((u) => {
          if (!alive) return
          if (u) img.src = u
          else img.replaceWith(Object.assign(document.createElement('span'), { className: 'wk-img-missing', textContent: `이미지를 보여줄 수 없습니다 (${img.alt || src})` }))
        })
        .catch(() => {})
    }
    const imgs = Array.from(ref.current?.querySelectorAll<HTMLImageElement>('img[data-wk-src]') ?? [])
    if (typeof IntersectionObserver === 'undefined') {
      imgs.forEach(load)
      return () => {
        alive = false
      }
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          io.unobserve(e.target)
          load(e.target as HTMLImageElement)
        }
      },
      { rootMargin: '800px 0px' }
    )
    imgs.forEach((i) => io.observe(i))
    return () => {
      alive = false
      io.disconnect()
    }
  }, [safe, wikiId, pageId])
  return <div ref={ref} className={className} dangerouslySetInnerHTML={{ __html: safe }} />
}
