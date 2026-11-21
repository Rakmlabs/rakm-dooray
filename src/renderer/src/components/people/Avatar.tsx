// 채팅 영역 소유. 사람 아바타 (메시지·대화방 목록·⌘K 에서 쓴다). props 는 유지할 것(추가는 선택 prop 으로).
import { useMemberNames } from '../../state'

export function Avatar({ memberId, size = 32, name }: { memberId: string | null; size?: number; name?: string }) {
  const nameOf = useMemberNames()
  const n = name ?? nameOf(memberId) ?? '?'
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>
      {n.slice(0, 1)}
    </span>
  )
}
