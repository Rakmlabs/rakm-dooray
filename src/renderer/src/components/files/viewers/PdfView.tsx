// PDF 보기 (pdf.js, renderer 에서 직접 그린다). 페이지 넘김·확대, 보이는 페이지만 그린다.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { FIcon } from '../icons'
import { fetchBytes, type FileItem } from '../model'
import { Loading } from './common'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const ZOOMS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3]

export default function PdfView({ f, fallback }: { f: FileItem; fallback: (reason: string) => ReactNode }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [base, setBase] = useState<{ w: number; h: number } | null>(null)
  /** null = 폭 맞춤 */
  const [zoom, setZoom] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')
  const scroller = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)

  useEffect(() => {
    const ac = new AbortController()
    let task: PDFDocumentLoadingTask | null = null
    ;(async () => {
      try {
        const data = await fetchBytes(f, ac.signal)
        task = pdfjs.getDocument({
          data: new Uint8Array(data),
          // 비내장 한글 글꼴(CID)용 CMap·표준 글꼴은 앱에 든 pdfjs-dist 에서 rakm-file:// 로 받는다
          cMapUrl: 'rakm-file://pdfjs/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: 'rakm-file://pdfjs/standard_fonts/',
          useWorkerFetch: false,
          useWasm: false
        })
        const loaded = await task.promise
        if (ac.signal.aborted) return
        const p1 = await loaded.getPage(1)
        const vp = p1.getViewport({ scale: 1 })
        setBase({ w: vp.width, h: vp.height })
        setDoc(loaded)
      } catch (e) {
        if (!ac.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      ac.abort()
      void task?.destroy()
    }
  }, [f])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [doc])

  if (error) return <>{fallback(`PDF 를 열지 못했습니다: ${error}`)}</>
  if (!doc || !base) return <Loading />

  // 폭 맞춤 (너무 넓은 창에서는 읽기 좋은 폭까지만)
  const fitScale = Math.max(0.2, Math.min(width - 48, 980) / base.w)
  const scale = zoom ?? fitScale
  const n = doc.numPages

  function goto(p: number) {
    const target = Math.min(n, Math.max(1, p))
    scroller.current?.querySelector(`[data-page="${target}"]`)?.scrollIntoView({ block: 'start' })
    setPage(target)
    setPageInput(String(target))
  }

  function onScroll() {
    const el = scroller.current
    if (!el) return
    const pages = el.querySelectorAll<HTMLElement>('[data-page]')
    const mid = el.scrollTop + el.clientHeight / 3
    let cur = 1
    for (const p of pages) if (p.offsetTop <= mid) cur = Number(p.dataset.page)
    if (cur !== page) {
      setPage(cur)
      setPageInput(String(cur))
    }
  }

  function step(dir: 1 | -1) {
    const cur = zoom ?? fitScale
    const next = dir > 0 ? ZOOMS.find((z) => z > cur + 0.01) : [...ZOOMS].reverse().find((z) => z < cur - 0.01)
    if (next) setZoom(next)
  }

  return (
    <div className="pv">
      <div className="pv-pages" ref={scroller} onScroll={onScroll} tabIndex={0}>
        {Array.from({ length: n }, (_, i) => (
          <PdfPage key={i} doc={doc} num={i + 1} scale={scale} w={base.w} h={base.h} />
        ))}
      </div>
      <div className="iv-tools" role="toolbar" aria-label="PDF 도구">
        <button className="fv-btn icon" onClick={() => goto(page - 1)} disabled={page <= 1} title="이전 쪽" aria-label="이전 쪽">
          <FIcon name="prev" />
        </button>
        <form
          className="pv-pageno"
          onSubmit={(e) => {
            e.preventDefault()
            goto(Number(pageInput) || 1)
          }}
        >
          <input value={pageInput} onChange={(e) => setPageInput(e.target.value)} aria-label="쪽 번호" inputMode="numeric" />
          <span>/ {n}</span>
        </form>
        <button className="fv-btn icon" onClick={() => goto(page + 1)} disabled={page >= n} title="다음 쪽" aria-label="다음 쪽">
          <FIcon name="next" />
        </button>
        <span className="iv-sep" />
        <button className="fv-btn icon" onClick={() => step(-1)} title="축소" aria-label="축소">
          <FIcon name="zoomOut" />
        </button>
        <span className="fv-btn pct as-label">{Math.round(scale * 100)}%</span>
        <button className="fv-btn icon" onClick={() => step(1)} title="확대" aria-label="확대">
          <FIcon name="zoomIn" />
        </button>
        <button className={`fv-btn icon ${zoom === null ? 'on' : ''}`} onClick={() => setZoom(null)} title="폭 맞춤" aria-label="폭 맞춤">
          <FIcon name="fit" />
        </button>
      </div>
    </div>
  )
}

/** 한 쪽. 화면 근처에 왔을 때만 그린다. */
function PdfPage({ doc, num, scale, w, h }: { doc: PDFDocumentProxy; num: number; scale: number; w: number; h: number }) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(num <= 2)
  const [size, setSize] = useState<{ w: number; h: number }>({ w: w * scale, h: h * scale })

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setVisible(true), { rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) {
      setSize({ w: w * scale, h: h * scale })
      return
    }
    let task: RenderTask | null = null
    let cancelled = false
    ;(async () => {
      const p = await doc.getPage(num)
      if (cancelled) return
      const vp = p.getViewport({ scale })
      setSize({ w: vp.width, h: vp.height })
      const c = canvas.current
      if (!c) return
      const dpr = window.devicePixelRatio || 1
      c.width = Math.floor(vp.width * dpr)
      c.height = Math.floor(vp.height * dpr)
      task = p.render({ canvas: c, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
      await task.promise.catch(() => {})
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, num, scale, visible, w, h])

  return (
    <div className="pv-page" ref={wrap} data-page={num} style={{ width: size.w, height: size.h }}>
      <canvas ref={canvas} style={{ width: size.w, height: size.h }} />
    </div>
  )
}
