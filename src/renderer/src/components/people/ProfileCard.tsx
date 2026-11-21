// 채팅 영역 소유. 사람 프로필 카드 (메시지의 아바타·이름·멘션을 누르면 뜬다).
// 보여주는 정보는 공식 멤버 상세 API 가 주는 것만: 이름, 영문 이름·별명, 사용자 ID, 이메일. (부서·직책·사진 필드는 API 에 없다)
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useApp, useMemberNames } from '../../state'
import { navigate } from '../../lib/nav'
import { Avatar } from './Avatar'
import { ChatIcon } from '../chat/ChatIcon'
import { copyText, useProfile } from '../chat/chatStore'

export function ProfileCard({
  memberId,
  anchor,
  meId,
  onClose
}: {
  memberId: string
  anchor: DOMRect
  meId?: string | null
  onClose: () => void
}) {
  const { toast } = useApp()
  const nameOf = useMemberNames()
  const profile = useProfile(memberId)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 6 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    let top = anchor.bottom + 6
    if (top + h > window.innerHeight - 8) top = Math.max(8, anchor.top - h - 6)
    const left = Math.min(Math.max(8, anchor.left), window.innerWidth - w - 8)
    setPos({ left, top })
  }, [anchor, profile])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const name = profile?.name ?? nameOf(memberId) ?? '…'
  const sub = [profile?.englishName, profile?.nickname].filter((v) => v && v !== name).join(' · ')
  const isMe = !!meId && memberId === meId

  return (
    <div ref={ref} className="profile-card" role="dialog" aria-label={`${name} 프로필`} style={{ left: pos.left, top: pos.top }}>
      <div className="profile-top">
        <Avatar memberId={memberId} name={profile?.name} size={52} />
        <div className="profile-names">
          <div className="profile-name">
            {name}
            {isMe && <span className="profile-me">나</span>}
          </div>
          {sub && <div className="muted small">{sub}</div>}
        </div>
      </div>
      {profile === undefined && <div className="muted small">불러오는 중…</div>}
      {profile === null && <div className="muted small">자세한 정보를 불러오지 못했습니다.</div>}
      {profile && (
        <dl className="profile-facts">
          {profile.email && (
            <>
              <dt>이메일</dt>
              <dd>{profile.email}</dd>
            </>
          )}
          {profile.userCode && (
            <>
              <dt>아이디</dt>
              <dd>{profile.userCode}</dd>
            </>
          )}
        </dl>
      )}
      <div className="profile-actions">
        {!isMe && (
          <button
            className="primary small"
            onClick={() => {
              navigate({ kind: 'direct', memberId })
              onClose()
            }}
          >
            <ChatIcon name="chat" size={14} /> 1:1 대화 열기
          </button>
        )}
        {profile?.email && (
          <button
            className="small"
            onClick={async () => {
              const ok = await copyText(profile.email!)
              toast(ok ? '이메일 주소를 복사했습니다.' : '복사하지 못했습니다.', ok ? 'info' : 'error')
            }}
          >
            <ChatIcon name="copy" size={14} /> 이메일 복사
          </button>
        )}
      </div>
    </div>
  )
}

/** 프로필 카드를 여는 훅. open(memberId, 누른 요소) → node 를 화면 어딘가에 그린다. */
export function useProfileCard(meId?: string | null): { open: (memberId: string, el: Element) => void; node: ReactNode } {
  const [state, setState] = useState<{ id: string; rect: DOMRect } | null>(null)
  const open = useCallback((memberId: string, el: Element) => setState({ id: memberId, rect: el.getBoundingClientRect() }), [])
  const close = useCallback(() => setState(null), [])
  const node = state ? <ProfileCard memberId={state.id} anchor={state.rect} meId={meId} onClose={close} /> : null
  return { open, node }
}
