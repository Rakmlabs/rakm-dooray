// 위키 블록 편집기 영역의 IPC 계약. 이 영역 작업자만 고친다. ipc.ts 가 합친다.
// 채널 이름은 'wiki:...' 처럼 영역 접두어를 붙인다. 형식: 'wiki:이름': { args: [..]; result: .. }
import type { WikiBackup, WikiSaveRequest, WikiSaveResult, WikiUploadedImage } from './types-wiki'

export interface WikiAreaContract {
  /** 저장 직전에 서버 버전을 다시 확인하고, 같을 때만(또는 force) 제목·본문을 바뀐 것만 고친다 */
  'wiki:save': { args: [wikiId: string, pageId: string, req: WikiSaveRequest]; result: WikiSaveResult }
  /** 페이지 원문 백업 (userData/wiki-backups) */
  'wiki:backupAdd': { args: [backup: Omit<WikiBackup, 'id' | 'savedAt'>]; result: WikiBackup }
  'wiki:backups': { args: [pageId: string]; result: WikiBackup[] }
  /** 본문의 두레이 이미지 경로를 인증해서 받아 data URL 로. 두레이 경로가 아니면 null */
  'wiki:image': { args: [wikiId: string, pageId: string, src: string]; result: string | null }
  /** 붙여넣기·끌어 놓은 이미지 바이트를 페이지에 올리고 본문용 경로를 돌려준다 */
  'wiki:uploadImage': {
    args: [wikiId: string, pageId: string, name: string, mimeType: string, bytes: Uint8Array]
    result: WikiUploadedImage
  }
  /** 저장 대기 중인 변경이 있는지 main 에 알린다 (창 닫기 전 마무리용) */
  'wiki:pendingSave': { args: [pending: boolean]; result: null }
  /** 'wiki:flush' 요청을 받고 저장을 마쳤다 */
  'wiki:flushDone': { args: []; result: null }
}

export const WIKI_AREA_CHANNELS: (keyof WikiAreaContract)[] = [
  'wiki:save',
  'wiki:backupAdd',
  'wiki:backups',
  'wiki:image',
  'wiki:uploadImage',
  'wiki:pendingSave',
  'wiki:flushDone'
]

/** main → renderer 이벤트 */
export interface WikiAreaEvents {
  /** 창을 닫기 전에 보류 중인 저장을 지금 마무리하라 */
  'wiki:flush': null
}

export const WIKI_AREA_EVENTS: (keyof WikiAreaEvents)[] = ['wiki:flush']
