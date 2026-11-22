// 읽음 확인 영역의 IPC 계약. ipc.ts 가 합친다.
import type { ReceiptsSnapshot, ReceiptsStatus } from './types-receipts'

export interface ReceiptsAreaContract {
  'receipts:snapshot': { args: []; result: ReceiptsSnapshot }
  'receipts:status': { args: []; result: ReceiptsStatus }
  'receipts:setEnabled': { args: [enabled: boolean]; result: ReceiptsStatus }
  /** 자동으로 못 정했을 때 고를 수 있는 위키 */
  'receipts:wikiChoices': { args: []; result: { id: string; name: string }[] }
  /** 저장할 위키를 직접 고른다. null 이면 자동으로 되돌린다 */
  'receipts:chooseWiki': { args: [wikiId: string | null]; result: ReceiptsStatus }
  /** 화면에 보이는(창이 앞에 있을 때) 대화방·스레드의 마지막 메시지 */
  'receipts:seen': { args: [channelId: string, seq: number, at: number]; result: null }
  /** 화면(renderer)이 앞에 있는지. 앞에 있을 때만 상대 기록을 자주 읽는다 */
  'receipts:focus': { args: [focused: boolean]; result: null }
}

export const RECEIPTS_AREA_CHANNELS: (keyof ReceiptsAreaContract)[] = [
  'receipts:snapshot',
  'receipts:status',
  'receipts:setEnabled',
  'receipts:wikiChoices',
  'receipts:chooseWiki',
  'receipts:seen',
  'receipts:focus'
]

export interface ReceiptsAreaEvents {
  'receipts:snapshot': ReceiptsSnapshot
  'receipts:status': ReceiptsStatus
}

export const RECEIPTS_AREA_EVENTS: (keyof ReceiptsAreaEvents)[] = ['receipts:snapshot', 'receipts:status']
