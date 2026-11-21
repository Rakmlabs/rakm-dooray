// 위키 마크다운 ↔ 블록 편집기(ProseMirror JSON) 변환.
//
// 원칙: 두레이 웹에서 다른 사람이 같은 마크다운을 본다. 그래서
//  1. 문서를 맨 위 블록 단위로 나누고, 블록마다 원문(raw)을 그대로 기억한다.
//  2. 저장할 때 사용자가 고치지 않은 블록은 기억한 원문을 바이트 그대로 내보낸다.
//     고친 블록만 새로 직렬화한다. → 고치지 않은 문서는 왕복해도 바이트 단위로 같다.
//  3. 편집기로 옮기면 뜻이 바뀌는 블록(HTML, 두레이 매크로 ${...}, 엔티티, 섞인 체크리스트 등)은
//     "원문 블록"(mdRaw)으로 두어 원문을 그대로 보존한다.
// DOM 이 필요 없는 순수 함수만 둔다 (테스트에서 그대로 쓴다).
import { Marked } from 'marked'

export interface PMMark {
  type: string
  attrs?: Record<string, unknown>
}
export interface PMNode {
  type: string
  attrs?: Record<string, unknown>
  content?: PMNode[]
  text?: string
  marks?: PMMark[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tok = { type: string; raw: string; [k: string]: any }

const md = new Marked({ gfm: true, breaks: false })

export function lex(src: string): Tok[] {
  return md.lexer(src) as unknown as Tok[]
}

class Unsupported extends Error {}
const unsupported = (why: string): never => {
  throw new Unsupported(why)
}

/* ───────────── 마크다운 토큰 → 노드 ───────────── */

const ENTITY = /&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]*);/i

function sameMarks(a: PMMark[] | undefined, b: PMMark[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
}

function pushText(out: PMNode[], text: string, marks: PMMark[]): void {
  if (!text) return
  if (ENTITY.test(text)) unsupported('HTML 엔티티')
  const last = out[out.length - 1]
  if (last && last.type === 'text' && sameMarks(last.marks, marks)) {
    last.text += text
    return
  }
  const n: PMNode = { type: 'text', text }
  if (marks.length) n.marks = marks.map((m) => ({ ...m }))
  out.push(n)
}

function inline(tokens: Tok[] | undefined, marks: PMMark[], out: PMNode[] = []): PMNode[] {
  for (const t of tokens ?? []) {
    switch (t.type) {
      case 'text':
        if (t.tokens) inline(t.tokens, marks, out)
        else pushText(out, t.text, marks)
        break
      case 'escape':
        pushText(out, t.text, marks)
        break
      case 'strong':
        inline(t.tokens, [...marks, { type: 'bold' }], out)
        break
      case 'em':
        inline(t.tokens, [...marks, { type: 'italic' }], out)
        break
      case 'del':
        inline(t.tokens, [...marks, { type: 'strike' }], out)
        break
      case 'codespan':
        if (marks.some((m) => m.type === 'code')) unsupported('중첩 코드')
        pushText(out, t.text, [...marks, { type: 'code' }])
        break
      case 'link': {
        if (marks.some((m) => m.type === 'link')) unsupported('중첩 링크')
        const before = out.length
        inline(t.tokens, [...marks, { type: 'link', attrs: { href: t.href, title: t.title ?? null } }], out)
        if (out.length === before) unsupported('빈 링크')
        break
      }
      case 'image': {
        const n: PMNode = { type: 'image', attrs: { src: t.href, alt: t.text || null, title: t.title || null } }
        if (marks.length) n.marks = marks.map((m) => ({ ...m }))
        out.push(n)
        break
      }
      case 'br':
        out.push({ type: 'hardBreak', ...(marks.length ? { marks: marks.map((m) => ({ ...m })) } : {}) })
        break
      default:
        unsupported(t.type === 'html' ? '인라인 HTML' : `인라인 ${t.type}`)
    }
  }
  return out
}

function paragraph(tokens: Tok[] | undefined): PMNode {
  const content = inline(tokens, [])
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' }
}

function listMarker(raw: string): { marker: string; delim: string } {
  const m = raw.match(/^\s*([-+*]|\d+([.)]))/)
  return { marker: m && !m[2] ? m[1] : '-', delim: m?.[2] ?? '.' }
}

function listNode(t: Tok): PMNode {
  const items = t.items as Tok[]
  const tasks = items.filter((i) => i.task).length
  if (tasks > 0 && tasks < items.length) unsupported('체크리스트와 일반 목록이 섞임')
  const isTask = tasks > 0
  if (isTask && t.ordered) unsupported('번호 체크리스트')
  const { marker, delim } = listMarker(t.raw)
  const tight = !t.loose
  const content = items.map((item) => {
    const kids: PMNode[] = []
    for (const c of item.tokens as Tok[]) {
      if (c.type === 'checkbox' || c.type === 'space') continue
      if (c.type === 'text') kids.push(paragraph(c.tokens ?? [{ type: 'text', raw: c.raw, text: c.text }]))
      else kids.push(block(c))
    }
    if (!kids.length || kids[0].type !== 'paragraph') kids.unshift({ type: 'paragraph' })
    return isTask
      ? { type: 'taskItem', attrs: { checked: !!item.checked }, content: kids }
      : { type: 'listItem', content: kids }
  })
  if (isTask) return { type: 'taskList', attrs: { tight }, content }
  if (t.ordered) {
    const start = t.start === '' || t.start === undefined ? 1 : Number(t.start)
    return { type: 'orderedList', attrs: { start, delim, tight }, content }
  }
  return { type: 'bulletList', attrs: { marker, tight }, content }
}

function tableNode(t: Tok): PMNode {
  const align = t.align as (string | null)[]
  const cell = (c: Tok, header: boolean, i: number): PMNode => ({
    type: header ? 'tableHeader' : 'tableCell',
    attrs: { align: align[i] ?? null },
    content: [paragraph(c.tokens)]
  })
  const rows: PMNode[] = [{ type: 'tableRow', content: (t.header as Tok[]).map((c, i) => cell(c, true, i)) }]
  for (const r of t.rows as Tok[][]) {
    if (r.length !== align.length) unsupported('칸 수가 다른 표')
    rows.push({ type: 'tableRow', content: r.map((c, i) => cell(c, false, i)) })
  }
  return { type: 'table', content: rows }
}

function block(t: Tok): PMNode {
  switch (t.type) {
    case 'paragraph':
      return paragraph(t.tokens)
    case 'heading':
      return { type: 'heading', attrs: { level: t.depth }, ...withContent(inline(t.tokens, [])) }
    case 'code':
      return { type: 'codeBlock', attrs: { language: t.lang ? String(t.lang) : null }, ...withContent(t.text ? [{ type: 'text', text: t.text }] : []) }
    case 'blockquote': {
      const kids = (t.tokens as Tok[]).filter((c) => c.type !== 'space').map(block)
      return { type: 'blockquote', content: kids.length ? kids : [{ type: 'paragraph' }] }
    }
    case 'hr':
      return { type: 'horizontalRule' }
    case 'list':
      return listNode(t)
    case 'table':
      return tableNode(t)
    default:
      return unsupported(t.type === 'html' ? 'HTML 블록' : t.type === 'def' ? '링크 정의' : `블록 ${t.type}`)
  }
}

function withContent(c: PMNode[]): { content?: PMNode[] } {
  return c.length ? { content: c } : {}
}

/* ───────────── 노드 → 마크다운 ───────────── */

const MARK_ORDER = ['link', 'bold', 'italic', 'strike']
const OPEN: Record<string, string> = { bold: '**', italic: '*', strike: '~~' }
const WORD = /[\p{L}\p{N}]/u

function escapeText(s: string, inTable: boolean): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if ('\\`*~[]<'.includes(c)) out += '\\' + c
    else if (c === '_') {
      // 낱말 가운데의 _ (snake_case)는 강조가 되지 않으므로 그대로 둔다
      const intra = i > 0 && i < s.length - 1 && WORD.test(s[i - 1]) && WORD.test(s[i + 1])
      out += intra ? c : '\\_'
    } else if (c === '&' && ENTITY.test(s.slice(i))) {
      out += ENTITY.exec(s.slice(i))?.index === 0 ? '\\&' : c
    } else if (c === '|' && inTable) out += '\\|'
    else out += c
  }
  return out
}

function codeSpan(text: string, inTable: boolean): string {
  const runs = text.match(/`+/g) ?? []
  const n = runs.reduce((m, r) => Math.max(m, r.length), 0) + 1
  const fence = '`'.repeat(n)
  const pad = /^`|`$/.test(text) || (/^ .* $/.test(text) && text.trim() !== '') ? ' ' : ''
  const body = inTable ? text.replace(/\|/g, '\\|') : text
  return fence + pad + body + pad + fence
}

function linkDest(href: string): string {
  return /[\s()<>]/.test(href) ? `<${href.replace(/[<>]/g, (c) => encodeURIComponent(c))}>` : href
}
function linkTitle(title: unknown): string {
  return title ? ` "${String(title).replace(/"/g, '\\"')}"` : ''
}

function markKey(m: PMMark): string {
  return m.type === 'link' ? `link:${JSON.stringify([m.attrs?.href ?? '', m.attrs?.title ?? null])}` : m.type
}

function inlineMarks(n: PMNode): PMMark[] {
  return (n.marks ?? []).filter((m) => m.type !== 'code').sort((a, b) => MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type))
}

function isAutolinkable(href: string): boolean {
  return /^(https?:\/\/|mailto:)[^\s<>()[\]*_~`\\]+$/i.test(href) && !/[.,:;!?'"]$/.test(href)
}

function serializeInline(nodes: PMNode[] | undefined, inTable = false): string {
  const list = nodes ?? []
  let out = ''
  const active: PMMark[] = []
  const close = (m: PMMark) => {
    const ws = out.match(/[ \t]+$/)?.[0] ?? ''
    out = out.slice(0, out.length - ws.length)
    out += m.type === 'link' ? `](${linkDest(String(m.attrs?.href ?? ''))}${linkTitle(m.attrs?.title)})` : OPEN[m.type]
    out += ws
  }
  for (let i = 0; i < list.length; i++) {
    const n = list[i]
    const marks = inlineMarks(n)
    const keys = new Set(marks.map(markKey))
    let keep = 0
    while (keep < active.length && keys.has(markKey(active[keep]))) keep++
    while (active.length > keep) close(active.pop()!)
    let text = n.type === 'text' ? (n.text ?? '') : ''
    const opening = marks.filter((m) => !active.some((a) => markKey(a) === markKey(m)))
    if (opening.length && n.type === 'text') {
      const lead = text.match(/^[ \t]+/)?.[0] ?? ''
      out += lead
      text = text.slice(lead.length)
    }
    let skipTo = -1
    for (const m of opening) {
      if (m.type === 'link') {
        // 자동 링크: 글자와 주소가 같으면 주소만 쓴다 (https://... 그대로)
        const href = String(m.attrs?.href ?? '')
        let j = i
        let plain = ''
        while (j < list.length && list[j].type === 'text' && (list[j].marks ?? []).length === active.length + 1 && inlineMarks(list[j]).some((x) => markKey(x) === markKey(m))) {
          plain += list[j].text
          j++
        }
        const more = j < list.length && inlineMarks(list[j]).some((x) => markKey(x) === markKey(m))
        if (!more && plain === href && isAutolinkable(href) && opening.length === 1) {
          out += href
          skipTo = j - 1
          break
        }
        out += '['
      } else out += OPEN[m.type]
      active.push(m)
    }
    if (skipTo >= 0) {
      i = skipTo
      continue
    }
    if (n.type === 'text') {
      if ((n.marks ?? []).some((m) => m.type === 'code')) out += codeSpan(text, inTable)
      else out += escapeText(text, inTable)
    } else if (n.type === 'hardBreak') out += inTable ? ' ' : '\\\n'
    else if (n.type === 'image') {
      const a = n.attrs ?? {}
      out += `![${escapeText(String(a.alt ?? ''), inTable)}](${linkDest(String(a.src ?? ''))}${linkTitle(a.title)})`
    }
  }
  while (active.length) close(active.pop()!)
  return out
}

/** 문단 줄 머리에 오면 다른 블록이 되어 버리는 글자를 이스케이프한다 */
function fixLines(s: string): string {
  return s
    .split('\n')
    .map((line, i, all) => {
      let l = i === 0 ? line : line.replace(/^[ \t]+/, '')
      if (i === 0) l = l.replace(/^[ \t]+/, '')
      if (i < all.length - 1 && !l.endsWith('\\')) l = l.replace(/[ \t]+$/, '')
      l = l.replace(/^(#{1,6})(?=[ \t]|$)/, '\\$1')
      l = l.replace(/^([-+])(?=[ \t]|$)/, '\\$1')
      l = l.replace(/^(\d{1,9})([.)])(?=[ \t]|$)/, '$1\\$2')
      l = l.replace(/^>/, '\\>')
      l = l.replace(/^(=+|-+)([ \t]*)$/, '\\$1$2')
      l = l.replace(/^(-[ \t]*){3,}$|^(_[ \t]*){3,}$/, (m) => '\\' + m)
      l = l.replace(/^(~{3,})/, '\\$1')
      return l
    })
    .join('\n')
}

function indentRest(body: string, n: number): string {
  const pad = ' '.repeat(n)
  return body
    .split('\n')
    .map((l, i) => (i === 0 || l === '' ? l : pad + l))
    .join('\n')
}

function serializeChildren(nodes: PMNode[] | undefined, tight: boolean): string {
  const list = nodes ?? []
  let out = ''
  list.forEach((n, i) => {
    if (i > 0) out += tight && !(n.type === 'paragraph' && list[i - 1].type === 'paragraph') ? '\n' : '\n\n'
    out += serializeBlock(n)
  })
  return out
}

function serializeList(node: PMNode): string {
  const a = node.attrs ?? {}
  const tight = a.tight !== false
  const items = node.content ?? []
  const start = Number(a.start ?? 1) || 0
  return items
    .map((item, i) => {
      let marker: string
      if (node.type === 'orderedList') marker = `${start + i}${a.delim === ')' ? ')' : '.'} `
      else if (node.type === 'taskList') marker = `- [${item.attrs?.checked ? 'x' : ' '}] `
      else marker = `${typeof a.marker === 'string' && '-+*'.includes(a.marker) ? a.marker : '-'} `
      const width = node.type === 'taskList' ? 2 : marker.length
      const body = serializeChildren(item.content, tight)
      return (marker + indentRest(body, width)).replace(/[ \t]+$/, node.type === 'taskList' ? ' ' : '')
    })
    .join(tight ? '\n' : '\n\n')
}

function serializeTable(node: PMNode): string {
  const rows = node.content ?? []
  if (!rows.length) return ''
  const cols = Math.max(...rows.map((r) => (r.content ?? []).length))
  const cellText = (c: PMNode | undefined) =>
    (c?.content ?? [])
      .map((p) => serializeInline(p.content, true).replace(/\n/g, ' '))
      .filter(Boolean)
      .join(' ')
      .trim()
  const line = (r: PMNode) => {
    const cells: string[] = []
    for (let i = 0; i < cols; i++) cells.push(cellText(r.content?.[i]))
    return `| ${cells.join(' | ')} |`
  }
  const head = rows[0].content ?? []
  const delim: string[] = []
  for (let i = 0; i < cols; i++) {
    const al = head[i]?.attrs?.align
    delim.push(al === 'left' ? ':---' : al === 'right' ? '---:' : al === 'center' ? ':---:' : '---')
  }
  return [line(rows[0]), `| ${delim.join(' | ')} |`, ...rows.slice(1).map(line)].join('\n')
}

/** 블록 하나를 마크다운으로 (끝 줄바꿈 없이) */
export function serializeBlock(node: PMNode): string {
  switch (node.type) {
    case 'paragraph':
      return fixLines(serializeInline(node.content))
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)))
      let text = serializeInline(node.content).replace(/\\\n|\n/g, ' ').trim()
      if (text.endsWith('#')) text = text.slice(0, -1) + '\\#'
      return '#'.repeat(level) + (text ? ' ' + text : '')
    }
    case 'codeBlock': {
      const text = (node.content ?? []).map((t) => t.text ?? '').join('')
      const longest = (text.match(/`{3,}/g) ?? []).reduce((m, r) => Math.max(m, r.length), 2)
      const fence = '`'.repeat(longest + 1)
      const lang = node.attrs?.language ? String(node.attrs.language).replace(/\s+/g, '') : ''
      return `${fence}${lang}\n${text}${text ? '\n' : ''}${fence}`
    }
    case 'blockquote':
      return serializeChildren(node.content, false)
        .split('\n')
        .map((l) => (l ? '> ' + l : '>'))
        .join('\n')
    case 'horizontalRule':
      return '---'
    case 'bulletList':
    case 'orderedList':
    case 'taskList':
      return serializeList(node)
    case 'table':
      return serializeTable(node)
    case 'mdRaw':
      return String(node.attrs?.source ?? '').replace(/\s+$/, '')
    case 'image':
      return serializeInline([node])
    default:
      return serializeInline(node.content)
  }
}

/* ───────────── 문서 단위 ───────────── */

export interface SourceBlock {
  /** 원문 (끝 줄바꿈 제외) */
  content: string
  /** 다음 블록까지의 원문 공백 (마지막 블록이면 문서 끝 공백) */
  sep: string
  /** 처음 읽었을 때의 직렬화 결과. 지금 직렬화가 이것과 같으면 "고치지 않음" */
  fingerprint: string
  next: string | null
}

export interface SourceMap {
  prefix: string
  tail: string
  blocks: Map<string, SourceBlock>
}

export interface BuiltDoc {
  doc: PMNode
  map: SourceMap
  /** 원문 블록으로 둔 것들과 이유 */
  rawBlocks: { reason: string; preview: string }[]
  /** 블록 편집을 쓸 수 없으면 이유 (원문 편집으로 연다) */
  fatal: string | null
}

const html = (s: string) =>
  (md.parse(s, { async: false }) as string)
    .replace(/>\n+/g, '>')
    .replace(/\n+</g, '<')
    .trim()

/** 블록 하나를 편집기 노드로. 뜻이 바뀌면 이유를 돌려준다. */
export function convertBlock(t: Tok, content: string): PMNode | string {
  if (content.includes('${')) return '두레이 매크로 ${...}'
  let node: PMNode
  try {
    node = block(t)
  } catch (e) {
    if (e instanceof Unsupported) return e.message
    throw e
  }
  const s = serializeBlock(node)
  if (html(content) !== html(s)) return '편집기로 옮기면 모양이 바뀜'
  // 다시 읽고 써도 같아야 이후 편집이 안정적이다
  const again = lex(s).filter((x) => x.type !== 'space')
  if (again.length !== 1) return '편집기로 옮기면 블록이 나뉨'
  try {
    if (serializeBlock(block(again[0])) !== s) return '직렬화가 안정적이지 않음'
  } catch {
    return '직렬화가 안정적이지 않음'
  }
  return node
}

let bidSeq = 0
export function newBid(): string {
  return `b${Date.now().toString(36)}${(++bidSeq).toString(36)}`
}

export function rawNode(source: string, bid: string | null = null): PMNode {
  return { type: 'mdRaw', attrs: { source, bid } }
}

export function buildDoc(src: string): BuiltDoc {
  const empty = (fatal: string | null): BuiltDoc => ({
    doc: { type: 'doc', content: [{ type: 'paragraph' }] },
    map: { prefix: '', tail: '', blocks: new Map() },
    rawBlocks: [],
    fatal
  })
  if (src.includes('\r')) return empty('줄바꿈이 CRLF(윈도 형식)라서')
  if (src.includes('\0')) return empty('본문에 특수 문자가 있어서')
  let tokens: Tok[]
  try {
    tokens = lex(src)
  } catch {
    return empty('마크다운을 읽지 못해서')
  }
  if (tokens.map((t) => t.raw).join('') !== src) return empty('마크다운을 블록으로 정확히 나누지 못해서')

  let i = 0
  let prefix = ''
  while (i < tokens.length && tokens[i].type === 'space') prefix += tokens[i++].raw
  const groups: { tok: Tok; content: string; sep: string }[] = []
  for (; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.type === 'space') {
      groups[groups.length - 1].sep += t.raw
      continue
    }
    const content = t.raw.replace(/\n+$/, '')
    groups.push({ tok: t, content, sep: t.raw.slice(content.length) })
  }
  // 원문 공백이 줄바꿈이 아닌 글자로 끝나는 경우(줄 끝 공백 등)도 그대로 보존된다: content+sep == raw+공백
  const blocks = new Map<string, SourceBlock>()
  const rawBlocks: BuiltDoc['rawBlocks'] = []
  const nodes: PMNode[] = []
  const bids = groups.map(() => newBid())
  groups.forEach((g, k) => {
    const bid = bids[k]
    const r = convertBlock(g.tok, g.content)
    let node: PMNode
    if (typeof r === 'string') {
      node = rawNode(g.content, bid)
      rawBlocks.push({ reason: r, preview: g.content.slice(0, 80) })
    } else {
      node = { ...r, attrs: { ...(r.attrs ?? {}), bid } }
    }
    nodes.push(node)
    blocks.set(bid, { content: g.content, sep: g.sep, fingerprint: serializeBlock(node), next: bids[k + 1] ?? null })
  })
  const tail = groups.length ? groups[groups.length - 1].sep : ''
  if (!groups.length) prefix = src
  return {
    doc: { type: 'doc', content: nodes.length ? nodes : [{ type: 'paragraph' }] },
    map: { prefix, tail, blocks },
    rawBlocks,
    fatal: null
  }
}

function isEmptyParagraph(n: PMNode): boolean {
  return n.type === 'paragraph' && !(n.content ?? []).length
}

/** 편집기 문서를 마크다운으로. 고치지 않은 블록은 원문을 그대로 쓴다. */
export function serializeDoc(doc: PMNode, map: SourceMap): string {
  const nodes = (doc.content ?? []).filter((n) => !isEmptyParagraph(n) && !(n.type === 'mdRaw' && !String(n.attrs?.source ?? '').trim()))
  if (!nodes.length) return map.blocks.size ? '' : map.prefix
  const seen = new Set<string>()
  const parts = nodes.map((n) => {
    const bid = (n.attrs?.bid as string | null | undefined) ?? null
    const info = bid && !seen.has(bid) ? map.blocks.get(bid) : undefined
    if (bid) seen.add(bid)
    const text = serializeBlock(n)
    const pristine = !!info && text === info.fingerprint
    return { bid: info ? bid : null, info, pristine, text: pristine ? info!.content : text }
  })
  let out = map.prefix
  parts.forEach((p, i) => {
    out += p.text
    if (i === parts.length - 1) {
      out += map.tail
      return
    }
    const next = parts[i + 1]
    const successor = !!p.info && !!next.bid && p.info.next === next.bid
    if (successor && p.pristine && next.pristine) out += p.info!.sep
    else if (successor && /\n[ \t]*\n/.test(p.info!.sep)) out += p.info!.sep
    else out += '\n\n'
  })
  return out
}

/** 원문 블록(mdRaw) 하나를 다시 블록들로 읽는다 (원문 블록을 고친 뒤 편집기 블록으로 바꿀 때) */
export function parseFragment(src: string): PMNode[] {
  const built = buildDoc(src)
  if (built.fatal) return [rawNode(src)]
  return (built.doc.content ?? []).map((n) => ({ ...n, attrs: { ...(n.attrs ?? {}), bid: null } }))
}
