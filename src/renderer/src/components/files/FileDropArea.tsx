// 파일 영역 소유. 대화방 본문을 감싸 드래그 앤 드롭·붙여넣기 업로드를 받는다 (Messenger 의 ChannelPane 이 감싼다).
// props 는 유지할 것. 지금은 아무 일도 하지 않는 껍데기.
import type { ReactNode } from 'react'

export function FileDropArea({ children }: { channelId: string; onUploaded: () => void; children: ReactNode }) {
  return <>{children}</>
}
