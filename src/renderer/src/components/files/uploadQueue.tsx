// 파일 영역 소유. 보내기 전 첨부 트레이와 업로드 대기열.
//
// 두레이 메신저 업로드 API(POST /messenger/v1/channels/{id}/files, multipart 'attach' 하나)는 **요청 하나에 파일 하나**를 받고,
// 파일 하나가 메시지 하나(type FILE)가 된다. 메시지 하나에 사진 여러 장을 묶는 방법은 없다.
// 그래서 카톡처럼 "묶어 보내기" 는
//   - 보내는 쪽: 트레이에 최대 30개를 모아 순서를 정하고 한 번에 보낸다 (하나씩 차례로 올려 순서를 지킨다)
//   - 받는 쪽: 같은 사람이 연달아 보낸 사진 메시지를 목록에서 앨범(격자)으로 묶어 그린다 (MessageList)
// 두레이 웹·모바일에서는 사진 메시지가 연달아 보인다.
//
// 동시 업로드는 1개: 여러 개를 동시에 올리면 먼저 끝난 것부터 메시지가 생겨 순서가 섞인다. 429(요청 제한)는 http.ts 가 쉬었다 다시 보낸다.
// 실패한 파일은 한 번 자동으로 다시 보내고, 그래도 안 되면 트레이에 남겨 눌러서 다시 보낼 수 있다. 나머지는 계속 올린다.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { UPLOAD_MAX_BYTES, fileKind, mimeFromName, type FileKind } from '@shared/types-files'
import { call, errorText } from '../../api'

export const MAX_BATCH = 30
/** 트레이 썸네일 높이 (px). 원본 대신 줄인 그림을 만들어 메모리를 아낀다 */
const THUMB_PX = 128

export interface UploadItem {
  id: number
  file: File
  name: string
  kind: FileKind
  thumb: string | null
  status: 'ready' | 'queued' | 'sending' | 'error'
  /** 올릴 수 없는 파일 (너무 큼·빈 파일) */
  bad: string | null
  error?: string
}

export interface UploadQueue {
  items: UploadItem[]
  disabled: boolean
  /** 보내는 중이거나 기다리는 것 */
  busy: boolean
  /** 이번 묶음 진행: 끝난 수 / 전체, 바이트 비율 */
  progress: { done: number; total: number; ratio: number } | null
  add: (files: File[], pasted?: boolean) => void
  remove: (id: number) => void
  clear: () => void
  move: (id: number, toIndex: number) => void
  /** 트레이의 준비된 파일을 모두 보낸다 */
  sendAll: () => void
  retry: (id: number) => void
  readyCount: number
}

const Ctx = createContext<UploadQueue | null>(null)
export const UploadQueueProvider = Ctx.Provider
export function useUploadQueue(): UploadQueue | null {
  return useContext(Ctx)
}

let seq = 0

/** 붙여넣은 스크린샷은 이름이 image.png 하나뿐이라 시각을 붙인다 */
export function nameFor(file: File, pasted: boolean, index = 0): string {
  if (pasted && (/^image\.(png|jpe?g|gif|webp)$/i.test(file.name) || !file.name)) {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
    const n = index > 0 ? ` (${index + 1})` : ''
    return `스크린샷 ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}${n}.${ext}`
  }
  return file.name || '파일'
}

export function badReason(file: File): string | null {
  if (file.size === 0) return '빈 파일'
  if (file.size > UPLOAD_MAX_BYTES) return `${Math.round(UPLOAD_MAX_BYTES / 1024 / 1024)}MB 초과`
  return null
}

/** 줄인 썸네일 (원본 크기 objectURL 을 여러 개 들고 있지 않게). 못 만들면 null */
async function makeThumb(file: File): Promise<string | null> {
  if (!file.type.startsWith('image/') || file.size > 60 * 1024 * 1024) return null
  try {
    const bmp = await createImageBitmap(file, { resizeHeight: THUMB_PX * 2, resizeQuality: 'medium' })
    const c = document.createElement('canvas')
    c.width = bmp.width
    c.height = bmp.height
    c.getContext('2d')?.drawImage(bmp, 0, 0)
    bmp.close()
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.8))
    return blob ? URL.createObjectURL(blob) : null
  } catch {
    return null
  }
}

/** 첫 시도가 실패하면 한 번 더. 다시 보내도 소용없는 거절(권한·크기·잘못된 요청·인증)과,
 *  서버가 이미 받았을 수 있는 시간 초과는 다시 보내지 않는다 (같은 사진이 두 번 올라가지 않게) */
export function retryable(msg: string): boolean {
  if (/\b(400|401|403|404|409|413)\b|너무 큽니다|권한|인증|빈 파일|올바르지|timeout|timed out|시간 초과/i.test(msg)) return false
  return true
}

export function useUploadQueueState({
  channelId,
  disabled,
  onUploaded,
  onNotice
}: {
  channelId: string
  disabled: boolean
  onUploaded: () => void
  onNotice: (msg: string, kind?: 'info' | 'error') => void
}): UploadQueue {
  const [items, setItems] = useState<UploadItem[]>([])
  const [batch, setBatch] = useState<{ total: number; done: number; bytes: number; doneBytes: number } | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const running = useRef(false)
  const channelRef = useRef(channelId)
  channelRef.current = channelId
  const uploadedRef = useRef(onUploaded)
  uploadedRef.current = onUploaded

  const revoke = (list: UploadItem[]) => {
    for (const x of list) if (x.thumb) URL.revokeObjectURL(x.thumb)
  }

  // 방을 옮기면 아직 안 보낸 트레이는 비운다 (보내는 중인 것은 끝까지 그 방으로 간다 — 아래 run 이 채널을 붙잡는다)
  useEffect(
    () => () => {
      setItems((cur) => {
        const keep = cur.filter((x) => x.status === 'sending' || x.status === 'queued')
        revoke(cur.filter((x) => !keep.includes(x)))
        return keep
      })
    },
    [channelId]
  )
  // 앱을 끌 때까지 남은 썸네일 정리
  useEffect(() => () => revoke(itemsRef.current), [])

  const update = (id: number, p: Partial<UploadItem>) => setItems((cur) => cur.map((x) => (x.id === id ? { ...x, ...p } : x)))

  const add = useCallback(
    (files: File[], pasted = false) => {
      if (disabled || files.length === 0) return
      const room = MAX_BATCH - itemsRef.current.length
      if (room <= 0) {
        onNotice(`한 번에 ${MAX_BATCH}개까지 보낼 수 있습니다. 먼저 보내거나 몇 개를 빼 주세요.`, 'error')
        return
      }
      const take = files.slice(0, room)
      if (files.length > room) onNotice(`한 번에 ${MAX_BATCH}개까지라 ${files.length - room}개는 넣지 않았습니다.`, 'error')
      const fresh: UploadItem[] = take.map((file, i) => {
        const name = nameFor(file, pasted, take.length > 1 ? i : 0)
        return { id: ++seq, file, name, kind: fileKind(name, file.type), thumb: null, status: 'ready', bad: badReason(file) }
      })
      setItems((cur) => [...cur, ...fresh])
      // 썸네일은 하나씩 (한꺼번에 디코드하면 잠깐 멈춘다)
      void (async () => {
        for (const it of fresh) {
          const t = await makeThumb(it.file)
          if (!t) continue
          if (itemsRef.current.some((x) => x.id === it.id)) update(it.id, { thumb: t })
          else URL.revokeObjectURL(t)
        }
      })()
    },
    [disabled, onNotice]
  )

  const remove = useCallback((id: number) => {
    setItems((cur) => {
      const x = cur.find((i) => i.id === id)
      if (!x || x.status === 'sending') return cur
      revoke([x])
      return cur.filter((i) => i.id !== id)
    })
  }, [])

  const clear = useCallback(() => {
    setItems((cur) => {
      const keep = cur.filter((x) => x.status === 'sending' || x.status === 'queued')
      revoke(cur.filter((x) => !keep.includes(x)))
      return keep
    })
  }, [])

  const move = useCallback((id: number, toIndex: number) => {
    setItems((cur) => {
      const from = cur.findIndex((x) => x.id === id)
      if (from < 0) return cur
      const next = [...cur]
      const [x] = next.splice(from, 1)
      next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, x)
      return next
    })
  }, [])

  const run = useCallback(async () => {
    if (running.current) return
    running.current = true
    const target = channelRef.current
    try {
      for (;;) {
        const next = itemsRef.current.find((x) => x.status === 'queued')
        if (!next) break
        update(next.id, { status: 'sending', error: undefined })
        let err: string | null = null
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const bytes = new Uint8Array(await next.file.arrayBuffer())
            await call('files:upload', target, next.name, next.file.type || mimeFromName(next.name), bytes)
            err = null
            break
          } catch (e) {
            err = errorText(e)
            if (attempt === 0 && retryable(err)) await new Promise((r) => setTimeout(r, 1500))
            else break
          }
        }
        if (err === null) {
          setItems((cur) => {
            const x = cur.find((i) => i.id === next.id)
            if (x) revoke([x])
            return cur.filter((i) => i.id !== next.id)
          })
          itemsRef.current = itemsRef.current.filter((i) => i.id !== next.id)
          setBatch((b) => (b ? { ...b, done: b.done + 1, doneBytes: b.doneBytes + next.file.size } : b))
          if (channelRef.current === target) uploadedRef.current()
        } else {
          update(next.id, { status: 'error', error: err })
          itemsRef.current = itemsRef.current.map((i) => (i.id === next.id ? { ...i, status: 'error' as const, error: err ?? undefined } : i))
          setBatch((b) => (b ? { ...b, done: b.done + 1, doneBytes: b.doneBytes + next.file.size } : b))
        }
      }
    } finally {
      running.current = false
      setBatch(null)
      const failed = itemsRef.current.filter((x) => x.status === 'error').length
      if (failed) onNotice(`${failed}개를 올리지 못했습니다. 트레이에서 눌러 다시 보낼 수 있습니다.`, 'error')
    }
  }, [onNotice])

  const queue = useCallback(
    (pick: (x: UploadItem) => boolean) => {
      const chosen = itemsRef.current.filter((x) => !x.bad && pick(x))
      if (chosen.length === 0) return
      const ids = new Set(chosen.map((x) => x.id))
      const mark = (x: UploadItem): UploadItem => (ids.has(x.id) ? { ...x, status: 'queued', error: undefined } : x)
      itemsRef.current = itemsRef.current.map(mark)
      setItems((cur) => cur.map(mark))
      const bytes = chosen.reduce((s, x) => s + x.file.size, 0)
      setBatch((b) => (b ? { ...b, total: b.total + chosen.length, bytes: b.bytes + bytes } : { total: chosen.length, done: 0, bytes, doneBytes: 0 }))
      void run()
    },
    [run]
  )

  const sendAll = useCallback(() => queue((x) => x.status === 'ready' || x.status === 'error'), [queue])
  const retry = useCallback((id: number) => queue((x) => x.id === id && x.status === 'error'), [queue])

  const readyCount = items.filter((x) => x.status === 'ready' && !x.bad).length
  const busy = items.some((x) => x.status === 'sending' || x.status === 'queued')
  const progress = batch
    ? { done: batch.done, total: batch.total, ratio: batch.bytes > 0 ? Math.min(1, batch.doneBytes / batch.bytes) : batch.done / Math.max(1, batch.total) }
    : null

  return useMemo(
    () => ({ items, disabled, busy, progress, add, remove, clear, move, sendAll, retry, readyCount }),
    [items, disabled, busy, progress?.done, progress?.total, progress?.ratio, add, remove, clear, move, sendAll, retry, readyCount] // eslint-disable-line react-hooks/exhaustive-deps
  )
}
