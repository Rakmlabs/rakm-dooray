import { Marked, type Tokens } from 'marked'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import shell from 'highlight.js/lib/languages/shell'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

// 코드 블록 문법 강조 (highlight.js, BSD-3-Clause). 자주 쓰는 언어만 등록해 크기를 줄인다.
const LANGS = { bash, css, diff, dockerfile, go, ini, java, javascript, json, kotlin, markdown, python, rust, shell, sql, swift, typescript, xml, yaml }
for (const [name, def] of Object.entries(LANGS)) hljs.registerLanguage(name, def)
hljs.registerAliases(['js', 'jsx', 'mjs'], { languageName: 'javascript' })
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' })
hljs.registerAliases(['sh', 'zsh', 'console'], { languageName: 'bash' })
hljs.registerAliases(['html', 'svg', 'vue'], { languageName: 'xml' })
hljs.registerAliases(['yml'], { languageName: 'yaml' })
hljs.registerAliases(['kt', 'kts'], { languageName: 'kotlin' })
hljs.registerAliases(['py'], { languageName: 'python' })
hljs.registerAliases(['md'], { languageName: 'markdown' })
hljs.registerAliases(['toml', 'env'], { languageName: 'ini' })

// 링크는 새 창(=외부 브라우저)으로 연다. main 의 setWindowOpenHandler 가 http(s)/mailto 만 연다.
// (테스트처럼 DOM 이 없는 환경에서는 addHook 이 없다)
DOMPurify.addHook?.('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** 코드 강조 HTML. 언어를 모르면 짧은 코드만 자동 판별한다. */
export function highlightCode(code: string, lang?: string | null): { html: string; language: string | null } {
  const l = (lang ?? '').trim().split(/\s+/)[0]?.toLowerCase()
  try {
    if (l && hljs.getLanguage(l)) {
      return { html: hljs.highlight(code, { language: l, ignoreIllegals: true }).value, language: l }
    }
    if (!l && code.length < 6000) {
      const r = hljs.highlightAuto(code)
      if (r.language && r.relevance >= 5) return { html: r.value, language: r.language }
    }
  } catch {
    /* 아래 원문으로 */
  }
  return { html: escapeHtml(code), language: l || null }
}

const md = new Marked({
  gfm: true,
  renderer: {
    code({ text, lang }: Tokens.Code) {
      const { html, language } = highlightCode(text, lang)
      const label = language ? ` data-lang="${escapeHtml(language)}"` : ''
      return `<pre class="code-block"${label}><code class="hljs">${html}</code></pre>\n`
    }
  }
})

/**
 * 두레이 멘션을 표시용 span 으로 바꾼다.
 * 형식 (커뮤니티 구현 my13each/DoorayMCPwithMessenger 의 실측 메모):
 *   사람: `[@이름](dooray://{조직ID}/members/{멤버ID} "member")`
 *   전체: `[@Channel](dooray://{조직ID}/channels/{채널ID} "channel")`
 */
export function replaceMentions(text: string): string {
  return text.replace(/\[@([^\]]+)\]\(dooray:\/\/([^)\s]*)(?:\s+"([^"]*)")?\)/g, (_m, name: string, path: string, kind?: string) => {
    const member = path.match(/\/members\/([^/?#]+)/)?.[1]
    if (member && kind !== 'channel') {
      return `<span class="mention" data-member-id="${escapeHtml(member)}" role="button" tabindex="0">@${escapeHtml(name)}</span>`
    }
    if (/\/channels\//.test(path) || kind === 'channel') return `<span class="mention mention-all">@모두</span>`
    return `<span class="mention">@${escapeHtml(name)}</span>`
  })
}

/** 메신저 멘션 텍스트 (보낼 때 쓴다). 조직 ID 를 모르면 링크 없이 @이름 만. */
export function mentionMarkup(name: string, memberId: string, organizationId: string | null): string {
  const safe = name.replace(/[[\]]/g, '')
  return organizationId ? `[@${safe}](dooray://${organizationId}/members/${memberId} "member")` : `@${safe}`
}

export function renderMarkdown(src: string, opts: { breaks?: boolean } = {}): string {
  const html = md.parse(replaceMentions(src), { async: false, breaks: opts.breaks ?? true }) as string
  return DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'iframe', 'form', 'input'], FORBID_ATTR: ['style'] })
}

// ---------- 링크 ----------

const DOORAY_HOST = /(^|\.)(gov-)?dooray\.(com|co\.kr)$/i

/**
 * 두레이 위키 페이지 웹 주소. 두레이 웹에서 위키 페이지를 열면 주소창이
 * `https://{회사}.dooray.com/wiki/{wikiId}/{pageId}` 형태다 (공식 문서에 명시는 없음 — 소유자 확인 필요).
 */
export function wikiPageUrl(domain: string, wikiId: string, pageId: string): string {
  return `https://${domain}/wiki/${encodeURIComponent(wikiId)}/${encodeURIComponent(pageId)}`
}

/** 두레이 위키 페이지 주소면 {wikiId, pageId}. `/project/wiki/...`, `/wiki/{wikiId}/pages/{pageId}` 형태도 받는다. */
export function parseWikiUrl(href: string): { wikiId: string; pageId: string } | null {
  let u: URL
  try {
    u = new URL(href)
  } catch {
    return null
  }
  if (!/^https?:$/.test(u.protocol) || !DOORAY_HOST.test(u.hostname)) return null
  const m = u.pathname.match(/^\/(?:project\/)?wiki\/([\w-]+)\/(?:pages\/)?([\w-]+)\/?$/)
  if (!m || m[2] === 'pages') return null
  return { wikiId: decodeURIComponent(m[1]), pageId: decodeURIComponent(m[2]) }
}

/** 본문에서 미리보기할 첫 외부 링크 (두레이 주소·코드 안 링크는 뺀다) */
export function firstPreviewUrl(text: string): string | null {
  const noCode = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ').replace(/\(dooray:\/\/[^)]*\)/g, ' ')
  for (const m of noCode.matchAll(/https?:\/\/[^\s<>()"'`\]]+/g)) {
    const raw = m[0].replace(/[.,!?;:]+$/, '')
    try {
      const u = new URL(raw)
      if (DOORAY_HOST.test(u.hostname)) continue
      return u.toString()
    } catch {
      /* 다음 */
    }
  }
  return null
}

/** 메일 HTML. 스크립트·폼·외부 리소스를 막고 iframe(sandbox) 안에서만 보여준다. */
export function sanitizeMailHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'link', 'meta', 'base'],
    ALLOW_DATA_ATTR: false
  })
}
