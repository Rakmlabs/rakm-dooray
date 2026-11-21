import type { BrowserWindow } from 'electron'
import type { IpcEventName, IpcEvents } from '@shared/ipc'
import type { DoorayHttp } from '../dooray/http'
import type { MessengerApi } from '../dooray/messenger'
import type { WikiApi } from '../dooray/wiki'

/** 계약(args/result)에서 핸들러 함수 타입을 만든다 */
export type HandlersFor<C> = {
  [K in keyof C]: C[K] extends { args: infer A extends unknown[]; result: infer R } ? (...args: A) => Promise<R> : never
}

/** 영역 핸들러가 쓰는 main 공용 도구 */
export interface MainContext {
  http: DoorayHttp
  messenger: MessengerApi
  wiki: WikiApi
  getWindow: () => BrowserWindow | null
  emit: <E extends IpcEventName>(event: E, payload: IpcEvents[E]) => void
  /** 파일 선택 창. 고른 경로는 첨부 허용 목록에 들어간다 */
  pickFiles: () => Promise<string[]>
  /** 저장 위치를 물어 저장. 취소하면 null */
  saveAs: (suggestedName: string, bytes: Buffer) => Promise<string | null>
}
