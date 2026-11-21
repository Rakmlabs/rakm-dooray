// 채팅 영역 renderer 쪽 작은 공유 상태 (설정·북마크·프로필·답장 참조). 모듈 캐시 + 구독.
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import type { Message } from '@shared/types'
import type { ChatBookmark, ChatPrefs, MemberProfile, ReplyRef } from '@shared/types-chat'
import { call } from '../../api'

function createStore<T>(initial: T) {
  let value = initial
  const subs = new Set<() => void>()
  return {
    get: () => value,
    set(v: T) {
      value = v
      subs.forEach((s) => s())
    },
    subscribe(cb: () => void) {
      subs.add(cb)
      return () => {
        subs.delete(cb)
      }
    }
  }
}

// ---------- 설정 ----------

const prefsStore = createStore<ChatPrefs>({ linkPreview: true })
let prefsLoaded = false

export function useChatPrefs(): [ChatPrefs, (patch: Partial<ChatPrefs>) => Promise<void>] {
  const prefs = useSyncExternalStore(prefsStore.subscribe, prefsStore.get)
  useEffect(() => {
    if (prefsLoaded) return
    prefsLoaded = true
    void call('chat:prefs')
      .then(prefsStore.set)
      .catch(() => {
        prefsLoaded = false
      })
  }, [])
  const save = useCallback(async (patch: Partial<ChatPrefs>) => {
    prefsStore.set(await call('chat:savePrefs', patch))
  }, [])
  return [prefs, save]
}

// ---------- 북마크 ----------

const bookmarkStore = createStore<ChatBookmark[]>([])
let bookmarksLoaded = false

export function bookmarkKey(m: Pick<Message, 'channelId' | 'id'>): string {
  return `${m.channelId}:${m.id}`
}

export function useBookmarks() {
  const list = useSyncExternalStore(bookmarkStore.subscribe, bookmarkStore.get)
  useEffect(() => {
    if (bookmarksLoaded) return
    bookmarksLoaded = true
    void call('chat:bookmarks')
      .then(bookmarkStore.set)
      .catch(() => {
        bookmarksLoaded = false
      })
  }, [])
  const toggle = useCallback(async (m: Message, parentChannelId: string | null) => {
    const key = bookmarkKey(m)
    if (bookmarkStore.get().some((b) => b.key === key)) {
      bookmarkStore.set(await call('chat:removeBookmark', key))
      return false
    }
    bookmarkStore.set(
      await call('chat:addBookmark', {
        key,
        channelId: m.channelId,
        messageId: m.id,
        parentChannelId,
        senderId: m.senderId,
        sentAt: m.sentAt,
        text: m.text || (m.file ? `📎 ${m.file.name}` : ''),
        savedAt: ''
      })
    )
    return true
  }, [])
  const remove = useCallback(async (key: string) => {
    bookmarkStore.set(await call('chat:removeBookmark', key))
  }, [])
  return { list, toggle, remove }
}

// ---------- 프로필 ----------

const profiles = new Map<string, MemberProfile | null>()
const profilePending = new Map<string, Promise<MemberProfile | null>>()
const profileTick = createStore(0)

export function fetchProfile(id: string): Promise<MemberProfile | null> {
  if (profiles.has(id)) return Promise.resolve(profiles.get(id) ?? null)
  let p = profilePending.get(id)
  if (!p) {
    p = call('chat:profile', id)
      .then((v) => v as MemberProfile | null)
      .catch(() => null)
      .then((v) => {
        profiles.set(id, v)
        if (v && id === 'me') profiles.set(v.id, v)
        profilePending.delete(id)
        profileTick.set(profileTick.get() + 1)
        return v
      })
    profilePending.set(id, p)
  }
  return p
}

export function useProfile(id: string | null): MemberProfile | null | undefined {
  useSyncExternalStore(profileTick.subscribe, profileTick.get)
  useEffect(() => {
    if (id) void fetchProfile(id)
  }, [id])
  if (!id) return null
  return profiles.has(id) ? profiles.get(id) : undefined
}

/** 멘션 링크에 쓰는 조직 ID (내 프로필의 defaultOrganization.id) */
export function useOrganizationId(): string | null {
  const me = useProfile('me')
  return me?.organizationId ?? null
}

// ---------- 답장 참조 ----------
// 두레이 logs 응답의 REPLY 메시지에서 원 메시지를 가리키는 필드가 확인되지 않았다.
// 그래서 이 앱에서 보낸 답장만 "답장 ID → 원 메시지"를 로컬에 기억해 인용으로 보여준다.

const replyRefs = new Map<string, Map<string, ReplyRef>>()
const replyTick = createStore(0)
const pendingReply = new Map<string, { m: Message; at: number }>()

function loadReplyRefs(channelId: string) {
  if (replyRefs.has(channelId)) return
  replyRefs.set(channelId, new Map())
  void call('chat:replyRefs', channelId)
    .then((list) => {
      const map = replyRefs.get(channelId)!
      for (const r of list) map.set(r.replyId, r)
      replyTick.set(replyTick.get() + 1)
    })
    .catch(() => replyRefs.delete(channelId))
}

/** 셸이 messenger:reply 결과로 정확히 기록할 때 쓴다 (통합 요청). */
export function rememberReply(channelId: string, replyId: string, original: Message): void {
  const ref: ReplyRef = {
    channelId,
    replyId,
    originalId: original.id,
    originalSenderId: original.senderId,
    originalText: (original.text || original.file?.name || '').slice(0, 300)
  }
  if (!replyRefs.has(channelId)) replyRefs.set(channelId, new Map())
  replyRefs.get(channelId)!.set(replyId, ref)
  pendingReply.delete(channelId)
  replyTick.set(replyTick.get() + 1)
  void call('chat:addReplyRef', ref).catch(() => {})
}

/** 답장 버튼을 누른 순간을 기억해 둔다 → 그 뒤 처음 보이는 내 REPLY 메시지와 짝짓는다 */
export function notePendingReply(m: Message): void {
  pendingReply.set(m.channelId, { m, at: Date.now() })
}

export function useReplyRefs(channelId: string | null, messages: Message[], meId: string | null): Map<string, ReplyRef> {
  useSyncExternalStore(replyTick.subscribe, replyTick.get)
  useEffect(() => {
    if (channelId) loadReplyRefs(channelId)
  }, [channelId])
  useEffect(() => {
    if (!channelId || !meId) return
    const p = pendingReply.get(channelId)
    if (!p) return
    const map = replyRefs.get(channelId)
    const hit = [...messages]
      .reverse()
      .find((x) => x.type === 'REPLY' && x.senderId === meId && x.sentAt && Date.parse(x.sentAt) >= p.at - 60_000 && !map?.has(x.id))
    if (hit) rememberReply(channelId, hit.id, p.m)
    else if (Date.now() - p.at > 10 * 60_000) pendingReply.delete(channelId)
  }, [channelId, messages, meId])
  return (channelId && replyRefs.get(channelId)) || EMPTY_REFS
}
const EMPTY_REFS = new Map<string, ReplyRef>()

// ---------- 작은 도구 ----------

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

/** 목록 정리용: 마크다운·멘션을 걷어낸 한 줄 요약 */
export function plainSummary(text: string, max = 120): string {
  const t = text
    .replace(/\[@([^\]]+)\]\(dooray:\/\/[^)]*\)/g, '@$1')
    .replace(/```[\s\S]*?```/g, '[코드]')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[이미지]')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(t)
  }, [intervalMs])
  return now
}
