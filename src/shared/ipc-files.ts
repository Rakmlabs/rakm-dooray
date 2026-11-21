// 채팅 파일 뷰어·업로드·캐시 영역의 IPC 계약. 이 영역 작업자만 고친다. ipc.ts 가 합친다.
// 채널 이름은 'files:...' 처럼 영역 접두어를 붙인다. 형식: 'files:이름': { args: [..]; result: .. }
// 파일 바이트(보기)는 IPC 가 아니라 rakm-file:// 프로토콜로 받는다 (types-files.ts 의 fileUrl/thumbUrl).
import type { FileCacheStats } from './types-files'

export type OpenHow = 'quicklook' | 'default' | 'folder'

export interface FilesAreaContract {
  /** 캐시(없으면 내려받아)에서 저장 위치를 물어 저장. 취소하면 null */
  'files:save': { args: [channelId: string, fileId: string, name: string]; result: string | null }
  /** 캐시 파일을 macOS 미리보기(Quick Look)·기본 앱·Finder 로 연다 */
  'files:open': { args: [channelId: string, fileId: string, name: string, how: OpenHow]; result: null }
  /** 파일 하나 올리기. 바이트는 renderer 가 읽어 넘긴다 (드래그 앤 드롭·붙여넣기) */
  'files:upload': { args: [channelId: string, name: string, mime: string, bytes: Uint8Array]; result: null }
  /** 주어진 fileId 중 캐시에 있는 것 */
  'files:cached': { args: [channelId: string, fileIds: string[]]; result: string[] }
  'files:cacheStats': { args: []; result: FileCacheStats }
  'files:setCacheLimit': { args: [limitMB: number]; result: FileCacheStats }
  'files:clearCache': { args: []; result: FileCacheStats }
}

export const FILES_AREA_CHANNELS: (keyof FilesAreaContract)[] = [
  'files:save',
  'files:open',
  'files:upload',
  'files:cached',
  'files:cacheStats',
  'files:setCacheLimit',
  'files:clearCache'
]

/** main → renderer 이벤트 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface FilesAreaEvents {}

export const FILES_AREA_EVENTS: (keyof FilesAreaEvents)[] = []
