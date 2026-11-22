// 입력창 글 처리 (멘션·코드 블록). DOM 없이 테스트할 수 있게 따로 둔다.
import { mentionMarkup } from '../../lib/markdown'

/** 커서 앞에서 진행 중인 @멘션 (@ 위치와 검색어) */
export function activeMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const m = before.match(/(^|[\s(])@([^\s@()[\]]{0,20})$/)
  if (!m) return null
  return { start: caret - m[2].length - 1, query: m[2] }
}

/** 입력창의 @이름 을 두레이 멘션 형식으로 바꾼다. 조직 ID 를 모르면 그대로 둔다. */
export function applyMentions(text: string, mentions: Record<string, string>, organizationId: string | null): string {
  if (!organizationId) return text
  let out = text
  // 긴 이름부터 (김공동 / 김공동님 같은 겹침 방지)
  for (const name of Object.keys(mentions).sort((a, b) => b.length - a.length)) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    out = out.replace(new RegExp(`(^|[\\s(])@${esc}(?=$|[\\s.,!?)~:;])`, 'g'), (_m, pre: string) => pre + mentionMarkup(name, mentions[name], organizationId))
  }
  return out
}

/** 커서가 아직 닫히지 않은 ``` 코드 블록 안인지 */
export function insideCodeFence(text: string, caret: number): boolean {
  const fences = text.slice(0, caret).match(/^\s*```/gm)
  return !!fences && fences.length % 2 === 1
}

// ---------- 코드 서식 넣기 ----------
// 두레이 메신저(웹·모바일)는 본문을 글자 그대로 저장하고, 보여 줄 때 ``` 코드 블록·`인라인 코드`·[글](http 링크)·:이모지:·멘션만
// 따로 그린다 (두레이 웹 메신저 번들의 토큰 종류: EMOJI, TEXT, CODE_BLOCK, INLINE_CODE, MENTION, URL, MARKDOWN_LINK).
// 굵게·기울임·취소선은 두레이 메신저가 그리지 않아 ** ~~ 가 그대로 보이므로 서식 버튼은 코드·링크만 둔다.

export type FormatKind = 'inline' | 'block' | 'link'

export interface Edit {
  text: string
  selStart: number
  selEnd: number
}

/** 선택한 글을 코드/링크 서식으로 감싼다. 선택이 없으면 빈 서식을 넣고 커서를 안에 둔다. */
export function applyFormat(text: string, start: number, end: number, kind: FormatKind): Edit {
  const sel = text.slice(start, end)
  if (kind === 'inline' && sel.includes('\n')) kind = 'block'
  if (kind === 'inline') {
    // 이미 `로 감싼 것이면 벗긴다
    if (start > 0 && text[start - 1] === '`' && text[end] === '`' && sel && !sel.includes('`')) {
      return { text: text.slice(0, start - 1) + sel + text.slice(end + 1), selStart: start - 1, selEnd: end - 1 }
    }
    const next = text.slice(0, start) + '`' + sel + '`' + text.slice(end)
    return { text: next, selStart: start + 1, selEnd: end + 1 }
  }
  if (kind === 'link') {
    if (/^https?:\/\/\S+$/.test(sel.trim())) {
      const next = text.slice(0, start) + `[](${sel.trim()})` + text.slice(end)
      return { text: next, selStart: start + 1, selEnd: start + 1 }
    }
    const label = sel || '링크 글'
    const next = text.slice(0, start) + `[${label}](https://)` + text.slice(end)
    const urlAt = start + label.length + 3
    return { text: next, selStart: urlAt, selEnd: urlAt + 'https://'.length }
  }
  // 코드 블록: 여는 ``` 와 닫는 ``` 는 각자 한 줄에 둔다 (두레이 웹은 ``` 뒤 줄바꿈을 요구한다)
  const before = start > 0 && text[start - 1] !== '\n' ? '\n' : ''
  const after = end < text.length && text[end] !== '\n' ? '\n' : ''
  const body = sel.replace(/\n$/, '')
  const open = before + '```\n'
  const next = text.slice(0, start) + open + body + '\n```' + after + text.slice(end)
  const inner = start + open.length
  return { text: next, selStart: inner, selEnd: inner + body.length }
}

/**
 * ```(언어) 만 친 줄에서 Enter: 닫는 ``` 를 미리 넣고 커서를 가운데 빈 줄에 둔다.
 * 해당하지 않으면 null (그냥 줄바꿈하거나 보낸다).
 */
export function autoCloseFence(text: string, caret: number): Edit | null {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1
  const lineEndRaw = text.indexOf('\n', caret)
  const lineEnd = lineEndRaw < 0 ? text.length : lineEndRaw
  const line = text.slice(lineStart, lineEnd)
  if (!/^\s*```[\w+#.-]*\s*$/.test(line) || caret < lineStart + line.trimEnd().length) return null
  // 이 줄이 여는 ``` 인지 (앞에 있는 ``` 줄 수가 짝수)
  const opensBefore = text.slice(0, lineStart).match(/^\s*```/gm)?.length ?? 0
  if (opensBefore % 2 === 1) return null
  // 뒤에 닫는 ``` 가 이미 있으면 그냥 줄바꿈
  if (/^\s*```/m.test(text.slice(lineEnd))) return null
  const next = text.slice(0, lineEnd) + '\n\n```' + text.slice(lineEnd)
  const pos = lineEnd + 1
  return { text: next, selStart: pos, selEnd: pos }
}

/** 코드 블록 안 Tab: 커서 자리에 공백 2칸 (선택한 여러 줄이면 각 줄 앞에, Shift 면 빼기) */
export function indentCode(text: string, start: number, end: number, outdent: boolean): Edit {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  if (start === end && !outdent) {
    return { text: text.slice(0, start) + '  ' + text.slice(end), selStart: start + 2, selEnd: start + 2 }
  }
  const block = text.slice(lineStart, end)
  const lines = block.split('\n')
  let removedFirst = 0
  let delta = 0
  const out = lines.map((l, i) => {
    if (outdent) {
      const n = l.startsWith('  ') ? 2 : l.startsWith(' ') || l.startsWith('\t') ? 1 : 0
      if (i === 0) removedFirst = n
      delta -= n
      return l.slice(n)
    }
    delta += 2
    return '  ' + l
  })
  const next = text.slice(0, lineStart) + out.join('\n') + text.slice(end)
  const s = outdent ? Math.max(lineStart, start - removedFirst) : start + 2
  return { text: next, selStart: s, selEnd: end + delta }
}

/** 보내기 직전: 닫지 않은 ``` 를 닫는다 (두레이 웹은 닫는 ``` 가 없으면 코드 블록으로 보지 않는다) */
export function closeOpenFence(text: string): string {
  return insideCodeFence(text, text.length) ? `${text}\n\`\`\`` : text
}
