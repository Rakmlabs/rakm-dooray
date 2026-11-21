// Excel(xlsx) 보기: read-excel-file 로 값만 읽어 표로 보여준다 (서식·차트·수식 계산은 하지 않는다).
import { useState, type ReactNode } from 'react'
import readXlsxFile from 'read-excel-file/browser'
import type { FileItem } from '../model'
import { Loading, useParsed } from './common'
import { SheetTable, type Cell } from './SheetTable'

interface Sheet {
  name: string
  rows: Cell[][]
}

async function parse(buf: ArrayBuffer): Promise<Sheet[]> {
  const sheets = await readXlsxFile(new Blob([buf]))
  return sheets.map((s) => ({ name: s.sheet, rows: s.data as Cell[][] }))
}

export default function XlsxView({ f, fallback }: { f: FileItem; fallback: (reason: string) => ReactNode }) {
  const { data, error } = useParsed(f, parse)
  const [active, setActive] = useState(0)
  if (error) return <>{fallback(`표를 열지 못했습니다: ${error}`)}</>
  if (!data) return <Loading />
  const sheet = data[Math.min(active, data.length - 1)]
  return (
    <div className="xv">
      <SheetTable rows={sheet.rows} />
      {data.length > 1 && (
        <div className="xv-tabs" role="tablist" aria-label="시트">
          {data.map((s, i) => (
            <button key={s.name + i} role="tab" aria-selected={i === active} className={i === active ? 'active' : ''} onClick={() => setActive(i)}>
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
