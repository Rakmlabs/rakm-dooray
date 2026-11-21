// 위키 블록 편집기 영역의 main 핸들러. 이 영역 작업자만 고친다.
import type { WikiAreaContract } from '@shared/ipc-wiki'
import type { HandlersFor, MainContext } from './types'

export function wikiAreaHandlers(_ctx: MainContext): HandlersFor<WikiAreaContract> {
  return {}
}
