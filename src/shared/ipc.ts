import type {
  Channel,
  ComposeInput,
  MailDetail,
  MailFolder,
  MailPage,
  Member,
  Message,
  MessengerActivity,
  PublicSettings,
  RealtimeStatus,
  SettingsInput,
  TestResult,
  UiState,
  Wiki,
  WikiComment,
  WikiPage,
  WikiPageSummary
} from './types'
import { WIKI_AREA_CHANNELS, WIKI_AREA_EVENTS, type WikiAreaContract, type WikiAreaEvents } from './ipc-wiki'
import { FILES_AREA_CHANNELS, FILES_AREA_EVENTS, type FilesAreaContract, type FilesAreaEvents } from './ipc-files'
import { CHAT_AREA_CHANNELS, CHAT_AREA_EVENTS, type ChatAreaContract, type ChatAreaEvents } from './ipc-chat'
import { SHELL_AREA_CHANNELS, SHELL_AREA_EVENTS, type ShellAreaContract, type ShellAreaEvents } from './ipc-shell'

/**
 * renderer → main 요청 목록. 키가 IPC 채널 이름이다.
 * preload 는 이 목록에 있는 채널만 통과시킨다.
 */
interface CoreContract {
  'settings:get': { args: []; result: PublicSettings }
  'settings:save': { args: [SettingsInput]; result: PublicSettings }
  'settings:testDooray': { args: []; result: TestResult }
  'settings:testMail': { args: []; result: TestResult }
  'ui:get': { args: []; result: UiState }
  'ui:save': { args: [UiState]; result: UiState }

  'messenger:me': { args: []; result: Member }
  'messenger:channels': { args: []; result: Channel[] }
  'messenger:logs': { args: [channelId: string, size: number]; result: Message[] }
  'messenger:member': { args: [memberId: string]; result: Member }
  'messenger:searchMembers': { args: [name: string]; result: Member[] }
  'messenger:send': { args: [channelId: string, text: string]; result: { id: string; channelId: string } }
  'messenger:update': { args: [channelId: string, logId: string, text: string]; result: null }
  'messenger:delete': { args: [channelId: string, logId: string]; result: null }
  'messenger:reply': { args: [channelId: string, logId: string, text: string]; result: { id: string; channelId: string } }
  'messenger:createThread': {
    args: [channelId: string, text: string, threadText: string | null]
    result: { id: string; channelId: string }
  }
  'messenger:threadFromMessage': {
    args: [channelId: string, logId: string, text: string]
    result: { id: string; channelId: string }
  }
  'messenger:directSend': { args: [memberId: string, text: string]; result: null }
  'messenger:createChannel': { args: [title: string, memberIds: string[]]; result: { id: string } }
  'messenger:downloadFile': { args: [channelId: string, fileId: string, suggestedName: string]; result: string | null }
  'messenger:uploadFile': { args: [channelId: string]; result: boolean }
  'realtime:status': { args: []; result: RealtimeStatus }
  'realtime:restart': { args: []; result: RealtimeStatus }

  'wiki:list': { args: []; result: Wiki[] }
  'wiki:pages': { args: [wikiId: string, parentPageId: string | null]; result: WikiPageSummary[] }
  'wiki:page': { args: [wikiId: string, pageId: string]; result: WikiPage }
  'wiki:create': {
    args: [wikiId: string, parentPageId: string | null, subject: string, content: string]
    result: { id: string }
  }
  'wiki:update': { args: [wikiId: string, pageId: string, subject: string, content: string]; result: null }
  'wiki:move': { args: [wikiId: string, pageId: string, targetParentPageId: string]; result: null }
  'wiki:delete': { args: [wikiId: string, pageId: string]; result: null }
  'wiki:comments': { args: [wikiId: string, pageId: string]; result: WikiComment[] }
  'wiki:addComment': { args: [wikiId: string, pageId: string, content: string]; result: null }
  'wiki:updateComment': { args: [wikiId: string, pageId: string, commentId: string, content: string]; result: null }
  'wiki:deleteComment': { args: [wikiId: string, pageId: string, commentId: string]; result: null }
  'wiki:uploadFile': { args: [wikiId: string, pageId: string]; result: boolean }
  'wiki:downloadFile': { args: [wikiId: string, pageId: string, fileId: string, name: string]; result: string | null }

  'mail:folders': { args: []; result: MailFolder[] }
  'mail:list': { args: [folder: string, page: number, pageSize: number]; result: MailPage }
  'mail:get': { args: [folder: string, uid: number]; result: MailDetail }
  'mail:setSeen': { args: [folder: string, uid: number, seen: boolean]; result: null }
  'mail:delete': { args: [folder: string, uid: number]; result: null }
  'mail:downloadAttachment': { args: [folder: string, uid: number, index: number]; result: string | null }
  'mail:send': { args: [ComposeInput]; result: null }

  'file:pick': { args: []; result: string[] }
  'shell:openExternal': { args: [url: string]; result: null }
}

/** 기본 계약 + 영역별 계약(ipc-wiki/files/chat/shell.ts) */
export interface IpcContract extends CoreContract, WikiAreaContract, FilesAreaContract, ChatAreaContract, ShellAreaContract {}

export type IpcChannel = keyof IpcContract

/** main → renderer 이벤트 */
interface CoreEvents {
  'realtime:status': RealtimeStatus
  'messenger:activity': MessengerActivity
}
export interface IpcEvents extends CoreEvents, WikiAreaEvents, FilesAreaEvents, ChatAreaEvents, ShellAreaEvents {}

export type IpcEventName = keyof IpcEvents

const CORE_CHANNELS: (keyof CoreContract)[] = [
  'settings:get',
  'settings:save',
  'settings:testDooray',
  'settings:testMail',
  'ui:get',
  'ui:save',
  'messenger:me',
  'messenger:channels',
  'messenger:logs',
  'messenger:member',
  'messenger:searchMembers',
  'messenger:send',
  'messenger:update',
  'messenger:delete',
  'messenger:reply',
  'messenger:createThread',
  'messenger:threadFromMessage',
  'messenger:directSend',
  'messenger:createChannel',
  'messenger:downloadFile',
  'messenger:uploadFile',
  'realtime:status',
  'realtime:restart',
  'wiki:list',
  'wiki:pages',
  'wiki:page',
  'wiki:create',
  'wiki:update',
  'wiki:move',
  'wiki:delete',
  'wiki:comments',
  'wiki:addComment',
  'wiki:updateComment',
  'wiki:deleteComment',
  'wiki:uploadFile',
  'wiki:downloadFile',
  'mail:folders',
  'mail:list',
  'mail:get',
  'mail:setSeen',
  'mail:delete',
  'mail:downloadAttachment',
  'mail:send',
  'file:pick',
  'shell:openExternal'
]

export const IPC_CHANNELS: IpcChannel[] = [
  ...CORE_CHANNELS,
  ...WIKI_AREA_CHANNELS,
  ...FILES_AREA_CHANNELS,
  ...CHAT_AREA_CHANNELS,
  ...SHELL_AREA_CHANNELS
]

export const IPC_EVENTS: IpcEventName[] = [
  'realtime:status',
  'messenger:activity',
  ...WIKI_AREA_EVENTS,
  ...FILES_AREA_EVENTS,
  ...CHAT_AREA_EVENTS,
  ...SHELL_AREA_EVENTS
]

