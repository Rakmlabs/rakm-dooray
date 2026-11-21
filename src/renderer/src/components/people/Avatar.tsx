// 채팅 영역 소유. 사람 아바타 (메시지·대화방 목록·⌘K 에서 쓴다). props 는 유지할 것(추가는 선택 prop 으로).
// 두레이 공식 멤버 API(GET /common/v1/members/{id})에는 프로필 사진 필드가 없다.
// 그래서 이름 첫 글자 + 사람마다 고정된 색(멤버 ID 해시)으로 그린다. 색은 chat.css 의 .avatar.tone-N (라이트/다크).
import { useMemberNames } from '../../state'

export const AVATAR_TONES = 8

/** 같은 사람은 언제나 같은 색 */
export function avatarTone(key: string): number {
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return h % AVATAR_TONES
}

/** 표시할 글자: 한글 이름은 성을 뺀 첫 글자보다 첫 글자가 알아보기 쉬워 첫 글자, 영문은 이니셜 두 개 */
export function initialsOf(name: string): string {
  const n = name.trim()
  if (!n) return '?'
  if (/^[A-Za-z]/.test(n)) {
    const parts = n.split(/\s+/).filter(Boolean)
    return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : n.slice(0, 2)).toUpperCase()
  }
  return Array.from(n)[0]
}

export function Avatar({
  memberId,
  size = 32,
  name,
  title
}: {
  memberId: string | null
  size?: number
  name?: string
  /** 마우스를 올리면 보일 설명 (선택) */
  title?: string
}) {
  const nameOf = useMemberNames()
  const n = name ?? nameOf(memberId) ?? ''
  const tone = avatarTone(memberId ?? n ?? '?')
  return (
    <span
      className={`avatar tone-${tone}`}
      style={{ width: size, height: size, fontSize: Math.round(size * (initialsOf(n).length > 1 ? 0.36 : 0.44)) }}
      title={title}
      aria-hidden
    >
      {n ? initialsOf(n) : ''}
    </span>
  )
}
