import { parseSystem, systemText } from '@shared/system-message'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { Message } from '@shared/types'
import type { ReplyRef } from '@shared/types-chat'
import { call, errorText } from '../api'
import { useApp, useMemberNames } from '../state'
import { formatDay, formatTime } from '../lib/format'
import { firstPreviewUrl, parseWikiUrl, renderMarkdown } from '../lib/markdown'
import { navigate } from '../lib/nav'
import { parseTopic } from '../lib/projects'
import { Icon } from './Icon'
import { FileAttachment } from './files/FileAttachment'
import { useUploadHold } from './files/uploadQueue'
import { ALBUM_GAP_MS, PhotoAlbum, isAlbumPhoto } from './files/PhotoAlbum'
import { arrivedPending, localId, removePending, rowKeyOf, usePending, type PendingSend } from './chat/pendingStore'
import { Avatar } from './people/Avatar'
import { useProfileCard } from './people/ProfileCard'
import { ChatIcon } from './chat/ChatIcon'
import { closeOpenFence, insideCodeFence } from './chat/composerText'
import { ThreadDeleteDialog, deleteReasonHint, threadDeleteMessage } from './chat/threadActions'
import { LinkPreviewCard } from './chat/LinkPreviewCard'
import { BookmarksPanel } from './chat/BookmarksPanel'
import { WikiSendDialog } from './chat/WikiSendDialog'
import { bookmarkKey, copyText, notePendingReply, plainSummary, useBookmarks, useReplyRefs } from './chat/chatStore'
import { lastSeqBySender, unreadBy } from '@shared/receipts'
import { membersOf, useReceipts } from '../lib/receipts'

interface Props {
  messages: Message[]
  meId: string | null
  /** 메시지 액션. 스레드 안에서는 스레드 관련 액션을 숨긴다 */
  inThread?: boolean
  onReply?: (m: Message) => void
  onOpenThread?: (m: Message) => void
  onStartThread?: (m: Message) => void
  onChanged: () => void
  canLoadMore?: boolean
  onLoadMore?: () => void
  highlightId?: string | null
  /** 이 시각 이후 메시지 앞에 "여기까지 읽음" 구분선 (셸이 넘긴다, 채팅 영역이 그린다) */
  readMarkerAt?: string | null
  /** 스레드 안 목록이면 스레드가 달린 원래 대화방 (북마크에서 다시 찾아갈 때 쓴다) */
  parentChannelId?: string | null
  /** 목록 오른쪽 위 북마크 진입 버튼 (기본: 스레드 밖에서만 보임) */
  showBookmarksEntry?: boolean
  /** 처음 불러오는 중이면 메시지 자리 표시(스켈레톤) */
  loading?: boolean
  /** 같은 키로 Composer 가 넣은 "보내는 중" 메시지를 맨 아래에 그린다 */
  pendingKey?: string
  /** 맨 아래로 돌아왔을 때: 불러온 범위를 처음 크기로 줄여도 된다 */
  onTrim?: () => void
}

const NO_IDS: string[] = []

/** 같은 사람이 이 간격 안에 이어 보낸 메시지는 묶는다 */
const GROUP_GAP_MS = 5 * 60 * 1000

/** 입력창(Composer)이 빈 칸에서 ↑ 를 누르면 보내는 이벤트. 같은 영역의 목록이 받아 내 마지막 메시지를 수정 모드로 연다. */
export const EDIT_LAST_EVENT = 'rakm-chat:edit-last'
export interface EditLastDetail {
  from: Element
  handled: boolean
}

/** 마크다운 본문 안의 멘션(프로필 카드)·위키 링크(앱 안 이동) 클릭을 처리한다 */
export function useRichContentClicks(meId: string | null) {
  const card = useProfileCard(meId)
  const onClick = useCallback(
    (e: MouseEvent<HTMLElement>) => {
      const t = e.target as HTMLElement
      const mention = t.closest<HTMLElement>('.mention[data-member-id]')
      if (mention?.dataset.memberId) {
        e.preventDefault()
        card.open(mention.dataset.memberId, mention)
        return
      }
      const a = t.closest<HTMLAnchorElement>('a[href]')
      if (a) {
        const w = parseWikiUrl(a.href)
        if (w) {
          e.preventDefault()
          navigate({ kind: 'wikiPage', ...w })
        }
      }
    },
    [card]
  )
  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>) => {
      const t = e.target as HTMLElement
      if ((e.key === 'Enter' || e.key === ' ') && t.matches('.mention[data-member-id]')) {
        e.preventDefault()
        card.open(t.dataset.memberId!, t)
      }
    },
    [card]
  )
  return { onClick, onKeyDown, open: card.open, node: card.node }
}

/** 처음·맨 아래에서 그리는 줄 수. 위로 올리면 STEP 씩 늘린다 (수천 개를 한꺼번에 DOM 에 두지 않는다) */
const WINDOW_ROWS = 120
const WINDOW_STEP = 120
/** 그린 범위의 위쪽 끝에서 이만큼 안이면 보관함·서버에서 더 불러온다 */
const PREFETCH_ROWS = 80
/** 한 번에 DOM 에 두는 최대 줄 수. 위로 많이 올라가면 아래쪽(지나온 것)을 떼어 낸다 */
const MAX_RENDER_ROWS = 360
/** 앨범 하나에 묶는 최대 장수 (한 번에 보낼 수 있는 수와 같게) */
const MAX_ALBUM = 30

export type Row =
  | { kind: 'msg'; key: string; m: Message; day: string | null; marker: boolean; grouped: boolean; system: boolean }
  | { kind: 'album'; key: string; ms: Message[]; day: string | null; marker: boolean; grouped: boolean }

const isSystem = (m: Message) => (!!m.senderType && m.senderType !== 'member' && m.senderType !== 'app') || !!parseSystem(m)

/** 메시지 → 그릴 줄 (날짜 구분선·읽음 표시·같은 사람 묶기·사진 앨범). 메시지가 바뀔 때만 다시 만든다 */
export function buildRows(messages: Message[], markerId: string | null): Row[] {
  const rows: Row[] = []
  let lastDay = ''
  let lastSender: string | null = null
  let lastTime = 0
  let lastHadThread = false
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const day = m.sentAt ? formatDay(m.sentAt) : ''
    const showDay = !!day && day !== lastDay
    const marker = m.id === markerId
    const t = m.sentAt ? Date.parse(m.sentAt) : 0
    const system = isSystem(m)
    const grouped =
      !showDay && !marker && !system && !lastHadThread && lastSender === m.senderId && t - lastTime < GROUP_GAP_MS && t >= lastTime && m.type !== 'REPLY'
    lastDay = day || lastDay
    // 사진 앨범: 같은 사람이 짧은 간격으로 이어 보낸 사진 2장 이상
    if (!system && isAlbumPhoto(m)) {
      let j = i + 1
      let prevT = t
      while (j < messages.length) {
        const n = messages[j]
        const nt = n.sentAt ? Date.parse(n.sentAt) : 0
        if (j - i >= MAX_ALBUM || !isAlbumPhoto(n) || n.senderId !== m.senderId || n.id === markerId || nt - prevT > ALBUM_GAP_MS || nt < prevT) break
        if ((n.sentAt ? formatDay(n.sentAt) : '') !== (day || lastDay)) break
        prevT = nt
        j++
      }
      if (j - i >= 2) {
        const ms = messages.slice(i, j)
        rows.push({ kind: 'album', key: `a:${m.id}`, ms, day: showDay ? day : null, marker, grouped })
        lastSender = m.senderId
        lastTime = prevT
        lastHadThread = false
        i = j - 1
        continue
      }
    }
    rows.push({ kind: 'msg', key: rowKeyOf(m.id), m, day: showDay ? day : null, marker, grouped, system })
    lastSender = system ? null : m.senderId
    lastTime = t
    lastHadThread = !!m.thread
  }
  return rows
}

/** 목록 항목이 부르는 동작. 참조가 바뀌지 않아 항목(React.memo)을 다시 그리지 않는다 */
interface Actions {
  reply: (m: Message) => void
  openThread: (m: Message) => void
  startThread: (m: Message) => void
  changed: () => void
  jump: (id: string) => void
  openProfile: (memberId: string, el: Element) => void
  toggleBookmark: (m: Message) => void
  sendToWiki: (m: Message) => void
  setEditing: (id: string | null) => void
}

export function MessageList(props: Props) {
  const { messages, meId, inThread, readMarkerAt } = props
  // 읽음 확인: 내 메시지를 아직 이 앱에서 읽지 않은 사람 (기록이 있는 사람만 센다)
  const receipts = useReceipts()
  const laterBy = useMemo(() => lastSeqBySender(messages), [messages])
  const receiptMembers = membersOf(props.parentChannelId ?? messages[0]?.channelId)
  const { toast } = useApp()
  const scroller = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)
  const lastCount = useRef(0)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)
  const [wikiSend, setWikiSend] = useState<Message | null>(null)
  const [bookmarksOpen, setBookmarksOpen] = useState(false)
  const rich = useRichContentClicks(meId)
  const channelId = messages[0]?.channelId ?? null
  const replyRefs = useReplyRefs(channelId, messages, meId)
  const bookmarks = useBookmarks()
  const bookmarked = useMemo(() => new Set(bookmarks.list.map((b) => b.key)), [bookmarks.list])
  const pending = usePending(props.pendingKey)

  const inner = useRef<HTMLDivElement>(null)
  const lastId = useRef<string | null>(null)
  const lastPending = useRef(0)
  /** 위로 올려 보는 동안 아래에 새로 온 남의 메시지 수 */
  const [unseen, setUnseen] = useState(0)
  /** 맨 아래에서 꽤 떨어져 있음 → "최근 메시지로" 버튼 */
  const [farFromBottom, setFarFromBottom] = useState(false)

  // "여기까지 읽음": 표시 시각 이후 처음 온 남의 메시지 앞
  const markerId = useMemo(() => {
    if (!readMarkerAt) return null
    const at = Date.parse(readMarkerAt)
    if (Number.isNaN(at)) return null
    const first = messages.find((m) => m.sentAt && Date.parse(m.sentAt) > at && m.senderId !== meId)
    return first?.id ?? null
  }, [messages, readMarkerAt, meId])

  // 보내는 중인 내 메시지: 진짜 메시지와 같은 줄로 맨 아래에 붙인다 (같은 묶기·날짜 규칙, 같은 모양·높이).
  // 목록에 들어온 것은 이 렌더에서 바로 빼서 둘이 함께 보이는 순간이 없게 한다
  // 이 방에 첨부를 올리는 중이면, 올리기 시작한 뒤 들어온 내 첨부는 다 끝날 때까지 그리지 않는다 (앨범이 한 장씩 자라며 격자가 바뀌지 않게)
  const held = useUploadHold(props.pendingKey ? props.pendingKey.replace(/^thread:/, '') : channelId)
  const knownAtHold = useRef<Set<string> | null>(null)
  if (held && !knownAtHold.current) knownAtHold.current = new Set(messages.map((m) => m.id))
  if (!held && knownAtHold.current) knownAtHold.current = null
  const known = knownAtHold.current
  const shownMessages = useMemo(
    () => (known ? messages.filter((m) => known.has(m.id) || !m.file || !meId || m.senderId !== meId) : messages),
    [messages, known, meId]
  )
  const arrived = useMemo(() => arrivedPending(pending, messages, meId), [pending, messages, meId])
  const shownPending = useMemo(() => (arrived.size ? pending.filter((p) => !arrived.has(p.id)) : pending), [pending, arrived])
  useEffect(() => {
    for (const id of arrived) removePending(id)
  }, [arrived])
  const pendingById = useMemo(() => new Map(shownPending.map((p) => [localId(p), p])), [shownPending])
  const withPending = useMemo(
    () => (shownPending.length ? [...shownMessages, ...shownPending.map((p) => pendingMessage(p, meId, channelId))] : shownMessages),
    [shownMessages, shownPending, meId, channelId]
  )
  const rows = useMemo(() => buildRows(withPending, markerId), [withPending, markerId])

  // ---------- 그릴 범위 (아래에서부터 windowRows 줄) ----------
  const [windowRows, setWindowRows] = useState(WINDOW_ROWS)
  /** 아래쪽에서 떼어 낸 줄 수 (많이 올라가 있을 때만). 0 이면 맨 아래까지 그린다 */
  const [hiddenBelow, setHiddenBelow] = useState(0)
  const viewKey = props.pendingKey ?? channelId
  useEffect(() => {
    setWindowRows(WINDOW_ROWS)
    setHiddenBelow(0)
  }, [viewKey])
  const start = Math.max(0, rows.length - windowRows)
  // 어떤 순서로 상태가 바뀌어도 최소 WINDOW_STEP 줄은 그린다
  const below = Math.min(hiddenBelow, Math.max(0, rows.length - start - WINDOW_STEP))
  const end = rows.length - below
  const visible = start > 0 || end < rows.length ? rows.slice(start, end) : rows
  const backToLatest = () => {
    setHiddenBelow(0)
    setWindowRows(WINDOW_ROWS)
  }

  /** 위에 줄이 붙어도 보던 자리를 지키려고, 바꾸기 전 화면 맨 위 줄과 그 위치를 적어 둔다 */
  const anchor = useRef<{ key: string; top: number; firstKey: string | undefined; at: number } | null>(null)
  const captureAnchor = () => {
    const el = scroller.current
    if (!el) return
    const top = el.getBoundingClientRect().top
    for (const row of el.querySelectorAll<HTMLElement>('[data-row-key]')) {
      const r = row.getBoundingClientRect()
      if (r.bottom > top) {
        anchor.current = { key: row.dataset.rowKey!, top: r.top, firstKey: visible[0]?.key, at: Date.now() }
        return
      }
    }
  }
  useLayoutEffect(() => {
    const a = anchor.current
    const el = scroller.current
    if (!a || !el) return
    if (visible[0]?.key === a.firstKey) {
      if (Date.now() - a.at > 10_000) anchor.current = null // 불러오기가 끝났는데 더 없음
      return
    }
    const row = el.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(a.key)}"]`)
    if (row) el.scrollTop += row.getBoundingClientRect().top - a.top
    anchor.current = null
  }, [visible])

  const loadingOlder = useRef(false)
  useEffect(() => {
    loadingOlder.current = false
  }, [messages.length])

  /** 위쪽 끝 근처: 그린 범위를 넓히고, 불러온 것의 끝이 가까우면 더 불러온다 */
  const growUp = () => {
    if (anchor.current) return
    const canGrow = start > 0
    const nearLoadedTop = start - WINDOW_STEP < PREFETCH_ROWS
    const willLoad = nearLoadedTop && props.canLoadMore && !!props.onLoadMore && !loadingOlder.current
    if (!canGrow && !willLoad) return
    captureAnchor()
    const nextWindow = Math.min(windowRows + WINDOW_STEP, Math.max(rows.length, windowRows) + WINDOW_STEP)
    setWindowRows(nextWindow)
    // 그리는 줄이 너무 많아지면 아래(지나온 것)를 떼어 낸다. 위쪽 내용은 그대로라 보던 자리는 움직이지 않는다
    const rendered = Math.min(rows.length, nextWindow) - below
    if (rendered > MAX_RENDER_ROWS) setHiddenBelow(below + rendered - MAX_RENDER_ROWS)
    if (willLoad) {
      loadingOlder.current = true
      props.onLoadMore!()
    }
  }

  // 새 메시지가 오면, 사용자가 맨 아래를 보고 있을 때만 따라 내려간다. 내가 보낸 것이면 항상 내려간다 (슬랙과 같음)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const last = messages[messages.length - 1]
    const appended = !!last && last.id !== lastId.current && lastCount.current > 0
    const mineNew = (appended && !!meId && last.senderId === meId) || pending.length > lastPending.current
    if (mineNew && below > 0) {
      // 위에서 보다가 내가 보냈으면 맨 아래로 (떼어 낸 아래쪽을 다시 그리면 ResizeObserver 가 바닥에 붙인다)
      stickToBottom.current = true
      backToLatest()
    }
    if ((stickToBottom.current && below === 0) || lastCount.current === 0 || mineNew) {
      el.scrollTop = el.scrollHeight
      stickToBottom.current = true
      setUnseen(0)
    } else if (appended) {
      const prev = lastId.current ? messages.findIndex((m) => m.id === lastId.current) : -1
      const added = prev >= 0 ? messages.slice(prev + 1).filter((m) => m.senderId !== meId).length : 1
      if (added > 0) setUnseen((n) => n + added)
    }
    lastCount.current = messages.length
    lastId.current = last?.id ?? null
    lastPending.current = pending.length
  }, [messages, meId, pending.length])

  // 입력창이 자라거나 이미지·미리보기 카드가 늦게 그려져 높이가 바뀌어도, 맨 아래를 보고 있었다면 맨 아래에 붙어 있게
  useEffect(() => {
    const el = scroller.current
    const box = inner.current
    if (!el || !box || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (stickToBottom.current) el.scrollTop = el.scrollHeight
    })
    ro.observe(el)
    ro.observe(box)
    return () => ro.disconnect()
  }, [])

  const onTrim = props.onTrim
  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight
    // 아래쪽을 떼어 낸 동안은 진짜 맨 아래가 아니다: 가까이 오면 다시 붙인다
    if (below > 0 && gap < 600) setHiddenBelow((h) => Math.max(0, h - WINDOW_STEP))
    stickToBottom.current = gap < 80 && below === 0
    if (stickToBottom.current) {
      if (unseen) setUnseen(0)
      // 맨 아래로 돌아오면 그린 범위·불러온 범위를 처음 크기로 줄인다 (DOM·메모리·폴링 크기를 작게)
      if (windowRows > WINDOW_ROWS * 2) setWindowRows(WINDOW_ROWS)
      if (messages.length > WINDOW_ROWS * 3) onTrim?.()
    }
    const far = gap > 600
    if (far !== farFromBottom) setFarFromBottom(far)
    if (el.scrollTop < 600) growUp()
  }

  const toBottom = () => {
    const el = scroller.current
    if (!el) return
    stickToBottom.current = true
    setUnseen(0)
    if (below > 0 || windowRows > WINDOW_ROWS * 2) {
      // 멀리 있으면 애니메이션 없이 바로 (중간 수천 줄을 훑으며 그리지 않게)
      backToLatest()
      el.scrollTop = el.scrollHeight
    } else el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  // 빈 입력창에서 ↑ → 내 마지막 메시지 수정
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<EditLastDetail>).detail
      const el = scroller.current
      if (!el || d.handled || !el.parentElement?.contains(d.from)) return
      const last = [...messages].reverse().find((m) => meId && m.senderId === meId && m.type !== 'FILE' && m.flags !== 'DELETED_ROOT' && m.text)
      if (!last) return
      d.handled = true
      setEditingId(last.id)
      el.querySelector(`[data-msg-id="${CSS.escape(last.id)}"]`)?.scrollIntoView({ block: 'nearest' })
    }
    window.addEventListener(EDIT_LAST_EVENT, h)
    return () => window.removeEventListener(EDIT_LAST_EVENT, h)
  }, [messages, meId])

  /** 이 메시지가 들어 있는 줄이 그린 범위 밖이면 범위를 넓힌다. 이미 그려져 있으면 true */
  const reveal = useCallback(
    (id: string): boolean => {
      const idx = rows.findIndex((r) => (r.kind === 'msg' ? r.m.id === id : r.ms.some((x) => x.id === id)))
      if (idx < 0) return false
      if (idx >= start && idx < end) return true
      // 그 줄 앞뒤로 그린다
      const from = Math.max(0, idx - 40)
      setWindowRows(rows.length - from)
      setHiddenBelow(Math.max(0, rows.length - (from + MAX_RENDER_ROWS)))
      return false
    },
    [rows, start, end]
  )

  const [jumpWant, setJumpWant] = useState<string | null>(null)
  const jumpTo = useCallback(
    (id: string) => {
      if (!rows.some((r) => (r.kind === 'msg' ? r.m.id === id : r.ms.some((x) => x.id === id)))) {
        toast('원 메시지가 지금 불러온 범위에 없습니다. 위로 올려 이전 메시지를 더 불러오세요.', 'info')
        return
      }
      reveal(id)
      setJumpWant(id)
    },
    [toast, rows, reveal]
  )
  useEffect(() => {
    if (!jumpWant) return
    const el = scroller.current?.querySelector(`[data-msg-id="${CSS.escape(jumpWant)}"]`)
    if (!el) return
    stickToBottom.current = false
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setFlashId(jumpWant)
    setJumpWant(null)
    const id = jumpWant
    window.setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 1800)
  }, [jumpWant, visible])

  // 검색·알림에서 온 메시지: 그린 범위 밖이면 넓힌다 (그려지면 항목이 스스로 가운데로 온다)
  useEffect(() => {
    if (props.highlightId) {
      if (reveal(props.highlightId)) stickToBottom.current = false
    }
  }, [props.highlightId, reveal])

  // 항목에 넘기는 동작은 한 번만 만든다 (최신 props 는 ref 로 읽는다)
  const latest = useRef({ props, toast, bookmarks, rich, jumpTo })
  latest.current = { props, toast, bookmarks, rich, jumpTo }
  const act = useMemo<Actions>(
    () => ({
      reply: (m) => {
        notePendingReply(m)
        latest.current.props.onReply?.(m)
      },
      openThread: (m) => latest.current.props.onOpenThread?.(m),
      startThread: (m) => latest.current.props.onStartThread?.(m),
      changed: () => latest.current.props.onChanged(),
      jump: (id) => latest.current.jumpTo(id),
      openProfile: (id, el) => latest.current.rich.open(id, el),
      toggleBookmark: async (m) => {
        const { props: p, toast: t, bookmarks: b } = latest.current
        try {
          const on = await b.toggle(m, p.inThread ? (p.parentChannelId ?? null) : null)
          t(on ? '북마크에 넣었습니다.' : '북마크에서 뺐습니다.', 'info')
        } catch (e) {
          t(errorText(e))
        }
      },
      sendToWiki: (m) => setWikiSend(m),
      setEditing: (id) => setEditingId(id)
    }),
    []
  )

  const showEntry = props.showBookmarksEntry ?? !inThread
  const canReply = !!props.onReply
  const canStartThread = !inThread && !!props.onStartThread

  return (
    <div className="messages" ref={scroller} onScroll={onScroll} onClick={rich.onClick} onKeyDown={rich.onKeyDown} data-total={messages.length}>
      {showEntry && (
        <div className="msgs-tools">
          <button className="msgs-tool-btn" onClick={() => setBookmarksOpen(true)} title="북마크한 메시지 보기">
            <ChatIcon name="bookmark" size={14} />
            북마크{bookmarks.list.length > 0 && <span className="count">{bookmarks.list.length}</span>}
          </button>
        </div>
      )}
      <div className="msgs-inner" ref={inner}>
      {(start > 0 || props.canLoadMore) && (
        <button className="load-more" onClick={growUp}>
          {loadingOlder.current ? '이전 메시지 불러오는 중…' : '위로 올리면 이전 메시지를 더 불러옵니다'}
        </button>
      )}
      {messages.length === 0 &&
        pending.length === 0 &&
        (props.loading ? (
          <div className="msg-skeletons" aria-label="메시지를 불러오는 중" aria-busy="true">
            {[72, 46, 88, 58, 66].map((w, i) => (
              <div key={i} className="msg-skel">
                <span className="skel skel-avatar" />
                <span className="skel-lines">
                  <span className="skel skel-name" />
                  <span className="skel skel-line" style={{ width: `${w}%` }} />
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="msgs-empty">
            <b>{inThread ? '아직 답글이 없습니다' : '아직 메시지가 없습니다'}</b>
            <span>{inThread ? '아래 입력창에 첫 답글을 남겨 보세요.' : '첫 메시지를 보내 대화를 시작해 보세요.'}</span>
          </div>
        ))}
      {!props.canLoadMore && start === 0 && messages.length > 0 && messages.length >= 1000 && (
        <div className="muted center small">이 컴퓨터에 받아 둔 기록은 여기까지입니다.</div>
      )}
      {visible.map((r) => (
        <div key={r.key} data-row-key={r.key}>
          {r.day && (
            <div className="day-sep">
              <span>{r.day}</span>
            </div>
          )}
          {r.marker && (
            <div className="read-marker" role="separator" aria-label="여기까지 읽음">
              <span>여기까지 읽음</span>
            </div>
          )}
          {r.kind === 'album' ? (
            <AlbumItem ms={r.ms} mine={!!meId && r.ms[0].senderId === meId} grouped={r.grouped} canReply={canReply} act={act} />
          ) : (
            <MessageItem
              m={r.m}
              mine={!!meId && r.m.senderId === meId}
              unreadKey={receipts.enabled && meId && r.m.senderId === meId && !pendingById.has(r.m.id) ? unreadBy(r.m, receiptMembers, receipts, laterBy).join(',') : ''}
              grouped={r.grouped}
              system={r.system}
              inThread={!!inThread}
              canReply={canReply}
              canStartThread={canStartThread}
              editing={editingId === r.m.id}
              flash={flashId === r.m.id}
              highlighted={props.highlightId === r.m.id}
              replyRef={r.m.type === 'REPLY' ? (replyRefs.get(r.m.id) ?? null) : null}
              isBookmarked={bookmarked.has(bookmarkKey(r.m))}
              pending={pendingById.get(r.m.id)}
              act={act}
            />
          )}
        </div>
      ))}
      </div>
      {(unseen > 0 || farFromBottom || below > 0) && (
        <div className="jump-latest-wrap">
          <button className={`jump-latest ${unseen > 0 ? 'has-new' : ''}`} onClick={toBottom}>
            {unseen > 0 ? `새 메시지 ${unseen > 99 ? '99+' : unseen}개` : '최근 메시지로'}
            <ChatIcon name="arrowDown" size={14} />
          </button>
        </div>
      )}
      {rich.node}
      {wikiSend && <WikiSendDialog messages={[wikiSend]} onClose={() => setWikiSend(null)} />}
      {bookmarksOpen && (
        <div className="drawer-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setBookmarksOpen(false)}>
          <DrawerEsc onClose={() => setBookmarksOpen(false)} />
          <BookmarksPanel onClose={() => setBookmarksOpen(false)} channelId={props.parentChannelId ?? channelId ?? undefined} />
        </div>
      )}
    </div>
  )
}

function DrawerEsc({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return null
}

/** 보내는 중인 글 → 목록에 끼울 메시지 (서버가 준 것과 같은 모양) */
function pendingMessage(p: PendingSend, meId: string | null, channelId: string | null): Message {
  return {
    id: localId(p),
    channelId: channelId ?? '',
    seq: 0,
    type: 'TEXT',
    senderId: meId,
    senderType: 'member',
    sentAt: new Date(p.at).toISOString(),
    text: p.text,
    flags: null,
    file: null,
    thread: null
  }
}

/**
 * 보내는 상태 (읽음 숫자 자리, 오른쪽 아래에 겹쳐 그린다 — 줄을 더하지 않는다).
 * 금방 들어가면 아무것도 없고, 1초가 넘으면 작은 시계, 실패하면 빨간 느낌표 + 다시 보내기·지우기
 */
function SendState({ p }: { p: PendingSend }) {
  if (p.status === 'sending') return null
  if (p.status === 'slow') {
    return (
      <span className="send-state slow" role="status" title="보내는 중" aria-label="보내는 중">
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 4.6V8l2.4 1.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
    )
  }
  return (
    <span className="send-failed" role="alert">
      <button className="send-retry" onClick={() => void p.retry()} title={p.error ? `보내지 못했습니다 — ${p.error}` : '보내지 못했습니다'}>
        다시 보내기
      </button>
      <button className="send-discard" onClick={() => removePending(p.id)} title="이 글 지우기">
        지우기
      </button>
      <span className="send-state failed" title={p.error ? `보내지 못했습니다 — ${p.error}` : '보내지 못했습니다'} aria-label="보내지 못했습니다">
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="M8 4.3v4.4" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
          <circle cx="8" cy="11.4" r="1" fill="#fff" />
        </svg>
      </span>
    </span>
  )
}

/** 사진 앨범 한 줄 (같은 사람이 이어 보낸 사진 여러 장). 답장은 첫 사진에, 삭제는 묶음 전체 */
const AlbumItem = memo(function AlbumItem({ ms, mine, grouped, canReply, act }: { ms: Message[]; mine: boolean; grouped: boolean; canReply: boolean; act: Actions }) {
  const nameOf = useMemberNames()
  const { toast } = useApp()
  const first = ms[0]
  const sender = nameOf(first.senderId) ?? '…'
  const profileBtn = (el: Element) => first.senderId && act.openProfile(first.senderId, el)

  async function removeAll() {
    if (!window.confirm(`사진 ${ms.length}장을 모두 삭제할까요? 되돌릴 수 없습니다.`)) return
    let failed = 0
    let reason = ''
    for (const m of ms) {
      try {
        await call('messenger:delete', m.channelId, m.id)
      } catch (e) {
        failed++
        reason ||= errorText(e)
      }
    }
    if (failed) toast(`${failed}장은 지우지 못했습니다 — ${deleteReasonHint(reason)}`)
    act.changed()
  }

  return (
    <div className={`msg album-row ${grouped ? 'grouped' : ''} ${mine ? 'mine' : ''}`} data-msg-id={first.id}>
      <div className="msg-gutter">
        {grouped ? (
          <span className="msg-hover-time" title={formatTime(first.sentAt)}>
            {clockOf(first.sentAt)}
          </span>
        ) : (
          <button className="avatar-btn" onClick={(e) => profileBtn(e.currentTarget)} aria-label={`${sender} 프로필`} disabled={!first.senderId}>
            <Avatar memberId={first.senderId} size={36} />
          </button>
        )}
      </div>
      <div className="msg-main">
        {!grouped && (
          <div className="msg-head">
            <button className="msg-sender" onClick={(e) => profileBtn(e.currentTarget)} disabled={!first.senderId}>
              {sender}
            </button>
            <span className="msg-time">{formatTime(first.sentAt)}</span>
          </div>
        )}
        <PhotoAlbum messages={ms} />
        <div className="album-meta muted small">사진 {ms.length}장</div>
      </div>
      <div className="msg-actions" role="toolbar" aria-label="사진 묶음 동작">
        {canReply && (
          <button title="답장" aria-label="답장" onClick={() => act.reply(first)}>
            <Icon name="reply" size={15} />
          </button>
        )}
        {mine && (
          <button title={`사진 ${ms.length}장 삭제`} aria-label="묶음 삭제" className="danger" onClick={() => void removeAll()}>
            <Icon name="trash" size={15} />
          </button>
        )}
      </div>
    </div>
  )
})

interface ItemProps {
  m: Message
  mine: boolean
  /** 이 내 메시지를 아직 이 앱에서 읽지 않은 사람 (쉼표로 이은 ID — 배열이면 매번 새 참조라 memo 가 깨진다) */
  unreadKey: string
  grouped: boolean
  system: boolean
  inThread: boolean
  canReply: boolean
  canStartThread: boolean
  editing: boolean
  flash: boolean
  highlighted: boolean
  replyRef: ReplyRef | null
  isBookmarked: boolean
  /** 보내는 중인 내 메시지 (낙관적 전송) */
  pending?: PendingSend
  act: Actions
}

function clockOf(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
}

const MessageItem = memo(function MessageItem({
  m,
  mine,
  unreadKey,
  grouped,
  system,
  inThread,
  canReply,
  canStartThread,
  editing,
  flash,
  highlighted,
  replyRef,
  isBookmarked,
  pending,
  act
}: ItemProps) {
  const unreadIds = unreadKey ? unreadKey.split(',') : NO_IDS
  const setEditing = (v: boolean) => act.setEditing(v ? m.id : null)
  const onChanged = act.changed
  const nameOf = useMemberNames()
  const { toast } = useApp()
  const [draft, setDraft] = useState(m.text)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (highlighted) ref.current?.scrollIntoView({ block: 'center' })
  }, [highlighted])

  useEffect(() => {
    if (editing) setDraft(m.text)
  }, [editing, m.text])

  const html = useMemo(() => (m.text ? renderMarkdown(m.text) : ''), [m.text])
  const previewUrl = useMemo(() => (m.text ? firstPreviewUrl(m.text) : null), [m.text])

  const deleted = m.flags === 'DELETED_ROOT'
  const isApp = m.senderType === 'app'
  const sender = isApp ? '봇' : (nameOf(m.senderId) ?? '…')
  const topic = m.thread ? parseTopic(m.text) : null

  async function saveEdit() {
    if (!draft.trim() || draft === m.text) return setEditing(false)
    setBusy(true)
    try {
      await call('messenger:update', m.channelId, m.id, closeOpenFence(draft))
      setEditing(false)
      onChanged()
    } catch (e) {
      toast(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const [deletingThread, setDeletingThread] = useState(false)

  async function remove() {
    // 스레드가 달린 메시지: 스레드 안 내 답글까지 같이 지울지 묻는 창으로
    if (m.thread && !inThread) return setDeletingThread(true)
    if (!window.confirm('이 메시지를 삭제할까요? 되돌릴 수 없습니다.')) return
    try {
      await call('messenger:delete', m.channelId, m.id)
      onChanged()
    } catch (e) {
      toast(deleteReasonHint(errorText(e)))
    }
  }

  async function copy() {
    const text = m.text.replace(/\[@([^\]]+)\]\(dooray:\/\/[^)]*\)/g, '@$1')
    const ok = await copyText(text)
    toast(ok ? '메시지를 복사했습니다.' : '복사하지 못했습니다.', ok ? 'info' : 'error')
  }

  if (system) {
    const sys = parseSystem(m)
    return <div className="msg-system">{sys ? systemText(sys, nameOf) : m.text}</div>
  }

  const profileBtn = (el: Element) => m.senderId && !isApp && act.openProfile(m.senderId, el)

  return (
    <div
      ref={ref}
      data-msg-id={m.id}
      className={`msg ${grouped ? 'grouped' : ''} ${mine ? 'mine' : ''} ${highlighted || flash ? 'highlight' : ''} ${editing ? 'editing' : ''}${pending ? ` pending ${pending.status}` : ''}`}
      aria-busy={pending && pending.status !== 'failed' ? true : undefined}
    >
      <div className="msg-gutter">
        {grouped ? (
          <span className="msg-hover-time" title={formatTime(m.sentAt)}>
            {clockOf(m.sentAt)}
          </span>
        ) : (
          <button className="avatar-btn" onClick={(e) => profileBtn(e.currentTarget)} aria-label={`${sender} 프로필`} disabled={!m.senderId || isApp}>
            <Avatar memberId={isApp ? null : m.senderId} name={isApp ? '봇' : undefined} size={36} />
          </button>
        )}
      </div>
      <div className="msg-main">
        {!grouped && (
          <div className="msg-head">
            <button className="msg-sender" onClick={(e) => profileBtn(e.currentTarget)} disabled={!m.senderId || isApp}>
              {sender}
            </button>
            <span className="msg-time" title={m.sentAt ? new Date(m.sentAt).toLocaleString('ko-KR') : undefined}>
              {formatTime(m.sentAt)}
            </span>
          </div>
        )}
        {m.type === 'REPLY' && !deleted && <ReplyQuote refInfo={replyRef} onJump={act.jump} />}
        {editing ? (
          <div className="msg-edit">
            <textarea
              value={draft}
              className={/```/.test(draft) ? 'has-code' : undefined}
              autoFocus
              onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation()
                  setEditing(false)
                }
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  // 코드 블록 안에서는 줄바꿈 (⌘Enter 는 저장)
                  if (!e.metaKey && !e.ctrlKey && insideCodeFence(draft, e.currentTarget.selectionStart ?? draft.length)) return
                  e.preventDefault()
                  void saveEdit()
                }
              }}
            />
            <div className="row">
              <button className="primary small" disabled={busy} onClick={() => void saveEdit()}>
                저장
              </button>
              <button className="small" onClick={() => setEditing(false)}>
                취소
              </button>
              <span className="muted small">Enter 저장 · Esc 취소 · 코드 블록 안에서는 ⌘Enter 저장</span>
            </div>
          </div>
        ) : deleted ? (
          <div className="msg-body muted">(삭제된 메시지)</div>
        ) : (
          m.text && <div className="msg-body md" dangerouslySetInnerHTML={{ __html: html }} />
        )}
        {!editing && !deleted && previewUrl && <LinkPreviewCard url={previewUrl} />}
        {m.file && <FileAttachment message={m} />}
        {m.thread && !inThread && (
          <button className="thread-chip" onClick={() => act.openThread(m)}>
            <Icon name="thread" size={14} />
            {topic?.project && <span className="tag">{topic.project}</span>}
            <span>스레드 {m.thread.totalCount}개</span>
            {m.thread.lastUpdatedAt && <span className="muted">· {formatTime(m.thread.lastUpdatedAt)}</span>}
          </button>
        )}
      </div>
      {unreadIds.length > 0 && !deleted && (
        <span
          className="receipt-unread"
          title={`${unreadIds.map((id) => nameOf(id)).join(', ')}님이 이 앱에서 아직 읽지 않음 (두레이 모바일·웹에서 읽은 것은 표시되지 않습니다)`}
          aria-label={`안 읽은 사람 ${unreadIds.length}명`}
        >
          {unreadIds.length}
        </span>
      )}
      {pending && <SendState p={pending} />}
      {deletingThread && m.thread && (
        <ThreadDeleteDialog
          target={{ threadChannelId: m.thread.channelId, parentChannelId: m.channelId, root: m }}
          meId={m.senderId}
          title={topic?.title ?? ''}
          onClose={() => setDeletingThread(false)}
          onDone={(r) => {
            setDeletingThread(false)
            toast(threadDeleteMessage(r), r.failed ? 'error' : 'info')
            onChanged()
          }}
        />
      )}
      {!editing && !deleted && !pending && (
        <div className="msg-actions" role="toolbar" aria-label="메시지 동작">
          {canReply && (
            <button title="답장" aria-label="답장" onClick={() => act.reply(m)}>
              <Icon name="reply" size={15} />
            </button>
          )}
          {canStartThread && !m.thread && (
            <button title="스레드로 답하기" aria-label="스레드로 답하기" onClick={() => act.startThread(m)}>
              <Icon name="thread" size={15} />
            </button>
          )}
          <button
            title={isBookmarked ? '북마크 빼기' : '북마크'}
            aria-label={isBookmarked ? '북마크 빼기' : '북마크'}
            aria-pressed={isBookmarked}
            className={isBookmarked ? 'on' : ''}
            onClick={() => act.toggleBookmark(m)}
          >
            <ChatIcon name={isBookmarked ? 'bookmarkFill' : 'bookmark'} size={15} />
          </button>
          <button title="위키로 보내기" aria-label="위키로 보내기" onClick={() => act.sendToWiki(m)}>
            <ChatIcon name="wiki" size={15} />
          </button>
          {m.text && (
            <button title="복사" aria-label="복사" onClick={() => void copy()}>
              <ChatIcon name="copy" size={15} />
            </button>
          )}
          {mine && m.type !== 'FILE' && (
            <button title="수정 (빈 입력창에서 ↑)" aria-label="수정" onClick={() => setEditing(true)}>
              <Icon name="edit" size={15} />
            </button>
          )}
          {mine && (
            <button title="삭제" aria-label="삭제" className="danger" onClick={() => void remove()}>
              <Icon name="trash" size={15} />
            </button>
          )}
        </div>
      )}
    </div>
  )
})

function ReplyQuote({ refInfo, onJump }: { refInfo: ReplyRef | null; onJump: (id: string) => void }) {
  const nameOf = useMemberNames()
  if (!refInfo) {
    return (
      <div className="reply-badge" title="두레이 API 가 원 메시지 정보를 주지 않아, 이 앱에서 보낸 답장만 원문을 보여줍니다.">
        <Icon name="reply" size={12} /> 답장
      </div>
    )
  }
  return (
    <button className="reply-quote" onClick={() => onJump(refInfo.originalId)} title="원 메시지로 이동">
      <span className="reply-quote-who">
        <Avatar memberId={refInfo.originalSenderId} size={16} />
        <b>{nameOf(refInfo.originalSenderId) ?? '…'}</b>
      </span>
      <span className="reply-quote-text">{plainSummary(refInfo.originalText, 140) || '(내용 없음)'}</span>
    </button>
  )
}
