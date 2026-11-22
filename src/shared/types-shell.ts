// 셸 영역(⌘K, 대화방 폴더, 안 읽음·알림, 로컬 보관·검색, 창·트레이)이 main 과 renderer 사이에 주고받는 타입.
import type { SystemEvent } from './system-message'
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
  /** 마지막 메시지가 시스템 메시지면 그 내용 (화면에서 이름을 붙여 다시 쓴다) */
  lastSystem?: SystemEvent | null
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

/**
 * 데스크톱 알림 권한 (macOS 는 앱이 처음 알림을 만들 때 권한을 묻는다. Electron 에는 권한을 묻거나 조회하는 API 가 없어
 * 알림을 보낸 결과(전달됨/거절됨)로 판단한다).
 * - unknown: 아직 알림을 보낸 적이 없다
 * - asked: 권한을 물었다 (시스템 창에서 고르기 전일 수 있음)
 * - allowed: 마지막 알림이 전달됐다
 * - denied: 시스템이 거절했다 (시스템 설정 > 알림에서 꺼져 있음)
 * - unsupported: 이 실행에서는 알림을 쓸 수 없다 (서명 안 된 개발 실행 등)
 */
/**
 * macOS 알림 권한 (UNUserNotificationCenter 의 실제 상태를 앱 프로세스 안에서 읽는다).
 * - undecided: 아직 허용·거부를 고르지 않음 → 앱이 시작할 때 권한 창을 띄운다
 * - allowed: 허용됨 (배너·배지는 각각 꺼져 있을 수 있다 → banners, badge)
 * - denied: 거부됨·꺼짐 → 시스템 설정에서 켜야 한다
 * - unknown: 읽지 못함 (네이티브 모듈 없음 등)
 * - unsupported: 알림을 쓸 수 없음 (개발 실행 포함)
 */
export type NotifyPermissionState = 'undecided' | 'allowed' | 'denied' | 'unknown' | 'unsupported'

export interface NotifyPermission {
  state: NotifyPermissionState
  /** 화면에 보일 짧은 설명 (문제가 없으면 '') */
  detail: string
  /** 배너(알림 창)가 켜져 있는지 */
  banners: boolean
  /** Dock 배지가 켜져 있는지. macOS 는 알림 권한이 없으면 Dock 배지도 그리지 않는다 */
  badge: boolean
  /** 마지막으로 상태를 읽은 시각 */
  checkedAt: string | null
  /** 개발 실행(서명 안 된 Electron)이라 결과가 실제 앱과 다를 수 있음 */
  dev: boolean
}
