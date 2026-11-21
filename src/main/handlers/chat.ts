// 메시지 표시·프로필·입력 편의 영역의 main 핸들러. 이 영역 작업자만 고친다.
import type { ChatAreaContract } from '@shared/ipc-chat'
import type { HandlersFor, MainContext } from './types'

export function chatAreaHandlers(_ctx: MainContext): HandlersFor<ChatAreaContract> {
  return {}
}

/** app ready 전에 한 번 (예: protocol.registerSchemesAsPrivileged). */
export function chatAreaBeforeReady(): void {}

/** app ready 후, 창을 만들기 전에 한 번 (예: protocol.handle, 트레이). */
export function chatAreaSetup(_ctx: MainContext): void {}
