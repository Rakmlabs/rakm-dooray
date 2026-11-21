// 파일 영역 소유. 설정 화면에 들어가는 파일 관련 설정 카드 (캐시 용량 등). Settings 가 그대로 넣는다.
import { useEffect, useState } from 'react'
import { CACHE_LIMIT_CHOICES_MB, type FileCacheStats } from '@shared/types-files'
import { call, errorText } from '../../api'
import { formatSize } from '../../lib/format'

const mbLabel = (mb: number) => (mb >= 1024 ? `${mb / 1024}GB` : `${mb}MB`)

export function FileSettings() {
  const [stats, setStats] = useState<FileCacheStats | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null)

  useEffect(() => {
    call('files:cacheStats')
      .then(setStats)
      .catch((e) => setMsg({ text: errorText(e), err: true }))
  }, [])

  async function run(p: Promise<FileCacheStats>, done: string) {
    setBusy(true)
    setMsg(null)
    try {
      setStats(await p)
      setMsg({ text: done, err: false })
    } catch (e) {
      setMsg({ text: errorText(e), err: true })
    } finally {
      setBusy(false)
    }
  }

  const limitMB = stats ? Math.round(stats.limitBytes / 1024 / 1024) : null
  const pct = stats ? Math.min(100, (stats.bytes / Math.max(1, stats.limitBytes)) * 100) : 0
  return (
    <div className="card fset">
      <h2>파일</h2>
      <p className="muted small fset-desc">
        대화방에서 연 파일은 다음에 빨리 열리도록 이 컴퓨터(앱 데이터 폴더)에만 보관합니다. 다른 곳으로 보내지 않습니다.
      </p>
      <div className="fset-usage">
        <div className="fset-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label="보관 용량 사용량">
          <span style={{ width: `${pct}%` }} />
        </div>
        <small>
          {stats ? `${formatSize(stats.bytes) || '0 B'} / ${mbLabel(limitMB!)} 사용 · 파일 ${stats.count}개` : '확인하는 중…'}
        </small>
      </div>
      <label>
        <span>보관 용량 상한</span>
        <select
          value={limitMB ?? ''}
          disabled={!stats || busy}
          onChange={(e) => void run(call('files:setCacheLimit', Number(e.target.value)), '상한을 바꿨습니다. 넘치는 파일은 오래 안 연 것부터 지웁니다.')}
        >
          {CACHE_LIMIT_CHOICES_MB.map((mb) => (
            <option key={mb} value={mb}>
              {mbLabel(mb)}
            </option>
          ))}
        </select>
        <small>넘치면 가장 오래 안 연 파일부터 자동으로 지웁니다.</small>
      </label>
      <div className="row">
        <button disabled={!stats || busy || stats.count === 0} onClick={() => void run(call('files:clearCache'), '보관한 파일을 모두 지웠습니다.')}>
          보관한 파일 비우기
        </button>
        {msg && <span className={msg.err ? 'err' : 'ok'}>{msg.text}</span>}
      </div>
    </div>
  )
}
