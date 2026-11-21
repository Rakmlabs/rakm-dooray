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
