// 메시지를 위키로 보내기: 새 페이지로 만들거나 기존 페이지 끝에 덧붙인다.
// 덧붙이기는 보내기 직전에 최신 본문을 다시 읽고, 그 끝에 추가만 한다 (기존 내용·제목은 바꾸지 않는다).
import { useMemo, useState } from 'react'
import type { Message } from '@shared/types'
import { call, errorText } from '../../api'
import { useMemberNames } from '../../state'
import { navigate } from '../../lib/nav'
import { Modal } from '../Modal'
import { WikiPagePicker, type PickedPage } from './WikiPagePicker'
import { plainSummary } from './chatStore'
import { appendToContent, messageToWikiBlock } from './wikiText'

export function WikiSendDialog({ messages, onClose }: { messages: Message[]; onClose: () => void }) {
  const nameOf = useMemberNames()
  const first = messages[0]
  const [mode, setMode] = useState<'new' | 'append'>('new')
  const [target, setTarget] = useState<PickedPage | null>(null)
  const [subject, setSubject] = useState(() => plainSummary(first?.text || first?.file?.name || '메신저 메모', 60))
  const initialBlock = useMemo(
    () => messages.map((m) => messageToWikiBlock(m, m.senderType === 'app' ? '봇' : (nameOf(m.senderId) ?? '알 수 없음'))).join('\n'),
    // 이름이 늦게 도착해도 처음 만든 내용을 유지한다 (사용자가 고치는 중일 수 있음)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )
  const [content, setContent] = useState(initialBlock)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ wikiId: string; pageId: string; subject: string } | null>(null)

  const canSave = !!target && !!content.trim() && (mode === 'append' ? !!target.page : !!subject.trim())

  async function save() {
    if (!target || !canSave) return
    setBusy(true)
    setError(null)
    try {
      if (mode === 'new') {
        const parent = target.page?.id ?? target.wiki.homePageId ?? null
        const r = await call('wiki:create', target.wiki.id, parent, subject.trim(), content)
        setDone({ wikiId: target.wiki.id, pageId: r.id, subject: subject.trim() })
      } else {
        const page = await call('wiki:page', target.wiki.id, target.page!.id)
        await call('wiki:update', target.wiki.id, page.id, page.subject, appendToContent(page.content, content))
        setDone({ wikiId: target.wiki.id, pageId: page.id, subject: page.subject })
      }
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="위키로 보내기" onClose={onClose} wide>
      {done ? (
        <div className="wiki-send-done">
          <p>
            <b>{done.subject}</b> 페이지에 {mode === 'new' ? '새로 만들었습니다' : '덧붙였습니다'}.
          </p>
          <div className="row">
            <button
              className="primary"
              onClick={() => {
                navigate({ kind: 'wikiPage', wikiId: done.wikiId, pageId: done.pageId })
                onClose()
              }}
            >
              위키에서 보기
            </button>
            <button onClick={onClose}>닫기</button>
          </div>
        </div>
      ) : (
        <div className="wiki-send">
          <div className="seg-toggle" role="radiogroup" aria-label="보내는 방법">
            <button role="radio" aria-checked={mode === 'new'} className={mode === 'new' ? 'active' : ''} onClick={() => setMode('new')}>
              새 페이지로 만들기
            </button>
            <button role="radio" aria-checked={mode === 'append'} className={mode === 'append' ? 'active' : ''} onClick={() => setMode('append')}>
              기존 페이지 끝에 덧붙이기
            </button>
          </div>
          <div className="wiki-send-grid">
            <div>
              <div className="field-label">{mode === 'new' ? '어디 아래에 만들까요? (상위 페이지)' : '어느 페이지에 덧붙일까요?'}</div>
              <WikiPagePicker value={target} onChange={setTarget} allowWikiRoot={mode === 'new'} />
            </div>
            <div className="wiki-send-form">
              {mode === 'new' ? (
                <label>
                  <span>새 페이지 제목</span>
                  <input value={subject} onChange={(e) => setSubject(e.target.value)} />
                </label>
              ) : (
                <div className="muted small">
                  {target?.page ? (
                    <>
                      <b>{target.page.subject}</b> 의 기존 본문은 그대로 두고, 맨 끝에 구분선과 아래 내용만 추가합니다.
                    </>
                  ) : (
                    '왼쪽에서 페이지를 고르세요.'
                  )}
                </div>
              )}
              <label className="grow-label">
                <span>{mode === 'new' ? '본문 (마크다운)' : '덧붙일 내용 (마크다운)'}</span>
                <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={10} />
              </label>
              {mode === 'new' && target && (
                <div className="muted small">
                  위치: {target.wiki.name}
                  {target.page ? ` › ${target.page.subject}` : ' (맨 위)'}
                </div>
              )}
              {error && <div className="banner banner-err">{error}</div>}
              <div className="row end">
                <button onClick={onClose}>취소</button>
                <button className="primary" disabled={!canSave || busy} onClick={() => void save()}>
                  {busy ? '보내는 중…' : mode === 'new' ? '페이지 만들기' : '덧붙이기'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}
