// 이미지 확대 보기: 휠·핀치(트랙패드)·버튼·더블클릭으로 확대/축소, 끌어 옮기기.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FIcon } from '../icons'
import { thumbOf, urlOf, type FileItem } from '../model'

interface View {
  s: number
  x: number
  y: number
}

const MIN = 0.05
const MAX = 16

export function ImageView({ f }: { f: FileItem }) {
  const box = useRef<HTMLDivElement>(null)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [view, setView] = useState<View | null>(null)
  const [fitMode, setFitMode] = useState(true)
  const [error, setError] = useState(false)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ id: number; x: number; y: number; vx: number; vy: number } | null>(null)

  const fitView = useCallback((): View | null => {
    const el = box.current
    if (!el || !nat) return null
    const cw = el.clientWidth
    const ch = el.clientHeight
    const s = Math.min(cw / nat.w, ch / nat.h, 1)
    return { s, x: (cw - nat.w * s) / 2, y: (ch - nat.h * s) / 2 }
  }, [nat])

  // 처음, 그리고 창 크기가 바뀌면 (맞춤 상태일 때) 다시 맞춘다
  useLayoutEffect(() => {
    if (fitMode) setView(fitView())
  }, [fitMode, fitView])
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (fitMode) setView(fitView())
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [fitMode, fitView])

  const zoomAt = useCallback(
    (factor: number, px?: number, py?: number) => {
      const el = box.current
      setView((v) => {
        if (!v || !el) return v
        const cx = px ?? el.clientWidth / 2
        const cy = py ?? el.clientHeight / 2
        const s = Math.min(MAX, Math.max(MIN, v.s * factor))
        const k = s / v.s
        return { s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }
      })
      setFitMode(false)
    },
    []
  )

  const setScale = (s: number) => {
    if (view) zoomAt(s / view.s)
  }

  // 휠: 확대/축소. 트랙패드 핀치는 ctrlKey 가 붙은 wheel 로 온다. passive 가 아니어야 기본 스크롤을 막을 수 있다.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const unit = e.deltaMode === 1 ? 16 : 1
      // 한 번에 너무 많이 바뀌지 않게 (마우스 휠 한 칸 ≈ 1.3배)
      const d = Math.max(-100, Math.min(100, e.deltaY * unit))
      const k = Math.exp(-d * (e.ctrlKey ? 0.01 : 0.0025))
      zoomAt(k, e.clientX - r.left, e.clientY - r.top)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt])

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || !view) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
    setDragging(true)
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    setView((v) => (v ? { ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y } : v))
    setFitMode(false)
  }
  function onPointerUp(e: React.PointerEvent) {
    if (drag.current?.id === e.pointerId) {
      drag.current = null
      setDragging(false)
    }
  }
  function onDoubleClick(e: React.MouseEvent) {
    const fit = fitView()
    if (!view || !fit) return
    const r = box.current!.getBoundingClientRect()
    // 맞춤 근처면 원본 크기(작은 그림이면 2배)로, 아니면 다시 맞춤
    if (Math.abs(view.s - fit.s) < 0.01) {
      const target = fit.s < 1 ? 1 : fit.s * 2
      zoomAt(target / view.s, e.clientX - r.left, e.clientY - r.top)
    } else {
      setFitMode(true)
    }
  }

  const pct = view ? Math.round(view.s * 100) : null
  return (
    <div className="iv">
      <div
        className={`iv-stage ${dragging ? 'dragging' : ''}`}
        ref={box}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        {!nat && !error && (
          // 원본을 받는 동안 썸네일을 흐리게 보여준다
          <div className="iv-loading">
            <img src={thumbOf(f)} alt="" draggable={false} />
            <div className="fspin" aria-hidden />
          </div>
        )}
        {error && <div className="fv-center muted">이미지를 불러오지 못했습니다.</div>}
        <img
          className="iv-img"
          src={urlOf(f)}
          alt={f.name}
          draggable={false}
          onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 })}
          onError={() => setError(true)}
          style={
            view && nat
              ? { width: nat.w, height: nat.h, transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }
              : { visibility: 'hidden' }
          }
        />
      </div>
      <div className="iv-tools" role="toolbar" aria-label="확대 도구">
        <button className="fv-btn icon" onClick={() => zoomAt(1 / 1.25)} title="축소" aria-label="축소">
          <FIcon name="zoomOut" />
        </button>
        <button className="fv-btn pct" onClick={() => setScale(1)} title="원본 크기 (100%)">
          {pct !== null ? `${pct}%` : '—'}
        </button>
        <button className="fv-btn icon" onClick={() => zoomAt(1.25)} title="확대" aria-label="확대">
          <FIcon name="zoomIn" />
        </button>
        <span className="iv-sep" />
        <button className={`fv-btn icon ${fitMode ? 'on' : ''}`} onClick={() => setFitMode(true)} title="화면에 맞춤" aria-label="화면에 맞춤">
          <FIcon name="fit" />
        </button>
        <button className="fv-btn icon" onClick={() => setScale(1)} title="원본 크기" aria-label="원본 크기">
          <FIcon name="actual" />
        </button>
        {nat && <span className="iv-dim">{`${nat.w} × ${nat.h}`}</span>}
      </div>
    </div>
  )
}
