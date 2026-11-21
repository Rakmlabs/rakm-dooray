// 파일 영역 소유. 메시지에 붙은 파일 하나를 보여준다 (MessageList 가 부른다). props 는 유지할 것.
import type { Message } from '@shared/types'
import { call, errorText } from '../../api'
import { useApp } from '../../state'
import { formatSize } from '../../lib/format'
import { Icon } from '../Icon'

export function FileAttachment({ message }: { message: Message }) {
  const { toast } = useApp()
  const f = message.file
  if (!f) return null
  async function download() {
    try {
      const saved = await call('messenger:downloadFile', message.channelId, f!.id, f!.name)
      if (saved) toast(`저장했습니다: ${saved}`, 'info')
    } catch (e) {
      toast(errorText(e))
    }
  }
  return (
    <button className="file-chip" onClick={() => void download()} title="내려받기">
      <Icon name="clip" size={14} />
      <span>{f.name}</span>
      {f.size !== null && <span className="muted">{formatSize(f.size)}</span>}
    </button>
  )
}
