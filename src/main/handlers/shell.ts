// 앱 전역 편의: ⌘K, 폴더, 안 읽음·알림, 로컬 보관·검색, 창·트레이 영역의 main 핸들러. 이 영역 작업자만 고친다.
import type { ShellAreaContract } from '@shared/ipc-shell'
import type { HandlersFor, MainContext } from './types'

export function shellAreaHandlers(_ctx: MainContext): HandlersFor<ShellAreaContract> {
  return {}
}
