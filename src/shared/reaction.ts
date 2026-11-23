// 이모지 반응 한 줄 알아보기 (렌더러: 칩으로 모으기, 메인: 목록 미리보기·알림 문구).
// 형태: "👍 박서연 「대상 메시지 앞부분…」" — 자세한 규칙은 renderer/components/chat/reactions.ts
const RE = /^(\S{1,16}) (.{1,40}?) 「([^」\n]+)」$/u
const PICTO = /\p{Extended_Pictographic}/u

export function parseReaction(text: string): { emoji: string; label: string } | null {
  const r = RE.exec(text)
  if (!r || !PICTO.test(r[1])) return null
  return { emoji: r[1], label: r[3] }
}
