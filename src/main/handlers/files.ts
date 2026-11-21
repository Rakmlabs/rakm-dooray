// 채팅 파일 뷰어·업로드·캐시 영역의 main 핸들러. 이 영역 작업자만 고친다.
import type { FilesAreaContract } from '@shared/ipc-files'
import type { HandlersFor, MainContext } from './types'

export function filesAreaHandlers(_ctx: MainContext): HandlersFor<FilesAreaContract> {
  return {}
}
