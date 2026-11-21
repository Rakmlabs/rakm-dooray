// 파일 뷰어 열림 상태와, 대화방별로 화면에 보이는 파일 메시지 목록.
// 뷰어는 App 트리 밖의 별도 React 루트(document.body 아래)에 그린다 → 어느 화면(대화방·스레드·모아보기)에서든 같은 뷰어.
import { createElement, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { FileItem } from './model'

// ---------- 대화방별 파일 등록 (앞뒤 넘기기용) ----------
const registry = new Map<string, Map<string, FileItem>>()

export function registerFile(f: FileItem): () => void {
  let m = registry.get(f.channelId)
  if (!m) registry.set(f.channelId, (m = new Map()))
  m.set(f.messageId, f)
  return () => {
    const cur = registry.get(f.channelId)
    if (cur?.get(f.messageId) === f) cur.delete(f.messageId)
  }
}

/** 이 방에서 지금 화면에 올라온 파일 (오래된 것 → 새 것) */
export function filesInChannel(channelId: string): FileItem[] {
  return [...(registry.get(channelId)?.values() ?? [])].sort((a, b) => a.seq - b.seq)
}

// ---------- 뷰어 상태 ----------
export interface ViewerState {
  items: FileItem[]
  index: number
}

let state: ViewerState | null = null
const listeners = new Set<() => void>()
let root: Root | null = null

function emit(): void {
  for (const l of listeners) l()
}

export function openViewer(items: FileItem[], index: number): void {
  if (items.length === 0) return
  state = { items, index: Math.max(0, Math.min(index, items.length - 1)) }
  ensureHost()
  emit()
}

export function closeViewer(): void {
  state = null
  emit()
}

export function moveViewer(delta: number): void {
  if (!state) return
  const next = state.index + delta
  if (next < 0 || next >= state.items.length) return
  state = { ...state, index: next }
  emit()
}

export function useViewerState(): ViewerState | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state
  )
}

function ensureHost(): void {
  if (root) return
  const el = document.createElement('div')
  el.id = 'file-viewer-root'
  document.body.appendChild(el)
  root = createRoot(el)
  // 순환 import 를 피하려고 뷰어는 여기서 늦게 불러온다
  void import('./FileViewer').then(({ ViewerHost }) => root!.render(createElement(ViewerHost)))
}
