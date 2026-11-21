// 위키 페이지 자동 저장.
// - 입력을 멈추고 1.5초 뒤 저장. 저장할 것은 "지금 직렬화 결과 ≠ 마지막으로 저장된 값" 일 때만.
// - 첫 저장 직전에 원문을 로컬에 백업한다.
// - 저장 직전 main 이 서버 버전을 다시 확인한다. 다르면 conflict → 사용자가 고른다.
// - 다른 페이지로 가거나 창을 닫기 전에 보류 중인 저장을 마무리한다.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { WikiPage } from '@shared/types'
import type { WikiBackupKind, WikiServerCopy } from '@shared/types-wiki'
import { call, errorText, onEvent } from '../api'

export const AUTOSAVE_DELAY = 1500

export type SaveStatus =
  | { kind: 'clean' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'error'; message: string }
  | { kind: 'conflict'; server: WikiServerCopy }

export interface Current {
  subject: string
  content: string
}

interface Options {
  wikiId: string
  page: WikiPage
  /** 지금 화면의 제목·본문. 아직 준비 전(검사 전)이면 null → 저장하지 않는다 */
  getCurrent: () => Current | null
  onSaved: (r: WikiServerCopy, prev: Current) => void
  onLostChanges: (message: string) => void
}

export function usePageSave({ wikiId, page, getCurrent, onSaved, onLostChanges }: Options) {
  const [status, setStatusState] = useState<SaveStatus>({ kind: 'clean' })
  const statusRef = useRef<SaveStatus>(status)
  const setStatus = (s: SaveStatus) => {
    statusRef.current = s
    setStatusState(s)
  }
  const saved = useRef<Current>({ subject: page.subject, content: page.content })
  const base = useRef({ version: page.version, updatedAt: page.updatedAt })
  const backedUp = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inflight = useRef<Promise<void> | null>(null)
  const rerun = useRef(false)
  const discarded = useRef(false)
  const pendingSent = useRef(false)
  const override = useRef<Current | null>(null)
  const live = useRef({ getCurrent, onSaved, onLostChanges })
  live.current = { getCurrent, onSaved, onLostChanges }

  const current = (): Current | null => override.current ?? live.current.getCurrent()
  const isDirty = (c: Current | null) => !!c && (c.subject !== saved.current.subject || c.content !== saved.current.content)

  const setPending = (p: boolean) => {
    if (pendingSent.current === p) return
    pendingSent.current = p
    void call('wiki:pendingSave', p).catch(() => {})
  }

  const backup = useCallback(
    async (kind: WikiBackupKind, c: Current, version = base.current.version) => {
      await call('wiki:backupAdd', { pageId: page.id, wikiId, kind, subject: c.subject, content: c.content, version })
    },
    [page.id, wikiId]
  )

  const save = useCallback(
    async (force = false): Promise<void> => {
      if (inflight.current) {
        rerun.current = true
        return inflight.current
      }
      const run = async () => {
        const c = current()
        if (!isDirty(c) || !c) {
          if (statusRef.current.kind === 'dirty') setStatus({ kind: 'clean' })
          setPending(false)
          return
        }
        if (!c.subject.trim()) {
          setStatus({ kind: 'error', message: '제목이 비어 있어 저장하지 않았습니다' })
          return
        }
        setStatus({ kind: 'saving' })
        try {
          if (!backedUp.current) {
            // 이 페이지를 연 뒤 첫 저장: 서버에 있던 원문을 로컬에 남긴다
            await backup('before-first-save', { subject: page.subject, content: page.content }, page.version)
            backedUp.current = true
          }
          const sent = { ...c }
          const r = await call('wiki:save', wikiId, page.id, {
            subject: sent.subject !== saved.current.subject ? sent.subject : null,
            content: sent.content !== saved.current.content ? sent.content : null,
            baseVersion: base.current.version,
            baseUpdatedAt: base.current.updatedAt,
            force
          })
          if (r.status === 'conflict') {
            setStatus({ kind: 'conflict', server: r.server })
            return
          }
          const prev = saved.current
          saved.current = sent
          base.current = { version: r.version, updatedAt: r.updatedAt }
          if (override.current && override.current.content === sent.content && override.current.subject === sent.subject) override.current = null
          setStatus({ kind: 'saved', at: Date.now() })
          live.current.onSaved(r, prev)
          if (!isDirty(current())) setPending(false)
        } catch (e) {
          setStatus({ kind: 'error', message: errorText(e) })
        }
      }
      inflight.current = run()
      try {
        await inflight.current
      } finally {
        inflight.current = null
      }
      if (rerun.current) {
        rerun.current = false
        if (statusRef.current.kind !== 'conflict' && isDirty(current())) return save()
      }
    },
    [wikiId, page, backup] // eslint-disable-line react-hooks/exhaustive-deps
  )

  /** 편집기가 바뀔 때마다 부른다 */
  const notifyChange = useCallback(() => {
    if (discarded.current) return
    const c = current()
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (!isDirty(c)) {
      setPending(false)
      if (statusRef.current.kind === 'dirty') setStatus({ kind: 'clean' })
      return
    }
    setPending(true)
    const k = statusRef.current.kind
    if (k === 'conflict') return // 사용자가 고를 때까지 자동 저장을 멈춘다
    if (k !== 'saving') setStatus({ kind: 'dirty' })
    timer.current = setTimeout(() => void save(), AUTOSAVE_DELAY)
  }, [save]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 기다리지 않고 지금 저장 (⌘S, 페이지 이동, 창 닫기) */
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    if (discarded.current || statusRef.current.kind === 'conflict') return
    if (isDirty(current()) || inflight.current) await save()
  }, [save]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 저장하지 못한 변경을 로컬 백업으로 남긴다 */
  const keepUnsaved = useCallback(
    async (kind: WikiBackupKind) => {
      const c = current()
      if (!isDirty(c) || !c) return false
      try {
        await backup(kind, c)
        return true
      } catch {
        return false
      }
    },
    [backup] // eslint-disable-line react-hooks/exhaustive-deps
  )

  /** 이 화면을 버린다 (서버 것 불러오기 등). 언마운트 때 저장하지 않는다 */
  const discard = useCallback(() => {
    discarded.current = true
    if (timer.current) clearTimeout(timer.current)
    setPending(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** 지정한 내용으로 저장 (백업 되돌리기) */
  const saveContent = useCallback(
    async (c: Current) => {
      override.current = c
      await save()
      return statusRef.current.kind === 'saved'
    },
    [save]
  )

  // 창 닫기 전 마무리
  useEffect(
    () =>
      onEvent('wiki:flush', () => {
        void (async () => {
          await flush().catch(() => {})
          if (isDirty(current()) && !discarded.current) await keepUnsaved('unsaved-on-close')
          await call('wiki:flushDone').catch(() => {})
        })()
      }),
    [flush, keepUnsaved] // eslint-disable-line react-hooks/exhaustive-deps
  )

  // 다른 페이지로 가면(언마운트) 보류 중인 저장을 마무리한다
  useEffect(
    () => () => {
      if (discarded.current) return
      void (async () => {
        await flush().catch(() => {})
        if (isDirty(current())) {
          const kept = await keepUnsaved('unsaved-on-close')
          live.current.onLostChanges(kept ? `'${page.subject}' 의 저장하지 못한 변경을 로컬에 백업했습니다 (되돌리기에서 볼 수 있음).` : `'${page.subject}' 의 변경을 저장하지 못했습니다.`)
        }
        setPending(false)
      })()
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  )

  return {
    status,
    notifyChange,
    flush,
    retry: () => save(),
    overwrite: () => save(true),
    keepUnsaved,
    discard,
    saveContent,
    savedRef: saved,
    baseRef: base
  }
}
