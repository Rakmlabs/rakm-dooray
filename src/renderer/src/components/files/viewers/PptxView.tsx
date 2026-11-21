// PowerPoint(pptx) 미리보기: 슬라이드별 제목·글·그림만 뽑아 보여준다 (배치·애니메이션은 재현하지 않는다).
import type { ReactNode } from 'react'
import JSZip from 'jszip'
import type { FileItem } from '../model'
import { naturalCompare, resolveZipPath } from '../parsers'
import { BlobImage, Loading, useParsed } from './common'

interface Slide {
  title: string
  paragraphs: { text: string; level: number }[]
  images: Blob[]
  notes: string
}

const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function xml(s: string): Document {
  return new DOMParser().parseFromString(s, 'application/xml')
}

async function rels(zip: JSZip, file: string): Promise<Map<string, string>> {
  const dir = file.split('/').slice(0, -1).join('/')
  const base = file.split('/').pop()!
  const r = zip.file(`${dir}/_rels/${base}.rels`)
  const m = new Map<string, string>()
  if (!r) return m
  for (const el of Array.from(xml(await r.async('string')).getElementsByTagName('Relationship'))) {
    const id = el.getAttribute('Id')
    const target = el.getAttribute('Target')
    if (id && target && el.getAttribute('TargetMode') !== 'External') m.set(id, resolveZipPath(file, target))
  }
  return m
}

function paragraphsOf(root: Element | Document): { text: string; level: number }[] {
  return Array.from(root.getElementsByTagNameNS(NS_A, 'p'))
    .map((p) => {
      const text = Array.from(p.getElementsByTagNameNS(NS_A, 't'))
        .map((t) => t.textContent ?? '')
        .join('')
      const lvl = Number(p.getElementsByTagNameNS(NS_A, 'pPr')[0]?.getAttribute('lvl') ?? 0) || 0
      return { text, level: lvl }
    })
    .filter((p) => p.text.trim() !== '')
}

async function parse(buf: ArrayBuffer): Promise<Slide[]> {
  const zip = await JSZip.loadAsync(buf)
  // 발표 순서: presentation.xml 의 sldIdLst. 없으면 파일 이름 순서.
  let order: string[] = []
  const pres = zip.file('ppt/presentation.xml')
  if (pres) {
    const presRels = await rels(zip, 'ppt/presentation.xml')
    const doc = xml(await pres.async('string'))
    order = Array.from(doc.getElementsByTagName('p:sldId'))
      .map((s) => presRels.get(s.getAttributeNS(NS_R, 'id') ?? s.getAttribute('r:id') ?? '') ?? '')
      .filter((p) => !!zip.file(p))
  }
  if (order.length === 0) order = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort(naturalCompare)

  const slides: Slide[] = []
  for (const path of order) {
    const doc = xml(await zip.file(path)!.async('string'))
    const r = await rels(zip, path)
    let title = ''
    const body: { text: string; level: number }[] = []
    for (const sp of Array.from(doc.getElementsByTagName('p:sp'))) {
      const ph = sp.getElementsByTagName('p:ph')[0]
      const type = ph?.getAttribute('type') ?? ''
      const paras = paragraphsOf(sp)
      if (!title && (type === 'title' || type === 'ctrTitle')) title = paras.map((p) => p.text).join(' ')
      else body.push(...paras)
    }
    // 표 안 글자
    for (const tbl of Array.from(doc.getElementsByTagNameNS(NS_A, 'tbl'))) body.push(...paragraphsOf(tbl))
    const images: Blob[] = []
    for (const blip of Array.from(doc.getElementsByTagNameNS(NS_A, 'blip'))) {
      const target = r.get(blip.getAttributeNS(NS_R, 'embed') ?? '')
      const f = target ? zip.file(target) : null
      if (f && /\.(png|jpe?g|gif|bmp|webp)$/i.test(target!)) images.push(await f.async('blob'))
    }
    // 발표자 메모
    let notes = ''
    for (const [, t] of r) {
      if (/notesSlides\/notesSlide\d+\.xml$/.test(t) && zip.file(t)) {
        const nd = xml(await zip.file(t)!.async('string'))
        notes = Array.from(nd.getElementsByTagName('p:sp'))
          .filter((sp) => sp.getElementsByTagName('p:ph')[0]?.getAttribute('type') === 'body')
          .flatMap((sp) => paragraphsOf(sp).map((p) => p.text))
          .join('\n')
      }
    }
    slides.push({ title, paragraphs: body, images, notes })
  }
  return slides
}

export default function PptxView({ f, fallback }: { f: FileItem; fallback: (reason: string) => ReactNode }) {
  const { data, error } = useParsed(f, parse)
  if (error) return <>{fallback(`발표 자료를 열지 못했습니다: ${error}`)}</>
  if (!data) return <Loading />
  if (data.length === 0) return <>{fallback('슬라이드를 찾지 못했습니다.')}</>
  return (
    <div className="sv">
      <div className="sv-note muted small">글과 그림만 뽑은 미리보기입니다. 배치·디자인은 기본 앱이나 미리보기로 확인하세요.</div>
      {data.map((s, i) => (
        <section className="sv-slide" key={i} aria-label={`슬라이드 ${i + 1}`}>
          <div className="sv-no">{i + 1}</div>
          <div className="sv-content">
            {s.title && <h2>{s.title}</h2>}
            {s.paragraphs.length > 0 && (
              <ul>
                {s.paragraphs.map((p, j) => (
                  <li key={j} style={{ marginLeft: p.level * 18 }}>
                    {p.text}
                  </li>
                ))}
              </ul>
            )}
            {s.images.length > 0 && (
              <div className="sv-images">
                {s.images.map((b, j) => (
                  <BlobImage key={j} blob={b} />
                ))}
              </div>
            )}
            {!s.title && s.paragraphs.length === 0 && s.images.length === 0 && <span className="muted">(글자·그림 없음)</span>}
          </div>
          {s.notes && <div className="sv-notes">메모: {s.notes}</div>}
        </section>
      ))}
    </div>
  )
}
