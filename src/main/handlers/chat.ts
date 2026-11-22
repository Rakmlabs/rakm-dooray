// 메시지 표시·프로필·입력 편의 영역의 main 핸들러. 이 영역 작업자만 고친다.
import type { ChatAreaContract } from '@shared/ipc-chat'
import type { ChatBookmark, ChatPrefs, LinkPreview, MemberProfile, ReplyRef } from '@shared/types-chat'
import { fetchLinkPreview } from '../chat/linkPreview'
import { toProfile, type RawMemberDetail } from '../chat/profile'
import { mockBase } from '../settings'
import { jsonStore } from '../store'
import type { HandlersFor, MainContext } from './types'

/** 모의 서버 주소와 그 미리보기 페이지 주소 (scripts/mock/chat.mjs 가 PORT+1000 에 띄운다) */
export function mockPreviewHosts(mock: string): string[] {
  const u = new URL(mock)
  return [u.host, `${u.hostname}:${Number(u.port) + 1000}`]
}

const PROFILE_TTL = 24 * 60 * 60 * 1000
const PREVIEW_TTL = 30 * 60 * 1000
const MAX_BOOKMARKS = 500
const MAX_REPLY_REFS = 2000

type ProfileCache = Record<string, { at: number; p: MemberProfile }>

const profileStore = jsonStore<ProfileCache>('chat-profiles.json', {})
const bookmarkStore = jsonStore<ChatBookmark[]>('chat-bookmarks.json', [])
const prefsStore = jsonStore<Partial<ChatPrefs>>('chat-prefs.json', {})
const replyStore = jsonStore<ReplyRef[]>('chat-reply-refs.json', [])

const DEFAULT_PREFS: ChatPrefs = { linkPreview: true, threads: false }

function readPrefs(): ChatPrefs {
  const p = prefsStore.read()
  return {
    linkPreview: typeof p.linkPreview === 'boolean' ? p.linkPreview : DEFAULT_PREFS.linkPreview,
    threads: typeof p.threads === 'boolean' ? p.threads : DEFAULT_PREFS.threads
  }
}

export function chatAreaHandlers(ctx: MainContext): HandlersFor<ChatAreaContract> {
  let profiles: ProfileCache | null = null
  let meProfile: MemberProfile | null = null
  const inflight = new Map<string, Promise<MemberProfile>>()
  const previews = new Map<string, { at: number; v: LinkPreview | null }>()

  async function loadProfile(id: string): Promise<MemberProfile> {
    profiles ??= profileStore.read()
    // '나' 는 토큰이 바뀔 수 있어 디스크 캐시를 쓰지 않는다 (프로세스 동안만)
    if (id === 'me' && meProfile) return meProfile
    const hit = id === 'me' ? undefined : profiles[id]
    if (hit && Date.now() - hit.at < PROFILE_TTL) return hit.p
    const path = id === 'me' ? '/common/v1/members/me' : `/common/v1/members/${encodeURIComponent(id)}`
    const raw = await ctx.http.get<RawMemberDetail>(path)
    const p = toProfile(id, raw ?? {})
    if (id === 'me') meProfile = p
    profiles[p.id] = { at: Date.now(), p }
    try {
      profileStore.write(profiles)
    } catch {
      /* 캐시 쓰기 실패는 무시 */
    }
    return p
  }

  return {
    async 'chat:profile'(memberId) {
      const id = String(memberId)
      let p = inflight.get(id)
      if (!p) {
        p = loadProfile(id).finally(() => inflight.delete(id))
        inflight.set(id, p)
      }
      return p
    },

    async 'chat:bookmarks'() {
      return bookmarkStore.read()
    },
    async 'chat:addBookmark'(b) {
      const list = bookmarkStore.read().filter((x) => x.key !== b.key)
      const item: ChatBookmark = {
        key: String(b.key),
        channelId: String(b.channelId),
        messageId: String(b.messageId),
        parentChannelId: b.parentChannelId ? String(b.parentChannelId) : null,
        senderId: b.senderId ? String(b.senderId) : null,
        sentAt: b.sentAt ?? null,
        text: String(b.text ?? '').slice(0, 2000),
        savedAt: new Date().toISOString()
      }
      const next = [item, ...list].slice(0, MAX_BOOKMARKS)
      bookmarkStore.write(next)
      return next
    },
    async 'chat:removeBookmark'(key) {
      const next = bookmarkStore.read().filter((x) => x.key !== key)
      bookmarkStore.write(next)
      return next
    },

    async 'chat:linkPreview'(url) {
      if (!readPrefs().linkPreview) return null
      const key = String(url)
      const hit = previews.get(key)
      if (hit && Date.now() - hit.at < PREVIEW_TTL) return hit.v
      // 개발 모드 + 모의 서버일 때만 그 호스트(와 미리보기 페이지 포트 +1000)를 허용한다 (사설 주소 차단 예외)
      const mock = mockBase()
      const allowHosts = mock ? mockPreviewHosts(mock) : []
      let v: LinkPreview | null = null
      try {
        v = await fetchLinkPreview(key, { timeoutMs: 5000, allowHosts })
      } catch {
        v = null
      }
      if (previews.size > 300) previews.delete(previews.keys().next().value as string)
      previews.set(key, { at: Date.now(), v })
      return v
    },

    async 'chat:prefs'() {
      return readPrefs()
    },
    async 'chat:savePrefs'(patch) {
      const next: ChatPrefs = { ...readPrefs() }
      if (typeof patch?.linkPreview === 'boolean') next.linkPreview = patch.linkPreview
      if (typeof patch?.threads === 'boolean') next.threads = patch.threads
      prefsStore.write(next)
      if (!next.linkPreview) previews.clear()
      return next
    },

    async 'chat:replyRefs'(channelId) {
      return replyStore.read().filter((r) => r.channelId === channelId)
    },
    async 'chat:addReplyRef'(ref) {
      const list = replyStore.read().filter((r) => !(r.channelId === ref.channelId && r.replyId === ref.replyId))
      list.push({
        channelId: String(ref.channelId),
        replyId: String(ref.replyId),
        originalId: String(ref.originalId),
        originalSenderId: ref.originalSenderId ? String(ref.originalSenderId) : null,
        originalText: String(ref.originalText ?? '').slice(0, 300)
      })
      replyStore.write(list.slice(-MAX_REPLY_REFS))
      return null
    }
  }
}

/** app ready 전에 한 번 (예: protocol.registerSchemesAsPrivileged). */
export function chatAreaBeforeReady(): void {}

/** app ready 후, 창을 만들기 전에 한 번 (예: protocol.handle, 트레이). */
export function chatAreaSetup(_ctx: MainContext): void {}
