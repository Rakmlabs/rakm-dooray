// 위키 영역 공유 타입 (renderer ↔ main)

export interface WikiSaveRequest {
  /** 바꿀 제목. 바꾸지 않으면 null */
  subject: string | null
  /** 바꿀 본문(마크다운). 바꾸지 않으면 null */
  content: string | null
  /** 처음 읽은(또는 마지막으로 저장한) 서버 버전 */
  baseVersion: string
  baseUpdatedAt: string | null
  /** 서버가 바뀌었어도 덮어쓴다 (사용자가 고른 경우만) */
  force: boolean
}

export interface WikiServerCopy {
  version: string
  updatedAt: string | null
  subject: string
  content: string
}

export type WikiSaveResult =
  | ({ status: 'saved' } & WikiServerCopy)
  /** 처음 읽은 뒤 다른 사람이 고쳤다. 덮어쓰지 않았다. */
  | { status: 'conflict'; server: WikiServerCopy }

export type WikiBackupKind = 'before-first-save' | 'mine-before-reload' | 'unsaved-on-close' | 'before-restore'

export interface WikiBackup {
  id: string
  pageId: string
  wikiId: string
  kind: WikiBackupKind
  subject: string
  content: string
  version: string
  savedAt: string
}

export interface WikiUploadedImage {
  /** 본문 마크다운에 넣을 경로: /wikis/{wikiId}/files/{attachFileId} */
  src: string
  name: string
}
