import { useEffect, useState } from 'react'
import type { ReceiptsStatus } from '@shared/types-receipts'
import { call, errorText, onEvent } from '../api'
import { useApp } from '../state'
import { Toggle } from '../shell/ShellSettings'

function timeText(iso: string | null): string {
  return iso ? new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '아직 없음'
}

/** 설정 > 읽음 확인: 켜기/끄기, 저장 위치, 자동으로 못 정했을 때 위키 고르기 */
export function ReceiptsSettings() {
  const { toast } = useApp()
  const [st, setSt] = useState<ReceiptsStatus | null>(null)
  const [choices, setChoices] = useState<{ id: string; name: string }[] | null>(null)
  const [pick, setPick] = useState('')

  useEffect(() => {
    void call('receipts:status')
      .then(setSt)
      .catch(() => {})
    return onEvent('receipts:status', setSt)
  }, [])

  const needChoice = st?.state === 'needsChoice' || st?.state === 'error' || !!st?.manual
  useEffect(() => {
    if (!needChoice || choices) return
    void call('receipts:wikiChoices')
      .then((l) => {
        setChoices(l)
        setPick((p) => p || l[0]?.id || '')
      })
      .catch(() => {})
  }, [needChoice, choices])

  if (!st) return null
  const run = (p: Promise<ReceiptsStatus>) =>
    void p.then(setSt).catch((e) => toast(errorText(e)))

  return (
    <div className="card" id="receipts-settings">
      <h2>읽음 확인</h2>
      <Toggle
        checked={st.enabled}
        onChange={(v) => run(call('receipts:setEnabled', v))}
        label="상대가 내 메시지를 읽었는지 보기"
        hint="내 메시지 옆에 아직 안 읽은 사람 수가 떴다가 읽으면 사라집니다. 상대도 이 앱에서 이 기능을 켜 둬야 하고, 상대가 두레이 모바일·웹에서 읽은 것은 알 수 없습니다(그 뒤에 상대가 답을 보냈으면 읽은 것으로 봅니다)."
      />
      {st.enabled && (
        <div className="receipts-where">
          {st.state === 'ready' && st.location ? (
            <>
              <div>
                저장 위치: 위키 <b>{st.location.wikiName}</b> › {st.location.rootTitle}
              </div>
              <div className="muted small">
                두 사람의 앱이 이 페이지 아래에 각자 “읽음 위치 · 이름” 페이지를 하나씩 두고, 읽은 대화방과 마지막 메시지 번호만 씁니다 (메시지 내용 없음).
                읽은 위치가 바뀌었을 때만 30초에 한 번까지 고칩니다.
              </div>
              <div className="muted small">
                기록을 찾은 상대 {st.peerCount}명 · 마지막으로 쓴 때 {timeText(st.lastWriteAt)} · 마지막으로 읽은 때 {timeText(st.lastReadAt)}
              </div>
            </>
          ) : (
            <div className={st.state === 'error' || st.state === 'needsChoice' ? 'err' : 'muted'}>{st.detail || '준비 중…'}</div>
          )}
          {needChoice && choices && (
            <div className="row">
              <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="저장할 위키">
                {choices.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
              <button type="button" disabled={!pick} onClick={() => run(call('receipts:chooseWiki', pick))}>
                이 위키에 저장
              </button>
              {st.manual && (
                <button type="button" className="link" onClick={() => run(call('receipts:chooseWiki', null))}>
                  자동으로 정하기
                </button>
              )}
            </div>
          )}
          {needChoice && <div className="muted small">상대도 같은 위키를 골라야 서로의 기록이 보입니다.</div>}
        </div>
      )}
    </div>
  )
}
