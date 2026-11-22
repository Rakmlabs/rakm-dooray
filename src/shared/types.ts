// main 과 renderer 가 함께 쓰는 타입. 비밀 값(토큰, 비밀번호)은 여기 어떤 타입에도 renderer 쪽으로 실리지 않는다.

export type SecretSource = 'keychain' | 'env' | 'none'

export interface PublicSettings {
  dooray: {
    /** 고정값 (api.dooray.com, rakm.dooray.com). 화면에서 바꾸지 않는다. */
    apiBase: string
    domain: string
    tokenSource: SecretSource
  }
  mail: {
    address: string
    displayName: string
    imapHost: string
    imapPort: number
    smtpHost: string
    smtpPort: number
    passwordSource: SecretSource
  }
  /** OS 키체인 암호화를 쓸 수 있는지. false 면 비밀 값 저장을 거부한다. */
  secureStorage: boolean
}

export interface SettingsInput {
  dooray?: {
    /** 문자열이면 저장, null 이면 삭제, undefined 면 유지 */
    token?: string | null
  }
  mail?: {
    address?: string
    displayName?: string
    imapHost?: string
    imapPort?: number
    smtpHost?: string
    smtpPort?: number
    password?: string | null
  }
}

export interface TestResult {
  ok: boolean
  message: string
}

// ---------- 로컬 UI 상태 (서버 없음, 각자 컴퓨터에만 저장) ----------

export interface ProjectGroup {
  id: string
  name: string
  color: string
}

export interface UiState {
  projects: ProjectGroup[]
  /** channelId → projectId */
  channelProject: Record<string, string>
  /** channelId → 마지막으로 열어 본 시점의 채널 updatedAt (안 읽음 근사 계산용) */
  lastSeenAt: Record<string, string>
  /** 숨긴 채널 */
  hiddenChannels: string[]
}

// ---------- 메신저 ----------

export type ChannelType = 'direct' | 'private' | 'me' | 'bot' | string

export interface Channel {
  id: string
  title: string
  type: ChannelType
  status: string
  updatedAt: string | null
  participantIds: string[]
  meId: string | null
}

export interface ThreadInfo {
  channelId: string
  totalCount: number
  lastUpdatedAt: number | null
}

export interface MessageFile {
  id: string
  name: string
  size: number | null
  mimeType: string | null
}

export interface Message {
  id: string
  channelId: string
  seq: number
  type: string
  senderId: string | null
  senderType: string | null
  sentAt: string | null
  text: string
  flags: string | null
  file: MessageFile | null
  thread: ThreadInfo | null
}

export interface Member {
  id: string
  name: string
  email: string | null
}

export type RealtimeMode = 'socket' | 'polling' | 'off'

export interface RealtimeStatus {
  mode: RealtimeMode
  detail: string
}

export interface MessengerActivity {
  channelId: string
}

// ---------- 위키 ----------

export interface Wiki {
  id: string
  name: string
  projectId: string | null
  homePageId: string | null
  type: string
  scope: string
}

export interface WikiPageSummary {
  id: string
  wikiId: string
  parentPageId: string | null
  subject: string
  root: boolean
  version: string
}

export interface WikiFile {
  id: string
  name: string
  size: number | null
  attachFileId: string | null
}

export interface WikiPage extends WikiPageSummary {
  content: string
  mimeType: string
  createdAt: string | null
  updatedAt: string | null
  creatorId: string | null
  files: WikiFile[]
  images: WikiFile[]
}

export interface WikiComment {
  id: string
  creatorId: string | null
  createdAt: string | null
  modifiedAt: string | null
  content: string
}

// ---------- 메일 ----------

export interface MailAddress {
  name: string
  address: string
}

export interface MailFolder {
  path: string
  name: string
  specialUse: string | null
  depth: number
}

export interface MailSummary {
  uid: number
  subject: string
  from: MailAddress[]
  to: MailAddress[]
  date: string | null
  seen: boolean
  flagged: boolean
  hasAttachments: boolean
  size: number
}

export interface MailPage {
  folder: string
  total: number
  page: number
  pageSize: number
  items: MailSummary[]
}

export interface MailAttachment {
  index: number
  filename: string
  contentType: string
  size: number
}

export interface MailDetail {
  uid: number
  folder: string
  subject: string
  from: MailAddress[]
  to: MailAddress[]
  cc: MailAddress[]
  replyTo: MailAddress[]
  date: string | null
  messageId: string | null
  references: string[]
  html: string | null
  text: string | null
  attachments: MailAttachment[]
}

export interface ComposeInput {
  to: string
  cc: string
  bcc: string
  subject: string
  text: string
  attachmentPaths: string[]
  inReplyTo?: string | null
  references?: string[]
}
