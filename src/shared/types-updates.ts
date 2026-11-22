// 자동 업데이트 상태 (main → renderer)
export type UpdateState =
  /** 확인하지 않음 (개발 실행, 피드 미정) */
  | 'disabled'
  | 'idle'
  | 'checking'
  /** 최신 버전 사용 중 */
  | 'latest'
  | 'downloading'
  /** 다 받음: 재시작하면 설치 (재시작하지 않으면 다음에 앱을 끌 때 설치) */
  | 'ready'
  | 'error'

export interface UpdateStatus {
  state: UpdateState
  /** 지금 버전 */
  current: string
  /** 받은(받는 중인) 새 버전 */
  version: string | null
  /** 받는 중 진행률 0~100 */
  percent: number | null
  /** 사람이 읽는 설명 (disabled·error 사유 등) */
  detail: string
  lastCheckedAt: string | null
  /** 마지막 확인 결과 한 줄 */
  lastResult: string | null
  /** 재시작 준비 중 (위키 저장·읽음 위치 쓰기 마무리) */
  restarting: boolean
}
