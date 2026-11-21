// 채팅 파일 뷰어·업로드·캐시 영역의 main 핸들러. 이 영역 작업자만 고친다.
import type { FilesAreaContract } from '@shared/ipc-files'
import type { HandlersFor, MainContext } from './types'

export function filesAreaHandlers(_ctx: MainContext): HandlersFor<FilesAreaContract> {
  return {}
}

/** app ready 전에 한 번 (예: protocol.registerSchemesAsPrivileged). */
export function filesAreaBeforeReady(): void {}

/** app ready 후, 창을 만들기 전에 한 번 (예: protocol.handle, 트레이). */
export function filesAreaSetup(_ctx: MainContext): void {}
