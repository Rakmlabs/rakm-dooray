// 자동 업데이트 영역의 IPC 계약. ipc.ts 가 합친다.
import type { UpdateStatus } from './types-updates'

export interface UpdatesAreaContract {
  'updates:status': { args: []; result: UpdateStatus }
  /** 지금 확인 */
  'updates:check': { args: []; result: UpdateStatus }
  /** 받아 둔 새 버전으로 재시작 (보류 중인 위키 저장·읽음 위치 쓰기를 끝낸 뒤) */
  'updates:restart': { args: []; result: null }
}

export const UPDATES_AREA_CHANNELS: (keyof UpdatesAreaContract)[] = ['updates:status', 'updates:check', 'updates:restart']

export interface UpdatesAreaEvents {
  'updates:status': UpdateStatus
}

export const UPDATES_AREA_EVENTS: (keyof UpdatesAreaEvents)[] = ['updates:status']
