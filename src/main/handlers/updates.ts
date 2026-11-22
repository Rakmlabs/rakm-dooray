// 자동 업데이트 영역의 main 핸들러.
import type { UpdatesAreaContract } from '@shared/ipc-updates'
import { UpdateService, type UpdateDeps } from '../updates/service'
import type { HandlersFor, MainContext } from './types'

let service: UpdateService | null = null

function need(): UpdateService {
  if (!service) throw new Error('업데이트가 아직 준비되지 않았습니다.')
  return service
}

export function updatesAreaHandlers(_ctx: MainContext): HandlersFor<UpdatesAreaContract> {
  return {
    'updates:status': async () => need().get(),
    'updates:check': async () => need().check(),
    'updates:restart': async () => {
      await need().restart()
      return null
    }
  }
}

/** app ready 후 한 번. 마무리 작업·종료 표시는 index.ts 가 넘긴다 */
export function updatesAreaSetup(ctx: MainContext, hooks: Omit<UpdateDeps, 'emit'>): void {
  service = new UpdateService({ ...hooks, emit: (s) => ctx.emit('updates:status', s) })
  service.start()
}
