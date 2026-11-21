// 행·열 머리글이 붙은 표 (Excel·CSV 공용)
import { columnName } from '../parsers'

export type Cell = string | number | boolean | Date | null

const MAX_ROWS = 3000

export function cellText(v: Cell): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) {
    const hasTime = v.getUTCHours() + v.getUTCMinutes() + v.getUTCSeconds() > 0
    return hasTime ? v.toLocaleString('ko-KR', { timeZone: 'UTC' }) : v.toLocaleDateString('ko-KR', { timeZone: 'UTC' })
  }
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString('ko-KR') : String(Math.round(v * 1e6) / 1e6)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return String(v)
}

/** 행·열 머리글이 붙은 표 (CSV 도 같이 쓴다) */
export function SheetTable({ rows, header = false }: { rows: Cell[][]; header?: boolean }) {
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0)
  const shown = rows.slice(0, MAX_ROWS)
  if (rows.length === 0) return <div className="fv-center muted">빈 시트입니다.</div>
  return (
    <div className="xv-scroll">
      <table className="xv-table">
        <thead>
          <tr>
            <th className="corner" />
            {Array.from({ length: cols }, (_, i) => (
              <th key={i}>{columnName(i)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r, ri) => (
            <tr key={ri} className={header && ri === 0 ? 'head-row' : ''}>
              <th>{ri + 1}</th>
              {Array.from({ length: cols }, (_, ci) => {
                const v = r[ci] ?? null
                return (
                  <td key={ci} className={typeof v === 'number' ? 'num' : ''}>
                    {cellText(v)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > MAX_ROWS && <div className="muted small xv-more">처음 {MAX_ROWS.toLocaleString()}행까지만 보여줍니다. 전체는 기본 앱으로 여세요.</div>}
    </div>
  )
}
