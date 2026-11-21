// 메시지 표시·프로필·입력 편의 영역의 IPC 계약. 이 영역 작업자만 고친다. ipc.ts 가 합친다.
// 채널 이름은 'chat:...' 처럼 영역 접두어를 붙인다. 형식: 'chat:이름': { args: [..]; result: .. }
import type { ChatBookmark, ChatPrefs, LinkPreview, MemberProfile, ReplyRef } from './types-chat'

export interface ChatAreaContract {
  /** 멤버 상세. 'me' 를 넣으면 나. 메모리·디스크 캐시 */
  'chat:profile': { args: [memberId: string]; result: MemberProfile }
  'chat:bookmarks': { args: []; result: ChatBookmark[] }
  'chat:addBookmark': { args: [ChatBookmark]; result: ChatBookmark[] }
  'chat:removeBookmark': { args: [key: string]; result: ChatBookmark[] }
  /** http(s) 주소의 제목·설명·대표 이미지. 실패·차단이면 null */
  'chat:linkPreview': { args: [url: string]; result: LinkPreview | null }
  'chat:prefs': { args: []; result: ChatPrefs }
  'chat:savePrefs': { args: [Partial<ChatPrefs>]; result: ChatPrefs }
  'chat:replyRefs': { args: [channelId: string]; result: ReplyRef[] }
  'chat:addReplyRef': { args: [ReplyRef]; result: null }
}

export const CHAT_AREA_CHANNELS: (keyof ChatAreaContract)[] = [
  'chat:profile',
  'chat:bookmarks',
  'chat:addBookmark',
  'chat:removeBookmark',
  'chat:linkPreview',
  'chat:prefs',
  'chat:savePrefs',
  'chat:replyRefs',
  'chat:addReplyRef'
]

/** main → renderer 이벤트 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ChatAreaEvents {}

export const CHAT_AREA_EVENTS: (keyof ChatAreaEvents)[] = []
