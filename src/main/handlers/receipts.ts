// 읽음 확인 영역의 main 핸들러.
import type { ReceiptsAreaContract } from '@shared/ipc-receipts'
import { ReceiptsService } from '../receipts/service'
import type { HandlersFor, MainContext } from './types'

let service: ReceiptsService | null = null

function need(): ReceiptsService {
  if (!service) throw new Error('읽음 확인이 아직 준비되지 않았습니다.')
  return service
}

export function receiptsAreaHandlers(_ctx: MainContext): HandlersFor<ReceiptsAreaContract> {
  return {
    'receipts:snapshot': async () => need().snapshot(),
    'receipts:status': async () => need().status(),
    'receipts:setEnabled': async (enabled) => need().setEnabled(enabled),
    'receipts:wikiChoices': async () => need().wikiChoices(),
    'receipts:chooseWiki': async (wikiId) => need().chooseWiki(wikiId),
    'receipts:seen': async (channelId, seq, at) => {
      need().seen(channelId, seq, at)
      return null
    },
    'receipts:focus': async (focused) => {
      need().setRendererFocused(focused)
      return null
    }
  }
}

/** app ready 후 한 번 */
export function receiptsAreaSetup(ctx: MainContext): void {
  service = new ReceiptsService({
    messenger: ctx.messenger,
    wiki: ctx.wiki,
    emit: ctx.emit,
    windowState: () => {
      const w = ctx.getWindow()
      if (!w || w.isDestroyed() || !w.isVisible() || w.isMinimized()) return 'hidden'
      return w.isFocused() ? 'focused' : 'visible'
    }
  })
  service.start()
}
