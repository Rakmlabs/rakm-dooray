// 파일 영역 소유. 방별 "파일 모아보기" (사진/동영상/문서). Messenger 의 대화방 머리글 버튼이 연다. props 는 유지할 것.
import type { Message } from '@shared/types'
import { Modal } from '../Modal'

export function FileGallery({ onClose }: { channelId: string; messages: Message[]; onClose: () => void }) {
  return (
    <Modal title="파일 모아보기" onClose={onClose}>
      <p className="muted">준비 중</p>
    </Modal>
  )
}
