// 메시지 → 위키 본문 변환. DOM 없이 테스트할 수 있게 따로 둔다.
import type { Message } from '@shared/types'

/** 위키에 넣을 마크다운 블록. 멘션 링크(dooray://)는 위키에서 의미가 없어 @이름 으로 바꾼다. */
export function messageToWikiBlock(m: Message, sender: string): string {
  const when = m.sentAt ? new Date(m.sentAt).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }) : ''
  const body = (m.text || (m.file ? `(첨부 파일: ${m.file.name})` : '')).replace(/\[@([^\]]+)\]\(dooray:\/\/[^)]*\)/g, '@$1')
  return `#### ${sender}${when ? ` · ${when}` : ''} (메신저)\n\n${body.trim()}\n`
}

/** 기존 본문 끝에 덧붙인 결과. 기존 내용은 한 글자도 바꾸지 않는다. */
export function appendToContent(existing: string, block: string): string {
  if (!existing) return block
  const sep = existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n'
  return `${existing}${sep}---\n\n${block}`
}
