// 메시지 표시·프로필·입력 편의 영역의 main 핸들러. 이 영역 작업자만 고친다.
import type { ChatAreaContract } from '@shared/ipc-chat'
import type { HandlersFor, MainContext } from './types'

export function chatAreaHandlers(_ctx: MainContext): HandlersFor<ChatAreaContract> {
  return {}
}
