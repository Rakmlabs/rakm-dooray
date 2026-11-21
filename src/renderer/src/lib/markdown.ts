import { marked } from 'marked'
import DOMPurify from 'dompurify'

// 링크는 새 창(=외부 브라우저)으로 연다. main 의 setWindowOpenHandler 가 http(s)/mailto 만 연다.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** 두레이 멘션 `[@이름](dooray://.../members/ID "member")` 을 표시용 span 으로 바꾼다. */
export function replaceMentions(text: string): string {
  return text.replace(/\[@([^\]]+)\]\(dooray:\/\/[^)\s]*(?:\s+"[^"]*")?\)/g, (_m, name: string) => {
    return `<span class="mention">@${escapeHtml(name)}</span>`
  })
}

export function renderMarkdown(src: string, opts: { breaks?: boolean } = {}): string {
  const html = marked.parse(replaceMentions(src), { async: false, gfm: true, breaks: opts.breaks ?? true }) as string
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'iframe', 'form', 'input'], FORBID_ATTR: ['style'] })
}

/** 메일 HTML. 스크립트·폼·외부 리소스를 막고 iframe(sandbox) 안에서만 보여준다. */
export function sanitizeMailHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'link', 'meta', 'base'],
    ALLOW_DATA_ATTR: false
  })
}
