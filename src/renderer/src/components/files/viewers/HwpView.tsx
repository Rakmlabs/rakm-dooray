// 한글(hwp/hwpx) 미리보기.
// - hwpx: zip 안 Contents/section*.xml 의 문단 글자 + Preview/PrvImage
// - hwp(5.x, OLE 복합 파일): 문서에 함께 저장되는 미리보기 글(PrvText)과 미리보기 그림(PrvImage)
// 서식·표 배치까지 재현하는 로컬 파서는 마땅치 않아 "글·첫 쪽 그림" 수준이다. 전체는 Quick Look·기본 앱으로.
import type { ReactNode } from 'react'
import JSZip from 'jszip'
import CFB from 'cfb'
import type { FileItem } from '../model'
import { cleanPrvText, imageMime, naturalCompare, utf16le } from '../parsers'
import { BlobImage, Loading, useParsed } from './common'

interface HwpPreview {
  paragraphs: string[]
  image: Blob | null
  /** 본문 전체가 아니라 미리보기 글만 있는 경우 */
  partial: boolean
}

async function parseHwpx(buf: ArrayBuffer): Promise<HwpPreview> {
  const zip = await JSZip.loadAsync(buf)
  const sections = Object.keys(zip.files)
    .filter((n) => /^Contents\/section\d+\.xml$/i.test(n))
    .sort(naturalCompare)
  const paragraphs: string[] = []
  for (const s of sections) {
    const doc = new DOMParser().parseFromString(await zip.file(s)!.async('string'), 'application/xml')
    // 표 안 문단이 바깥 문단과 겹치지 않게: 글자(t)마다 가장 가까운 문단(p)에 모은다
    const byP = new Map<Element, string>()
    const order: Element[] = []
    for (const t of Array.from(doc.getElementsByTagName('*')).filter((e) => e.localName === 't')) {
      let p: Element | null = t.parentElement
      while (p && p.localName !== 'p') p = p.parentElement
      if (!p) continue
      if (!byP.has(p)) {
        byP.set(p, '')
        order.push(p)
      }
      byP.set(p, byP.get(p)! + (t.textContent ?? ''))
    }
    // 글자가 없는 문단은 빈 줄로
    for (const p of Array.from(doc.getElementsByTagName('*')).filter((e) => e.localName === 'p')) {
      if (!byP.has(p) && !hasAncestorP(p)) order.push(p)
    }
    order.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
    for (const p of order) paragraphs.push(byP.get(p) ?? '')
  }
  const img = zip.file(/^Preview\/PrvImage\.(png|gif|bmp|jpe?g)$/i)[0]
  let partial = false
  if (paragraphs.join('').trim() === '') {
    const prv = zip.file('Preview/PrvText.txt')
    if (prv) {
      paragraphs.push(...cleanPrvText(await prv.async('string')).split('\n'))
      partial = true
    }
  }
  return { paragraphs: trimEmpty(paragraphs), image: img ? await img.async('blob') : null, partial }
}

function hasAncestorP(e: Element): boolean {
  for (let p = e.parentElement; p; p = p.parentElement) if (p.localName === 'p') return true
  return false
}

function parseHwp(buf: ArrayBuffer): HwpPreview {
  const cfb = CFB.read(new Uint8Array(buf), { type: 'array' })
  const header = CFB.find(cfb, 'FileHeader')
  const sig = header?.content ? new TextDecoder('latin1').decode(Uint8Array.from((header.content as ArrayLike<number>)).slice(0, 17)) : ''
  if (sig !== 'HWP Document File') throw new Error('한글 5.0 이후 형식이 아닙니다 (예전 한글 3.0 파일일 수 있습니다).')
  const text = CFB.find(cfb, 'PrvText')
  const img = CFB.find(cfb, 'PrvImage')
  const paragraphs = text?.content ? cleanPrvText(utf16le(Uint8Array.from(text.content as ArrayLike<number>))).split('\n') : []
  let image: Blob | null = null
  if (img?.content) {
    const bytes = Uint8Array.from(img.content as ArrayLike<number>)
    const mime = imageMime(bytes)
    if (mime) image = new Blob([bytes], { type: mime })
  }
  if (paragraphs.length === 0 && !image) throw new Error('문서에 미리보기 정보가 없습니다.')
  return { paragraphs: trimEmpty(paragraphs), image, partial: true }
}

function trimEmpty(list: string[]): string[] {
  const out = [...list]
  while (out.length && !out[0].trim()) out.shift()
  while (out.length && !out[out.length - 1].trim()) out.pop()
  return out
}

const parseFor = (kind: string) => (buf: ArrayBuffer) => (kind === 'hwpx' ? parseHwpx(buf) : Promise.resolve(parseHwp(buf)))
const parsers = { hwp: parseFor('hwp'), hwpx: parseFor('hwpx') }

export default function HwpView({ f, fallback }: { f: FileItem; fallback: (reason: string) => ReactNode }) {
  const { data, error } = useParsed(f, f.kind === 'hwpx' ? parsers.hwpx : parsers.hwp)
  if (error) return <>{fallback(`한글 문서를 열지 못했습니다: ${error}`)}</>
  if (!data) return <Loading />
  return (
    <div className="hv">
      <div className="sv-note muted small">
        {data.partial
          ? '한글 문서에 함께 저장된 미리보기(첫 부분 글·첫 쪽 그림)입니다. 전체 내용과 서식은 미리보기나 한글에서 여세요.'
          : '문단 글자만 뽑은 미리보기입니다. 표 배치·서식은 미리보기나 한글에서 확인하세요.'}
      </div>
      <div className="hv-page">
        {data.image && (
          <div className="hv-image">
            <BlobImage blob={data.image} alt="첫 쪽 미리보기" />
          </div>
        )}
        <div className="hv-text">
          {data.paragraphs.map((p, i) => (p.trim() ? <p key={i}>{p}</p> : <br key={i} />))}
        </div>
      </div>
    </div>
  )
}
