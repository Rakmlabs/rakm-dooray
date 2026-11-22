import { useEffect, useState } from 'react'
import type { NotifyPermission } from '@shared/types-shell'
import { call, onEvent } from '../api'

/** main 이 읽은 macOS 알림 권한 상태 (앱을 켤 때·창이 앞에 올 때·주기적으로 바뀐다) */
export function useNotifyPermission(): NotifyPermission | null {
  const [perm, setPerm] = useState<NotifyPermission | null>(null)
  useEffect(() => {
    call('shell:notifyPermission').then(setPerm).catch(() => {})
    return onEvent('shell:notifyPermission', setPerm)
  }, [])
  return perm
}

/** 알림이 꺼져 있거나 아직 허용 전이면 보이는 안내. 문제가 없으면 아무것도 그리지 않는다 */
export function NotifyPermissionBanner({ perm, compact = false }: { perm: NotifyPermission | null; compact?: boolean }) {
  if (!perm || perm.dev || !perm.detail) return null
  if (perm.state === 'unsupported') return null
  const title =
    perm.state === 'undecided'
      ? '알림 허용 전'
      : perm.state === 'denied'
        ? '알림이 꺼져 있음'
        : perm.state === 'unknown'
          ? '알림 상태 확인 안 됨'
          : !perm.badge && !perm.banners
            ? '알림이 꺼져 있음'
            : !perm.badge
              ? 'Dock 배지가 꺼져 있음'
              : '알림 창이 꺼져 있음'
  return (
    <div className={`banner banner-warn notify-off ${compact ? 'notify-bar' : ''}`} role="alert">
      <strong>{title}</strong> · {perm.detail}
      <button type="button" className="link" onClick={() => void call('shell:openNotificationSettings')}>
        시스템 설정 열기
      </button>
    </div>
  )
}

/** 메신저 화면 위 띠 */
export function NotifyPermissionBar() {
  const perm = useNotifyPermission()
  return <NotifyPermissionBanner perm={perm} compact />
}
