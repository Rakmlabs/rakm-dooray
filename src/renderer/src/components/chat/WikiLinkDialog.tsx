// 입력창에서 위키 페이지를 골라 링크를 넣는다.
import { useState } from 'react'
import { useApp } from '../../state'
import { wikiPageUrl } from '../../lib/markdown'
import { Modal } from '../Modal'
import { WikiPagePicker, type PickedPage } from './WikiPagePicker'

export function WikiLinkDialog({ onPick, onClose }: { onPick: (markdown: string) => void; onClose: () => void }) {
  const { settings } = useApp()
  const [target, setTarget] = useState<PickedPage | null>(null)
  const domain = settings?.dooray.domain ?? 'rakm.dooray.com'
  const insert = () => {
    if (!target?.page) return
    const title = target.page.subject.replace(/[[\]]/g, '') || '위키 페이지'
    onPick(`[📄 ${title}](${wikiPageUrl(domain, target.wiki.id, target.page.id)})`)
  }
  return (
    <Modal title="위키 페이지 링크 넣기" onClose={onClose}>
      <div className="wiki-link-dialog">
        <WikiPagePicker value={target} onChange={setTarget} />
        <div className="muted small">앱에서는 링크를 누르면 위키 화면으로 바로 이동합니다. 두레이 웹·모바일에서는 해당 페이지 주소로 열립니다.</div>
        <div className="row end">
          <button onClick={onClose}>취소</button>
          <button className="primary" disabled={!target?.page} onClick={insert}>
            링크 넣기
          </button>
        </div>
      </div>
    </Modal>
  )
}
