// 앱 전역 편의: ⌘K, 폴더, 안 읽음·알림, 로컬 보관·검색, 창·트레이 영역의 IPC 계약. 이 영역 작업자만 고친다. ipc.ts 가 합친다.
// 채널 이름은 'shell:...' 처럼 영역 접두어를 붙인다. 형식: 'shell:이름': { args: [..]; result: .. }
import type {
  ConnectionState,
  HistoryPage,
  IndexStatus,
  NavTarget,
  QuickData,
  SearchResult,
  ShellState,
  UnreadPayload,
  WikiIndexEntry
} from './types-shell'

export interface ShellAreaContract {
  'shell:getState': { args: []; result: ShellState }
  'shell:saveState': { args: [ShellState]; result: ShellState }
  /** 서버 최신 serverSize 개를 받아 로컬 보관함에 쌓고, 보관함에서 최신 limit 개(includeId 가 있으면 그것까지)를 돌려준다 */
  'shell:logs': {
    args: [channelId: string, serverSize: number, limit: number, includeId: string | null]
    result: HistoryPage
  }
  /** 대화방을 열 때. 직전까지 읽은 시각을 돌려주고 지금까지 읽음으로 표시한다 */
  'shell:openChannel': { args: [channelId: string]; result: { readAt: string | null } }
  /** 지금 화면에 보이는 대화방 (알림·읽음 처리용). 안 보이면 null */
  'shell:viewing': { args: [channelId: string | null]; result: null }
  'shell:summaries': { args: []; result: UnreadPayload }
  'shell:search': { args: [query: string, channelId: string | null]; result: SearchResult }
  'shell:quickData': { args: []; result: QuickData }
  'shell:wikiPages': { args: []; result: WikiIndexEntry[] }
  'shell:lastWikiPage': { args: []; result: { wikiId: string; pageId: string } | null }
  'shell:indexStatus': { args: []; result: IndexStatus }
  'shell:reindexWiki': { args: []; result: null }
  'shell:testNotification': { args: []; result: null }
  'shell:connection': { args: []; result: ConnectionState }
}

export const SHELL_AREA_CHANNELS: (keyof ShellAreaContract)[] = [
  'shell:getState',
  'shell:saveState',
  'shell:logs',
  'shell:openChannel',
  'shell:viewing',
  'shell:summaries',
  'shell:search',
  'shell:quickData',
  'shell:wikiPages',
  'shell:lastWikiPage',
  'shell:indexStatus',
  'shell:reindexWiki',
  'shell:testNotification',
  'shell:connection'
]

/** main → renderer 이벤트 */
export interface ShellAreaEvents {
  'shell:unread': UnreadPayload
  /** 알림을 누르는 등 main 이 요청한 화면 이동 */
  'shell:navigate': NavTarget
  'shell:connectionChanged': ConnectionState
  'shell:state': ShellState
  /** 창이 다시 앞에 와서 보고 있던 방을 읽음으로 바꿨을 때, 바꾸기 전 읽은 시각 ("여기까지 읽음" 위치) */
  'shell:readMarker': { channelId: string; readAt: string | null }
}

export const SHELL_AREA_EVENTS: (keyof ShellAreaEvents)[] = ['shell:unread', 'shell:navigate', 'shell:connectionChanged', 'shell:state', 'shell:readMarker']
