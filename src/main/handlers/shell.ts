// 앱 전역 편의: ⌘K, 폴더, 안 읽음·알림, 로컬 보관·검색, 창·트레이 영역의 main 핸들러. 이 영역 작업자만 고친다.
import type { ShellAreaContract } from '@shared/ipc-shell'
import type { HandlersFor, MainContext } from './types'

export function shellAreaHandlers(_ctx: MainContext): HandlersFor<ShellAreaContract> {
  return {}
}

/** app ready 전에 한 번 (예: protocol.registerSchemesAsPrivileged). */
export function shellAreaBeforeReady(): void {}

/** app ready 후, 창을 만들기 전에 한 번 (예: protocol.handle, 트레이). */
export function shellAreaSetup(_ctx: MainContext): void {}
