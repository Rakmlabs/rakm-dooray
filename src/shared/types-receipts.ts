// 읽음 확인 (상대가 이 앱에서 내 메시지를 읽었는지). 앱끼리 두레이 위키 페이지로 읽은 위치를 주고받는다.

/** 한 대화방(스레드 포함)에서 읽은 마지막 메시지 */
export interface ReceiptPosition {
  /** 메시지 순번 (방 안에서 커진다) */
  seq: number
  /** 그 메시지를 보낸 시각 (epoch ms) */
  at: number
}

/** 한 사람의 읽은 위치 기록 (그 사람 앱이 위키 페이지에 쓴 것) */
export interface PeerReceipts {
  memberId: string
  /** 이 사람이 읽음 확인을 처음 켠 시각 (epoch ms). 이보다 앞의 메시지에는 숫자를 띄우지 않는다 */
  since: number
  /** 이 사람 앱이 마지막으로 쓴 시각 (epoch ms) */
  updatedAt: number
  channels: Record<string, ReceiptPosition>
}

export interface ReceiptsSnapshot {
  /** 내 쪽에서 기능이 켜져 있고 저장 위치가 정해졌는지 */
  enabled: boolean
  meId: string | null
  /** 기록이 있는(그리고 기능을 켜 둔) 다른 사람들. 나는 빠진다 */
  peers: Record<string, PeerReceipts>
}

export type ReceiptsState = 'off' | 'waiting' | 'resolving' | 'ready' | 'needsChoice' | 'error'

export interface ReceiptsStatus {
  enabled: boolean
  state: ReceiptsState
  detail: string
  location: { wikiId: string; wikiName: string; rootPageId: string; rootTitle: string; myPageId: string | null } | null
  /** 사용자가 위키를 직접 고른 경우 */
  manual: boolean
  peerCount: number
  lastWriteAt: string | null
  lastReadAt: string | null
}
