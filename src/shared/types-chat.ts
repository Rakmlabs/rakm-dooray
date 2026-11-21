// 채팅 영역(메시지 표시·프로필·입력 편의) 공유 타입. 이 영역 작업자만 고친다.

/**
 * 멤버 상세 (공식 GET /common/v1/members/{id}).
 * 공식 응답에는 프로필 사진·부서·직책이 없다. 그래서 사진 대신 이름 이니셜 아바타를 쓴다.
 */
export interface MemberProfile {
  id: string
  name: string
  email: string | null
  /** 사용자 ID (userCode) */
  userCode: string | null
  englishName: string | null
  nickname: string | null
  /** 멘션 링크(dooray://{조직ID}/members/{멤버ID})에 쓰는 조직 ID (defaultOrganization.id) */
  organizationId: string | null
}

/** 로컬 북마크. 내 컴퓨터(userData/chat-bookmarks.json)에만 저장된다. */
export interface ChatBookmark {
  /** `${channelId}:${messageId}` */
  key: string
  channelId: string
  messageId: string
  /** 스레드 안 메시지면 스레드가 달린 원래 대화방 */
  parentChannelId: string | null
  senderId: string | null
  sentAt: string | null
  /** 저장할 때의 본문 (앞부분만) */
  text: string
  savedAt: string
}

export interface LinkPreview {
  url: string
  /** 리다이렉트 후 최종 주소 */
  finalUrl: string
  siteName: string | null
  title: string | null
  description: string | null
  /** data: URL (작은 이미지만) */
  image: string | null
}

export interface ChatPrefs {
  /** 메시지 속 링크의 미리보기 카드 (main 이 외부 사이트에 요청한다) */
  linkPreview: boolean
}

/** 답장 메시지 ID → 원 메시지 (이 앱에서 보낸 답장만 안다) */
export interface ReplyRef {
  channelId: string
  replyId: string
  originalId: string
  originalSenderId: string | null
  originalText: string
}
