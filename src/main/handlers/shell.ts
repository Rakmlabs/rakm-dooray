// 앱 전역 편의: ⌘K, 폴더, 안 읽음·알림, 로컬 보관·검색, 창·트레이 영역의 main 핸들러. 이 영역 작업자만 고친다.
import type { Message } from '@shared/types'
import type { ShellAreaContract } from '@shared/ipc-shell'
import type { ShellState } from '@shared/types-shell'
import { ShellService } from '../local/service'
import type { HandlersFor, MainContext } from './types'

/** index.ts 가 채운다 (창을 만드는 일은 index.ts 몫) */
export const shellHooks = {
  showWindow: async (): Promise<void> => {},
  applyState: (_s: ShellState): void => {}
}

let service: ShellService | null = null

/** index.ts 의 기본 핸들러(메시지·위키 조회)가 받아 온 것을 보관함·색인에 넣을 때 쓴다 */
export function shellService(): ShellService | null {
  return service
}

function need(): ShellService {
  if (!service) throw new Error('앱이 아직 준비되지 않았습니다.')
  return service
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export function shellAreaHandlers(_ctx: MainContext): HandlersFor<ShellAreaContract> {
  return {
    'shell:getState': async () => need().getState(),
    'shell:saveState': async (s) => need().saveState(s),
    'shell:logs': async (channelId, serverSize, limit, includeId) => {
      const s = need()
      const size = Math.min(1000, Math.max(1, Math.round(serverSize)))
      let list: Message[] = []
      let error: string | null = null
      try {
        list = await s.fetchInto(channelId, size)
        s.noteResult(null)
      } catch (e) {
        s.noteResult(e)
        // 보관함에 있는 것이 없으면 오류를 그대로 보여준다
        if (!s.archive || s.archive.count(channelId) === 0) throw e
        error = errorText(e)
      }
      const page = s.page(channelId, limit, includeId, list)
      return { ...page, serverCount: list.length, error }
    },
    'shell:openChannel': async (channelId) => need().openChannel(channelId),
    'shell:viewing': async (channelId) => {
      need().setViewing(channelId)
      return null
    },
    'shell:summaries': async () => need().summaries(),
    'shell:search': async (query, channelId) => {
      const s = need()
      return {
        messages: s.archive?.searchMessages(query, channelId) ?? [],
        wiki: channelId ? [] : (s.archive?.searchWiki(query) ?? [])
      }
    },
    'shell:quickData': async () => {
      const s = need()
      const channels = await s.channelList().catch(() => [])
      return {
        channels,
        members: await s.knownMembers(),
        wikiPages: s.archive?.wikiEntries() ?? [],
        meId: await s.meId()
      }
    },
    'shell:wikiPages': async () => need().archive?.wikiEntries() ?? [],
    'shell:lastWikiPage': async () => need().getLastWikiPage(),
    'shell:indexStatus': async () => {
      const s = need()
      const st = s.archive?.stats() ?? { messages: 0, channels: 0, wikiPages: 0, wikiBodies: 0 }
      return { ...st, crawling: s.isCrawling(), storage: s.archive ? 'node:sqlite' : `사용 불가 (${s.archiveError ?? '알 수 없음'})` }
    },
    'shell:reindexWiki': async () => {
      void need().crawlWikis(true)
      return null
    },
    'shell:testNotification': async () => {
      need().testNotification()
      return null
    },
    'shell:connection': async () => need().getConnection()
  }
}

/** app ready 전에 한 번 (예: protocol.registerSchemesAsPrivileged). */
export function shellAreaBeforeReady(): void {}

/** app ready 후, 창을 만들기 전에 한 번 (예: protocol.handle, 트레이). */
export function shellAreaSetup(ctx: MainContext): void {
  service = new ShellService({
    messenger: ctx.messenger,
    wiki: ctx.wiki,
    emit: ctx.emit,
    isFocused: () => {
      const w = ctx.getWindow()
      return !!w && !w.isDestroyed() && w.isVisible() && w.isFocused()
    },
    showWindow: () => shellHooks.showWindow(),
    onStateApplied: (s) => shellHooks.applyState(s)
  })
  service.start()
}
