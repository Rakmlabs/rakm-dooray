// 셸 영역(⌘K, 대화방 폴더, 안 읽음·알림, 로컬 보관·검색, 창·트레이)이 main 과 renderer 사이에 주고받는 타입.
import type { Channel, Member, Message } from './types'

export type ThemePref = 'system' | 'light' | 'dark'
export type FontSizePref = 'small' | 'normal' | 'large'

/** 이 컴퓨터에만 저장되는 앱 설정 (main 이 창·트레이·알림에 바로 적용한다) */
export interface ShellPrefs {
  theme: ThemePref
  fontSize: FontSizePref
  /** 메뉴 막대(트레이)에 상주. 창을 닫아도 앱이 남아 알림을 받는다 */
  tray: boolean
  /** 로그인 시 자동 실행 (설치한 앱에서만 적용) */
  openAtLogin: boolean
  notify: {
    enabled: boolean
    /** 알림에 메시지 내용 보이기 (끄면 "새 메시지" 만) */
    preview: boolean
    sound: boolean
    /** 알림을 끈 대화방 */
    muted: string[]
  }
}

/** 화면 이동 대상 (renderer lib/nav.ts 의 NavRequest 와 같은 모양) */
export type NavTarget =
  | { kind: 'channel'; channelId: string; messageId?: string }
  | { kind: 'thread'; channelId: string; threadChannelId: string }
  | { kind: 'direct'; memberId: string }
  | { kind: 'wikiPage'; wikiId: string; pageId: string }
  | { kind: 'settings' }

/** ⌘K 의 "최근" 목록 */
export interface RecentItem {
  key: string
  label: string
  sub?: string
  target: NavTarget
  at: number
}

export interface ShellLayout {
  /** 즐겨찾기(고정) 대화방, 표시 순서 */
  favorites: string[]
  /** 섹션 키 → 사용자가 끌어서 정한 대화방 순서 (없는 것은 최근 순으로 뒤에) */
  order: Record<string, string[]>
  /** 접은 섹션 키 */
  collapsed: string[]
  recent: RecentItem[]
  /** 마지막으로 보던 곳 */
  last: { tab: 'messenger' | 'wiki'; channelId: string | null }
}

export interface ShellState {
  prefs: ShellPrefs
  layout: ShellLayout
}

/** 대화방 한 줄에 필요한 로컬 계산 값 */
export interface ChannelSummary {
  /** 로컬 추정 안 읽은 수 (두레이에는 읽음 API 가 없다) */
  unread: number
  lastAt: string | null
  lastText: string
  lastSenderId: string | null
  /** 마지막으로 읽은 시각 (ISO) */
  readAt: string | null
}

export interface UnreadPayload {
  summaries: Record<string, ChannelSummary>
  total: number
}

/** 로컬 보관함 + 서버를 합친 메시지 묶음 */
export interface HistoryPage {
  messages: Message[]
  /** 보관함에 더 오래된 것이 남아 있음 */
  hasOlder: boolean
  /** 이번에 서버가 돌려준 개수 */
  serverCount: number
  /** 서버에서 못 받았을 때의 이유 (보관함 내용은 그대로 돌려준다) */
  error: string | null
}

export interface MessageHit {
  message: Message
  /** 스레드 안 메시지면 부모 대화방 */
  parentChannelId: string | null
}

export interface WikiIndexEntry {
  id: string
  wikiId: string
  wikiName: string
  parentPageId: string | null
  subject: string
  /** 위키 이름 › 상위 › 페이지 */
  path: string
}

export interface WikiHit extends WikiIndexEntry {
  /** 본문에서 찾았을 때 앞뒤 문장 (열어 본 적 있는 페이지만 본문이 있다) */
  snippet: string | null
}

export interface SearchResult {
  messages: MessageHit[]
  wiki: WikiHit[]
}

export interface QuickData {
  channels: Channel[]
  members: Member[]
  wikiPages: WikiIndexEntry[]
  meId: string | null
}

export interface IndexStatus {
  messages: number
  channels: number
  wikiPages: number
  wikiBodies: number
  crawling: boolean
  storage: string
}

export interface ConnectionState {
  online: boolean
  detail: string
}
