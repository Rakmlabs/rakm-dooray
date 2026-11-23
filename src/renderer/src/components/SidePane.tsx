// 폭을 끌어 바꾸고 접을 수 있는 옆 목록 (메신저 대화방 목록, 위키 목록·페이지 목록).
// 오른쪽 경계를 끌면 폭이 바뀌고(두 번 누르면 기본 폭), 머리의 접기 버튼이나 ⌘\ 로 접는다. 접으면 펼치기 버튼만 있는 좁은 줄이 남는다.
// 폭·접힘은 목록마다 이 컴퓨터에 기억한다.
import { createContext, useContext, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { Icon } from './Icon'

interface Saved {
  w: number
  c: boolean
}

const KEY = (id: string) => `pane:${id}`

function load(id: string, def: number, min: number, max: number): Saved {
  try {
    const v = JSON.parse(window.localStorage.getItem(KEY(id)) ?? 'null') as Partial<Saved> | null
    const w = typeof v?.w === 'number' ? Math.min(max, Math.max(min, v.w)) : def
    return { w, c: v?.c === true }
  } catch {
    return { w: def, c: false }
  }
}

function save(id: string, s: Saved) {
  try {
    window.localStorage.setItem(KEY(id), JSON.stringify(s))
  } catch {
    /* 저장 못 해도 이번 실행 동안은 그대로 */
  }
}

// ⌘\ : 지금 보이는 화면의 목록을 모두 접는다 (모두 접혀 있으면 모두 편다). 뒤에 숨은 화면(메신저↔위키)의 목록은 건드리지 않는다
const mounted = new Map<string, { collapsed: () => boolean; set: (c: boolean) => void; visible: () => boolean }>()
let listening = false
function onShortcut(e: globalThis.KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || e.key !== '\\' || e.altKey || e.shiftKey) return
  const shown = [...mounted.values()].filter((p) => p.visible())
  if (!shown.length) return
  e.preventDefault()
  const anyOpen = shown.some((p) => !p.collapsed())
  for (const p of shown) p.set(anyOpen)
}

const PaneCtx = createContext<{ collapse: () => void; label: string } | null>(null)

/** 목록 머리에 두는 접기 버튼 */
export function PaneCollapseButton() {
  const ctx = useContext(PaneCtx)
  if (!ctx) return null
  return (
    <button className="icon-btn pane-collapse" onClick={ctx.collapse} title={`${ctx.label} 접기 (⌘\\)`} aria-label={`${ctx.label} 접기`}>
      <Icon name="panelClose" size={15} />
    </button>
  )
}

export function SidePane({
  id,
  label,
  className,
  defaultWidth,
  min = 180,
  max = 480,
  children
}: {
  id: string
  /** 화면 읽기·버튼 설명에 쓰는 이름 (예: 대화방 목록) */
  label: string
  className: string
  defaultWidth: number
  min?: number
  max?: number
  children: ReactNode
}) {
  const [state, setState] = useState<Saved>(() => load(id, defaultWidth, min, max))
  const stateRef = useRef(state)
  stateRef.current = state
  const asideRef = useRef<HTMLElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; w: number; now: number } | null>(null)

  const update = (s: Saved) => {
    setState(s)
    save(id, s)
  }
  const setCollapsed = (c: boolean) => update({ ...stateRef.current, c })

  useEffect(() => {
    mounted.set(id, {
      collapsed: () => stateRef.current.c,
      set: (c) => update({ ...stateRef.current, c }),
      visible: () => !!(asideRef.current ?? stripRef.current)?.getClientRects().length
    })
    if (!listening) {
      window.addEventListener('keydown', onShortcut)
      listening = true
    }
    return () => {
      mounted.delete(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)))

  // 끄는 동안은 상태를 바꾸지 않고 폭만 바로 바꾼다 (목록 전체를 매 프레임 다시 그리지 않게). 놓을 때 저장
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, w: state.w, now: state.w }
    document.body.classList.add('pane-resizing')
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    d.now = clamp(d.w + e.clientX - d.x)
    if (asideRef.current) asideRef.current.style.width = `${d.now}px`
  }
  const onPointerUp = () => {
    const d = drag.current
    if (!d) return
    drag.current = null
    document.body.classList.remove('pane-resizing')
    if (d.now !== state.w) update({ ...state, w: d.now })
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 40 : 10
    if (e.key === 'ArrowLeft') update({ ...state, w: clamp(state.w - step) })
    else if (e.key === 'ArrowRight') update({ ...state, w: clamp(state.w + step) })
    else if (e.key === 'Home') update({ ...state, w: defaultWidth })
    else return
    e.preventDefault()
  }

  if (state.c) {
    return (
      <div ref={stripRef} className="pane-collapsed" aria-label={`${label} (접힘)`}>
        <button className="icon-btn" onClick={() => setCollapsed(false)} title={`${label} 펼치기 (⌘\\)`} aria-label={`${label} 펼치기`}>
          <Icon name="panelOpen" size={15} />
        </button>
      </div>
    )
  }

  return (
    <PaneCtx.Provider value={{ collapse: () => setCollapsed(true), label }}>
      <aside ref={asideRef} className={`${className} side-pane`} style={{ width: state.w }} aria-label={label}>
        {children}
        <div
          className="pane-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label={`${label} 폭 조절`}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={state.w}
          tabIndex={0}
          title="끌어서 폭 조절 · 두 번 누르면 기본 폭"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={() => update({ ...state, w: defaultWidth })}
          onKeyDown={onKeyDown}
        />
      </aside>
    </PaneCtx.Provider>
  )
}
