import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type { Channel, Member, Message, ProjectGroup } from '@shared/types'
import type { ChannelSummary } from '@shared/types-shell'
import { call, errorText, onEvent } from '../api'
import { rememberMember, useApp, useMemberNames } from '../state'
import { useChannelLogs, useInterval } from '../lib/hooks'
import {
  channelTitle,
  collectThreads,
  directPartner,
  findDirectChannel,
  formatTopic,
  groupChannels,
  moveInOrder,
  nextColor,
  parseTopic,
  sameProject,
  threadTime,
  unreadCount,
  type ChannelSection,
  type ThreadEntry
} from '../lib/projects'
import { formatTime } from '../lib/format'
import { onNav } from '../lib/nav'
import { MessageList } from '../components/MessageList'
import { FileDropArea } from '../components/files/FileDropArea'
import { FileGallery } from '../components/files/FileGallery'
import { Composer } from '../components/Composer'
import { ThreadPanel, type OpenThread } from '../components/ThreadPanel'
import { rememberReply } from '../components/chat/chatStore'
import { Modal } from '../components/Modal'
import { Icon } from '../components/Icon'
import { Avatar } from '../components/people/Avatar'
import { matchScore } from '../shell/match'
import { pushRecent } from '../shell/recent'
import { navHistory } from '../shell/history'
import { openSearch } from '../shell/overlay'

type Selection = { kind: 'channel'; id: string } | { kind: 'project'; id: string } | null
type Dialog =
  | { kind: 'projects' }
  | { kind: 'newChannel' }
  | { kind: 'direct'; memberId: string }
  | { kind: 'projectTopic'; projectId: string }
  | null

const DRAG_TYPE = 'application/x-rakm-channel'

export function MessengerView({ active }: { active: boolean }) {
  const { ui, updateUi, settings, shell, updateShell, unread } = useApp()
  const nameOf = useMemberNames()
  const [channels, setChannels] = useState<Channel[]>([])
  const [loaded, setLoaded] = useState(false)
  const [me, setMe] = useState<Member | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [thread, setThread] = useState<OpenThread | null>(null)
  const [filter, setFilter] = useState('')
  const [dialog, setDialog] = useState<Dialog>(null)
  /** 대화방을 열 때 받아 둔 "여기까지 읽음" 시각 */
  const [readMarker, setReadMarker] = useState<{ channelId: string; at: string | null } | null>(null)
  /** 검색·알림에서 온 메시지 위치 */
  const [focusMsg, setFocusMsg] = useState<{ channelId: string; messageId: string } | null>(null)
  const pendingNav = useRef<Parameters<Parameters<typeof onNav>[0]>[0] | null>(null)
  const restored = useRef(false)
  const configured = !!settings && settings.dooray.tokenSource !== 'none'
  const layout = shell?.layout

  const loadChannels = useCallback(async () => {
    try {
      const list = await call('messenger:channels')
      setChannels(list)
      setLoaded(true)
      setError(null)
      return list
    } catch (e) {
      setError(errorText(e))
      return null
    }
  }, [])

  useEffect(() => {
    if (!configured) return
    void loadChannels()
    call('messenger:me')
      .then((m) => {
        rememberMember(m)
        setMe(m)
      })
      .catch(() => {})
  }, [loadChannels, configured, settings?.dooray.apiBase])

  // 채널 목록은 30초마다 (main 이 그 사이 대화방을 돌며 안 읽음·알림을 계산한다)
  useInterval(() => void loadChannels(), 30_000, configured)

  const selectedChannel = selection?.kind === 'channel' ? (channels.find((c) => c.id === selection.id) ?? null) : null

  const openChannel = useCallback(
    (c: Channel, opts: { messageId?: string; record?: boolean } = {}) => {
      setSelection({ kind: 'channel', id: c.id })
      setThread(null)
      setFocusMsg(opts.messageId ? { channelId: c.id, messageId: opts.messageId } : null)
      if (opts.record !== false) navHistory.push({ kind: 'channel', channelId: c.id })
      call('shell:openChannel', c.id)
        .then((r) => setReadMarker({ channelId: c.id, at: r.readAt }))
        .catch(() => setReadMarker(null))
      updateUi((u) => ({ ...u, lastSeenAt: { ...u.lastSeenAt, [c.id]: c.updatedAt ?? new Date().toISOString() } }))
      updateShell((s) => ({
        ...s,
        layout: {
          ...s.layout,
          last: { ...s.layout.last, channelId: c.id },
          recent: pushRecent(s.layout.recent, {
            label: channelTitle(c, nameOf),
            sub: c.type === 'direct' ? '1:1 대화' : '대화방',
            target: { kind: 'channel', channelId: c.id }
          })
        }
      }))
    },
    [updateUi, updateShell, nameOf]
  )

  const openThread = useCallback(
    (t: OpenThread) => {
      setThread(t)
      const topic = parseTopic(t.root?.text ?? t.title ?? '')
      updateShell((s) => ({
        ...s,
        layout: {
          ...s.layout,
          recent: pushRecent(s.layout.recent, {
            label: topic.title || '스레드',
            sub: topic.project ? `[${topic.project}] 스레드` : '스레드',
            target: { kind: 'thread', channelId: t.parentChannelId, threadChannelId: t.threadChannelId }
          })
        }
      }))
    },
    [updateShell]
  )

  // 화면 이동 버스 (⌘K, 검색, 알림, 다른 영역)
  const applyNav = useCallback(
    (req: NonNullable<typeof pendingNav.current>, list: Channel[]): boolean => {
      if (req.kind === 'channel' || req.kind === 'thread') {
        const c = list.find((x) => x.id === req.channelId)
        if (!c) return false
        openChannel(c, { messageId: req.kind === 'channel' ? req.messageId : undefined, record: false })
        if (req.kind === 'thread') setThread({ threadChannelId: req.threadChannelId, parentChannelId: c.id, root: null })
        return true
      }
      if (req.kind === 'direct') {
        const c = findDirectChannel(list, req.memberId)
        if (c) openChannel(c, { record: false })
        else setDialog({ kind: 'direct', memberId: req.memberId })
        return true
      }
      return true
    },
    [openChannel]
  )

  useEffect(
    () =>
      onNav((req) => {
        if (req.kind === 'wikiPage' || req.kind === 'settings') return
        if (!applyNav(req, channels)) {
          // 목록이 아직 없거나 새로 생긴 방이면 다시 읽고 처리한다
          pendingNav.current = req
          void loadChannels()
        }
      }),
    [applyNav, channels, loadChannels]
  )

  useEffect(() => {
    if (!loaded) return
    const req = pendingNav.current
    if (req) {
      pendingNav.current = null
      applyNav(req, channels)
      return
    }
    // 마지막으로 보던 방 다시 열기
    if (!restored.current && layout) {
      restored.current = true
      const c = layout.last.channelId ? channels.find((x) => x.id === layout.last.channelId) : null
      if (c && !selection) openChannel(c, { record: true })
    }
  }, [loaded, channels]) // eslint-disable-line react-hooks/exhaustive-deps

  // 지금 보이는 방을 main 에 알린다 (그 방은 알림을 띄우지 않고 읽음으로 둔다)
  const viewing = active && selection?.kind === 'channel' ? selection.id : null
  useEffect(() => {
    void call('shell:viewing', viewing).catch(() => {})
  }, [viewing])
  useEffect(() => () => void call('shell:viewing', null).catch(() => {}), [])
  // 창이 뒤에 있는 동안 온 메시지 앞에 "여기까지 읽음" 을 다시 긋는다 (창이 앞에 오면 main 이 알려 준다)
  useEffect(() => onEvent('shell:readMarker', (m) => setReadMarker({ channelId: m.channelId, at: m.readAt })), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && thread && active) setThread(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [thread, active])

  const sections = useMemo(() => groupChannels(channels, ui, layout ?? { favorites: [], order: {} }), [channels, ui, layout])
  const q = filter.trim()
  const collapsed = new Set(layout?.collapsed ?? ['hidden'])
  const muted = new Set(shell?.prefs.notify.muted ?? [])

  const toggleSection = (key: string) =>
    updateShell((s) => {
      const set = new Set(s.layout.collapsed)
      if (set.has(key)) set.delete(key)
      else set.add(key)
      return { ...s, layout: { ...s.layout, collapsed: [...set] } }
    })

  // ---------- 끌어서 순서 바꾸기 / 폴더로 옮기기 ----------
  const [drag, setDrag] = useState<{ id: string; from: string } | null>(null)
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | { section: string } | null>(null)

  const dropOnRow = (section: ChannelSection, targetId: string, after: boolean) => {
    if (!drag) return
    const ids = section.channels.map((c) => c.id)
    if (drag.from !== section.key) {
      moveToSection(drag.id, section.key)
      if (!ids.includes(drag.id)) ids.push(drag.id)
    }
    const next = moveInOrder(ids, drag.id, targetId, after)
    updateShell((s) =>
      section.key === 'fav'
        ? { ...s, layout: { ...s.layout, favorites: next } }
        : { ...s, layout: { ...s.layout, order: { ...s.layout.order, [section.key]: next } } }
    )
  }

  /** 다른 섹션 머리글에 놓으면: 즐겨찾기 고정 / 프로젝트 폴더에 넣기 / 미분류로 빼기 */
  const moveToSection = (id: string, key: string) => {
    const fromFav = layout?.favorites.includes(id)
    if (key === 'fav') {
      if (!fromFav) updateShell((s) => ({ ...s, layout: { ...s.layout, favorites: [...s.layout.favorites, id] } }))
      return
    }
    if (fromFav) updateShell((s) => ({ ...s, layout: { ...s.layout, favorites: s.layout.favorites.filter((x) => x !== id) } }))
    if (key.startsWith('p:')) {
      updateUi((u) => ({ ...u, channelProject: { ...u.channelProject, [id]: key.slice(2) }, hiddenChannels: u.hiddenChannels.filter((x) => x !== id) }))
    } else if (key === 'direct' || key === 'other') {
      updateUi((u) => {
        const channelProject = { ...u.channelProject }
        delete channelProject[id]
        return { ...u, channelProject, hiddenChannels: u.hiddenChannels.filter((x) => x !== id) }
      })
    } else if (key === 'hidden') {
      updateUi((u) => ({ ...u, hiddenChannels: u.hiddenChannels.includes(id) ? u.hiddenChannels : [...u.hiddenChannels, id] }))
    }
  }

  if (!configured) {
    return (
      <div className="empty">
        <p>설정 화면에서 두레이 개인 API 토큰을 먼저 입력하세요.</p>
      </div>
    )
  }

  const recentThreads = (layout?.recent ?? []).filter((r) => r.target.kind === 'thread').slice(0, 8)

  return (
    <div className="cols">
      <aside className="list-col" aria-label="대화방 목록">
        <div className="pane-head">
          <input
            className="search"
            placeholder="대화방 찾기 (초성 가능)"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="대화방 찾기"
          />
          <button className="icon-btn" title="프로젝트 관리" aria-label="프로젝트 관리" onClick={() => setDialog({ kind: 'projects' })}>
            <Icon name="tag" size={16} />
          </button>
          <button className="icon-btn" title="새 대화방" aria-label="새 대화방" onClick={() => setDialog({ kind: 'newChannel' })}>
            <Icon name="plus" size={16} />
          </button>
        </div>
        {error && <div className="banner banner-err">{error}</div>}
        <div className="list-scroll" onDragEnd={() => (setDrag(null), setDropAt(null))}>
          {sections.map((s) => {
            const list = q ? s.channels.filter((c) => matchScore(channelTitle(c, nameOf), q) > 0) : s.channels
            if (!s.project && list.length === 0 && !(s.key === 'fav' && drag)) return null
            const isCollapsed = collapsed.has(s.key) && !q
            const sectionUnread = list.reduce((n, c) => n + (muted.has(c.id) ? 0 : unreadCount(unread.summaries, c.id, viewing)), 0)
            const isDropSection = !!dropAt && 'section' in dropAt && dropAt.section === s.key
            return (
              <div key={s.key} className={`section ${isDropSection ? 'drop-into' : ''}`}>
                <div
                  className="section-head"
                  onDragOver={(e) => {
                    if (!drag || !e.dataTransfer.types.includes(DRAG_TYPE)) return
                    e.preventDefault()
                    setDropAt({ section: s.key })
                  }}
                  onDragLeave={() => setDropAt((d) => (d && 'section' in d && d.section === s.key ? null : d))}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (drag && drag.from !== s.key) moveToSection(drag.id, s.key)
                    setDrag(null)
                    setDropAt(null)
                  }}
                >
                  <button className="section-toggle" aria-expanded={!isCollapsed} onClick={() => toggleSection(s.key)}>
                    <span className={`chev ${isCollapsed ? '' : 'open'}`}>
                      <Icon name="chevron" size={12} />
                    </span>
                    {s.key === 'fav' && (
                      <span className="fav-star">
                        <Icon name="star" size={12} />
                      </span>
                    )}
                    {s.project && <span className="dot" style={{ background: s.project.color }} />}
                    <span className="grow ellipsis">{s.title}</span>
                    {isCollapsed && sectionUnread > 0 ? <span className="badge">{sectionUnread}</span> : <span className="count">{list.length}</span>}
                  </button>
                  {s.project && (
                    <>
                      <button
                        className="section-open"
                        onClick={() => setDialog({ kind: 'projectTopic', projectId: s.project!.id })}
                        title={`[${s.project.name}] 새 주제 열기`}
                        aria-label={`${s.project.name} 새 주제`}
                      >
                        <Icon name="plus" size={12} /> 주제
                      </button>
                      <button
                        className={`section-open ${selection?.kind === 'project' && selection.id === s.project.id ? 'active' : ''}`}
                        onClick={() => {
                          setSelection({ kind: 'project', id: s.project!.id })
                          setThread(null)
                        }}
                        title="이 프로젝트의 스레드 모아보기"
                      >
                        모아보기
                      </button>
                    </>
                  )}
                </div>
                {!isCollapsed &&
                  list.map((c) => {
                    const dropHere = !!dropAt && 'id' in dropAt && dropAt.id === c.id
                    return (
                      <ChannelRow
                        key={c.id}
                        channel={c}
                        title={channelTitle(c, nameOf)}
                        active={selection?.kind === 'channel' && selection.id === c.id}
                        summary={unread.summaries[c.id]}
                        unread={muted.has(c.id) ? 0 : unreadCount(unread.summaries, c.id, viewing)}
                        mutedUnread={muted.has(c.id) ? unreadCount(unread.summaries, c.id, viewing) : 0}
                        favorite={!!layout?.favorites.includes(c.id)}
                        muted={muted.has(c.id)}
                        dropMark={dropHere ? (dropAt as { after: boolean }).after ? 'after' : 'before' : null}
                        onOpen={() => openChannel(c)}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(DRAG_TYPE, c.id)
                          e.dataTransfer.effectAllowed = 'move'
                          setDrag({ id: c.id, from: s.key })
                        }}
                        onDragOver={(e) => {
                          if (!drag || !e.dataTransfer.types.includes(DRAG_TYPE)) return
                          e.preventDefault()
                          const r = e.currentTarget.getBoundingClientRect()
                          setDropAt({ id: c.id, after: e.clientY > r.top + r.height / 2 })
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          if (dropAt && 'id' in dropAt) dropOnRow(s, c.id, dropAt.after)
                          setDrag(null)
                          setDropAt(null)
                        }}
                      />
                    )
                  })}
                {!isCollapsed && s.project && list.length === 0 && (
                  <div className="muted small pad">대화방을 여기로 끌어 놓거나 ⋯ 메뉴로 넣으세요.</div>
                )}
                {!isCollapsed && s.key === 'fav' && list.length === 0 && <div className="muted small pad">여기에 끌어 놓으면 맨 위에 고정됩니다.</div>}
              </div>
            )
          })}
        </div>
      </aside>

      <div className="body-col">
        {selection?.kind === 'channel' && selectedChannel && (
          <ChannelPane
            key={selectedChannel.id}
            channel={selectedChannel}
            title={channelTitle(selectedChannel, nameOf)}
            me={me}
            active={active}
            onOpenThread={openThread}
            openThread={thread}
            readMarkerAt={readMarker?.channelId === selectedChannel.id ? readMarker.at : null}
            focusMessageId={focusMsg?.channelId === selectedChannel.id ? focusMsg.messageId : null}
          />
        )}
        {selection?.kind === 'project' && (
          <ProjectPane
            key={selection.id}
            project={ui.projects.find((p) => p.id === selection.id) ?? null}
            channels={channels}
            onOpenThread={openThread}
            onOpenChannel={openChannel}
            onNewTopic={() => setDialog({ kind: 'projectTopic', projectId: selection.id })}
            nameOf={nameOf}
          />
        )}
        {!selection && (
          <div className="empty">
            <p>왼쪽에서 대화방을 고르거나 <kbd>⌘K</kbd> 로 찾아 가세요.</p>
            <p className="muted small">
              프로젝트(⌗ 버튼)를 만들어 대화방을 묶고, 대화는 “새 주제”로 스레드를 열어 주제별로 나누세요. 주제 제목 앞의 [프로젝트] 표시는 상대방 화면에서도
              같은 프로젝트로 묶입니다.
            </p>
            {recentThreads.length > 0 && (
              <div className="recent-threads">
                <div className="qs-group">최근 연 스레드</div>
                {recentThreads.map((r) => (
                  <button
                    key={r.key}
                    className="thread-row"
                    onClick={() => r.target.kind === 'thread' && applyNav(r.target, channels)}
                  >
                    <div className="thread-row-top">
                      <span className="grow ellipsis thread-title">{r.label}</span>
                    </div>
                    <div className="muted small">{r.sub}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {thread && <ThreadPanel thread={thread} meId={me?.id ?? null} onClose={() => setThread(null)} />}

      {dialog?.kind === 'projects' && <ProjectsDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'newChannel' && (
        <NewChannelDialog
          onClose={() => setDialog(null)}
          onCreated={async () => {
            setDialog(null)
            await loadChannels()
          }}
        />
      )}
      {dialog?.kind === 'direct' && (
        <DirectComposeDialog
          memberId={dialog.memberId}
          onClose={() => setDialog(null)}
          onSent={async () => {
            const memberId = dialog.memberId
            setDialog(null)
            const list = await loadChannels()
            const c = list ? findDirectChannel(list, memberId) : null
            if (c) openChannel(c)
          }}
        />
      )}
      {dialog?.kind === 'projectTopic' && (
        <ProjectTopicDialog
          project={ui.projects.find((p) => p.id === dialog.projectId) ?? null}
          channels={channels.filter((c) => ui.channelProject[c.id] === dialog.projectId && c.status !== 'deleted')}
          titleOf={(c) => channelTitle(c, nameOf)}
          onClose={() => setDialog(null)}
          onCreated={(c, threadChannelId, topic) => {
            setDialog(null)
            openChannel(c)
            openThread({ threadChannelId, parentChannelId: c.id, root: null, title: topic })
          }}
        />
      )}
    </div>
  )
}

// ---------------- 대화방 목록 한 줄 ----------------

function ChannelRow({
  channel,
  title,
  active,
  summary,
  unread,
  mutedUnread,
  favorite,
  muted,
  dropMark,
  onOpen,
  onDragStart,
  onDragOver,
  onDrop
}: {
  channel: Channel
  title: string
  active: boolean
  summary: ChannelSummary | undefined
  unread: number
  mutedUnread: number
  favorite: boolean
  muted: boolean
  dropMark: 'before' | 'after' | null
  onOpen: () => void
  onDragStart: (e: DragEvent<HTMLDivElement>) => void
  onDragOver: (e: DragEvent<HTMLDivElement>) => void
  onDrop: (e: DragEvent<HTMLDivElement>) => void
}) {
  const { ui, updateUi, updateShell } = useApp()
  const nameOf = useMemberNames()
  const [menu, setMenu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const hidden = ui.hiddenChannels.includes(channel.id)
  const partner = directPartner(channel)

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  const assign = (projectId: string | null) => {
    updateUi((u) => {
      const channelProject = { ...u.channelProject }
      if (projectId) channelProject[channel.id] = projectId
      else delete channelProject[channel.id]
      return { ...u, channelProject }
    })
    setMenu(false)
  }

  const preview = summary?.lastText
    ? (channel.type !== 'direct' && summary.lastSenderId ? `${nameOf(summary.lastSenderId) ?? '…'}: ` : '') + summary.lastText
    : ''
  const has = unread > 0

  return (
    <div
      className={`row-item ch-row ${active ? 'active' : ''} ${has ? 'unread' : ''} ${dropMark ? `drop-${dropMark}` : ''}`}
      ref={ref}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <button className="row-main" onClick={onOpen} aria-label={has ? `${title}, 안 읽은 메시지 ${unread}개` : title}>
        {partner ? (
          <Avatar memberId={partner} size={28} />
        ) : (
          <span className={`ch-icon ch-${channel.type}`} aria-hidden="true">
            #
          </span>
        )}
        <span className="ch-text">
          <span className="ch-line">
            <span className="grow ellipsis ch-title">{title}</span>
            {summary?.lastAt && <span className="ch-time">{formatTime(summary.lastAt)}</span>}
          </span>
          {preview && (
            <span className="ch-line">
              <span className="grow ellipsis ch-preview">{preview}</span>
              {muted && (
                <span className="ch-muted" title="알림 꺼짐">
                  <Icon name="bellOff" size={12} />
                </span>
              )}
              {has && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
              {!has && mutedUnread > 0 && <span className="badge quiet">{mutedUnread}</span>}
            </span>
          )}
        </span>
        {!preview && has && <span className="badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      <button className="row-more" aria-label="대화방 메뉴" onClick={() => setMenu((m) => !m)}>
        <Icon name="more" size={16} />
      </button>
      {menu && (
        <div className="popover" role="menu">
          <button
            role="menuitem"
            onClick={() => {
              updateShell((s) => ({
                ...s,
                layout: {
                  ...s.layout,
                  favorites: favorite ? s.layout.favorites.filter((x) => x !== channel.id) : [...s.layout.favorites, channel.id]
                }
              }))
              setMenu(false)
            }}
          >
            <Icon name="star" size={14} /> {favorite ? '즐겨찾기 해제' : '즐겨찾기에 고정'}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              updateShell((s) => {
                const set = new Set(s.prefs.notify.muted)
                if (set.has(channel.id)) set.delete(channel.id)
                else set.add(channel.id)
                return { ...s, prefs: { ...s.prefs, notify: { ...s.prefs.notify, muted: [...set] } } }
              })
              setMenu(false)
            }}
          >
            <Icon name={muted ? 'bell' : 'bellOff'} size={14} /> {muted ? '알림 켜기' : '이 방 알림 끄기'}
          </button>
          <hr />
          <div className="popover-title">프로젝트에 넣기</div>
          {ui.projects.length === 0 && <div className="muted small pad">먼저 프로젝트를 만드세요 (⌗ 버튼)</div>}
          {ui.projects.map((p) => (
            <button key={p.id} role="menuitemradio" aria-checked={ui.channelProject[channel.id] === p.id} onClick={() => assign(p.id)}>
              <span className="dot" style={{ background: p.color }} />
              {p.name}
              {ui.channelProject[channel.id] === p.id && ' ✓'}
            </button>
          ))}
          {ui.channelProject[channel.id] && <button onClick={() => assign(null)}>프로젝트에서 빼기</button>}
          <hr />
          <button
            onClick={() => {
              updateUi((u) => ({
                ...u,
                hiddenChannels: hidden ? u.hiddenChannels.filter((id) => id !== channel.id) : [...u.hiddenChannels, channel.id]
              }))
              setMenu(false)
            }}
          >
            {hidden ? '숨김 해제' : '목록에서 숨기기'}
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------- 대화방 본문 ----------------

type ComposeMode = { kind: 'normal' } | { kind: 'reply'; m: Message } | { kind: 'threadFrom'; m: Message }

function ChannelPane({
  channel,
  title,
  me,
  active,
  onOpenThread,
  openThread,
  readMarkerAt,
  focusMessageId
}: {
  channel: Channel
  title: string
  me: Member | null
  active: boolean
  onOpenThread: (t: OpenThread) => void
  openThread: OpenThread | null
  readMarkerAt: string | null
  focusMessageId: string | null
}) {
  const { ui, toast, shell, updateShell } = useApp()
  const openThreadId = openThread?.threadChannelId ?? null
  const nameOf = useMemberNames()
  const [tab, setTab] = useState<'chat' | 'threads'>('chat')
  const [mode, setMode] = useState<ComposeMode>({ kind: 'normal' })
  const [newTopic, setNewTopic] = useState(false)
  const [gallery, setGallery] = useState(false)
  const { messages, error, reload, loadMore, canLoadMore, ensure } = useChannelLogs(channel.id, active, 100)
  const threads = useMemo(() => collectThreads(messages), [messages])
  const muted = !!shell?.prefs.notify.muted.includes(channel.id)

  // 검색·알림에서 온 메시지가 보관함 깊은 곳에 있어도 보이게 불러온다
  useEffect(() => {
    ensure(focusMessageId)
    if (focusMessageId) setTab('chat')
  }, [focusMessageId, ensure])

  // 이동 버스로 연 스레드는 첫 메시지(root)를 모르므로, 대화방 메시지에서 찾아 채운다
  useEffect(() => {
    if (!openThread || openThread.root || openThread.parentChannelId !== channel.id) return
    const root = messages.find((m) => m.thread?.channelId === openThread.threadChannelId)
    if (root) onOpenThread({ ...openThread, root })
  }, [messages, openThread, channel.id, onOpenThread])

  // "여기까지 읽음" 은 내가 보낸 것만 있거나 새 메시지가 없으면 그리지 않는다
  const marker = useMemo(() => {
    if (!readMarkerAt) return null
    const t = Date.parse(readMarkerAt)
    return messages.some((m) => m.senderId !== me?.id && m.sentAt && Date.parse(m.sentAt) > t) ? readMarkerAt : null
  }, [readMarkerAt, messages, me?.id])
  const project = ui.projects.find((p) => p.id === ui.channelProject[channel.id]) ?? null

  const open = (m: Message) => {
    if (m.thread) onOpenThread({ threadChannelId: m.thread.channelId, parentChannelId: channel.id, root: m })
  }

  async function send(text: string) {
    try {
      if (mode.kind === 'reply') {
        const r = await call('messenger:reply', channel.id, mode.m.id, text)
        if (r.id) rememberReply(channel.id, r.id, mode.m)
      } else if (mode.kind === 'threadFrom') {
        const r = await call('messenger:threadFromMessage', channel.id, mode.m.id, text)
        onOpenThread({ threadChannelId: r.channelId, parentChannelId: channel.id, root: mode.m })
      } else {
        await call('messenger:send', channel.id, text)
      }
      setMode({ kind: 'normal' })
      await reload()
    } catch (e) {
      toast(errorText(e))
      throw e
    }
  }

  const banner =
    mode.kind === 'reply' ? (
      <>
        <b>{nameOf(mode.m.senderId) ?? '…'}</b>에게 답장: <span className="muted">{mode.m.text.slice(0, 80)}</span>
      </>
    ) : mode.kind === 'threadFrom' ? (
      <>
        스레드 시작: <span className="muted">{mode.m.text.slice(0, 80)}</span>
      </>
    ) : null

  return (
    <>
      <div className="pane-head">
        <div className="grow ellipsis">
          {project && (
            <span className="tag" style={{ borderColor: project.color, color: project.color }}>
              {project.name}
            </span>
          )}
          <b>{title}</b>
          <span className="muted small"> · {channel.participantIds.length}명</span>
        </div>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>
            대화
          </button>
          <button
            role="tab"
            aria-selected={tab === 'threads'}
            className={tab === 'threads' ? 'active' : ''}
            onClick={() => setTab('threads')}
          >
            스레드 {threads.length > 0 && <span className="count">{threads.length}</span>}
          </button>
        </div>
        <button className="primary small" onClick={() => setNewTopic(true)} title="프로젝트·제목을 붙여 스레드로 새 주제를 연다">
          <Icon name="plus" size={14} /> 새 주제
        </button>
        <button
          className="icon-btn"
          onClick={() => openSearch({ scope: { channelId: channel.id, title } })}
          title="이 대화방에서 찾기 (⌘F)"
          aria-label="이 대화방에서 찾기"
        >
          <Icon name="search" size={16} />
        </button>
        <button
          className="icon-btn"
          onClick={() =>
            updateShell((s) => {
              const set = new Set(s.prefs.notify.muted)
              if (set.has(channel.id)) set.delete(channel.id)
              else set.add(channel.id)
              return { ...s, prefs: { ...s.prefs, notify: { ...s.prefs.notify, muted: [...set] } } }
            })
          }
          title={muted ? '이 방 알림 켜기' : '이 방 알림 끄기'}
          aria-label={muted ? '이 방 알림 켜기' : '이 방 알림 끄기'}
          aria-pressed={muted}
        >
          <Icon name={muted ? 'bellOff' : 'bell'} size={16} />
        </button>
        <button className="icon-btn" onClick={() => setGallery(true)} title="파일 모아보기" aria-label="파일 모아보기">
          <Icon name="clip" size={16} />
        </button>
        <button className="icon-btn" onClick={() => void reload()} title="새로고침" aria-label="새로고침">
          <Icon name="refresh" size={16} />
        </button>
      </div>
      {error && <div className="banner banner-err">{error}</div>}
      {gallery && <FileGallery channelId={channel.id} messages={messages} onClose={() => setGallery(false)} />}
      {tab === 'chat' ? (
        <FileDropArea channelId={channel.id} onUploaded={() => void reload()}>
          <MessageList
            messages={messages}
            meId={me?.id ?? null}
            onReply={(m) => setMode({ kind: 'reply', m })}
            onOpenThread={open}
            onStartThread={(m) => onOpenThread({ threadChannelId: '', parentChannelId: channel.id, root: m, startFrom: true })}
            onChanged={() => void reload()}
            canLoadMore={canLoadMore}
            onLoadMore={loadMore}
            highlightId={focusMessageId}
            readMarkerAt={marker}
          />
          <Composer
            placeholder={`${title}에 메시지 보내기`}
            channelId={channel.id}
            autoFocusKey={channel.id + mode.kind}
            banner={banner}
            onCancelBanner={mode.kind === 'normal' ? undefined : () => setMode({ kind: 'normal' })}
            onSend={send}
            onAttach={async () => {
              try {
                if (await call('messenger:uploadFile', channel.id)) await reload()
              } catch (e) {
                toast(errorText(e))
              }
            }}
          />
        </FileDropArea>
      ) : (
        <ThreadList
          threads={threads}
          projects={ui.projects}
          defaultProject={project}
          activeId={openThreadId}
          onOpen={(t) => open(t.root)}
          nameOf={nameOf}
          note="이 대화방의 최근 메시지에 달린 스레드입니다."
        />
      )}
      {newTopic && (
        <NewTopicDialog
          defaultProject={project?.name ?? null}
          onClose={() => setNewTopic(false)}
          onSubmit={async (topic, body) => {
            const r = await call('messenger:createThread', channel.id, topic, body || null)
            setNewTopic(false)
            await reload()
            onOpenThread({ threadChannelId: r.channelId, parentChannelId: channel.id, root: null, title: topic })
          }}
        />
      )}
    </>
  )
}

// ---------------- 스레드 목록 ----------------

function ThreadList({
  threads,
  projects,
  defaultProject,
  activeId,
  onOpen,
  nameOf,
  note,
  showChannel
}: {
  threads: ThreadEntry[]
  projects: ProjectGroup[]
  defaultProject: ProjectGroup | null
  activeId: string | null
  onOpen: (t: ThreadEntry) => void
  nameOf: (id: string | null) => string | null
  note?: string
  showChannel?: (channelId: string) => string
}) {
  const tags = useMemo(() => {
    const set = new Map<string, string>()
    for (const t of threads) if (t.topic.project) set.set(t.topic.project.toLowerCase(), t.topic.project)
    return [...set.values()]
  }, [threads])
  const [tag, setTag] = useState<string | null>(null)
  const shown = tag === null ? threads : tag === '' ? threads.filter((t) => !t.topic.project) : threads.filter((t) => sameProject(t.topic.project, tag))
  const colorOf = (name: string | null) => projects.find((p) => sameProject(p.name, name))?.color

  return (
    <div className="thread-list">
      {(tags.length > 0 || note) && (
        <div className="chips">
          <button className={tag === null ? 'chip active' : 'chip'} onClick={() => setTag(null)}>
            전체 {threads.length}
          </button>
          {tags.map((t) => (
            <button key={t} className={sameProject(tag, t) ? 'chip active' : 'chip'} onClick={() => setTag(t)}>
              <span className="dot" style={{ background: colorOf(t) ?? 'var(--muted)' }} />
              {t}
            </button>
          ))}
          {tags.length > 0 && (
            <button className={tag === '' ? 'chip active' : 'chip'} onClick={() => setTag('')}>
              주제 없음
            </button>
          )}
        </div>
      )}
      {note && <div className="muted small pad">{note}</div>}
      {shown.length === 0 && (
        <div className="empty small">
          <p>스레드가 없습니다.</p>
          <p className="muted">“새 주제”로 {defaultProject ? `[${defaultProject.name}] ` : ''}주제 스레드를 열어 보세요.</p>
        </div>
      )}
      {shown.map((t) => (
        <button key={t.thread.channelId} className={`thread-row ${activeId === t.thread.channelId ? 'active' : ''}`} onClick={() => onOpen(t)}>
          <div className="thread-row-top">
            {t.topic.project && (
              <span className="tag" style={{ borderColor: colorOf(t.topic.project), color: colorOf(t.topic.project) }}>
                {t.topic.project}
              </span>
            )}
            <span className="grow ellipsis thread-title">{t.topic.title || '(내용 없음)'}</span>
          </div>
          <div className="muted small">
            {showChannel && <span>{showChannel(t.parentChannelId)} · </span>}
            {nameOf(t.root.senderId) ?? '…'} · 답글 {t.thread.totalCount}개 · {formatTime(threadTime(t))}
          </div>
        </button>
      ))}
    </div>
  )
}

// ---------------- 프로젝트 모아보기 ----------------

function ProjectPane({
  project,
  channels,
  onOpenThread,
  onOpenChannel,
  onNewTopic,
  nameOf
}: {
  project: ProjectGroup | null
  channels: Channel[]
  onOpenThread: (t: OpenThread) => void
  onOpenChannel: (c: Channel) => void
  onNewTopic: () => void
  nameOf: (id: string | null) => string | null
}) {
  const { ui, toast } = useApp()
  const [threads, setThreads] = useState<ThreadEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [scope, setScope] = useState<'project' | 'all'>('project')
  const inProject = useMemo(
    () => (project ? channels.filter((c) => ui.channelProject[c.id] === project.id) : []),
    [channels, ui.channelProject, project]
  )

  const scan = useCallback(
    async (which: 'project' | 'all') => {
      if (!project) return
      setLoading(true)
      setScope(which)
      const targets = which === 'project' ? inProject : channels.filter((c) => !ui.hiddenChannels.includes(c.id))
      const found: ThreadEntry[] = []
      try {
        // 요청 제한을 고려해 하나씩 읽는다
        for (const c of targets) {
          const msgs = await call('messenger:logs', c.id, 200)
          for (const t of collectThreads(msgs)) {
            const projectMatch = sameProject(t.topic.project, project.name)
            if (projectMatch || (which === 'project' && !t.topic.project)) found.push(t)
          }
        }
        setThreads(found.sort((a, b) => threadTime(b) - threadTime(a)))
      } catch (e) {
        toast(errorText(e))
      } finally {
        setLoading(false)
      }
    },
    [project, inProject, channels, ui.hiddenChannels, toast]
  )

  useEffect(() => {
    void scan('project')
  }, [project?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!project) return <div className="empty">프로젝트를 찾을 수 없습니다.</div>
  const titleOf = (id: string) => {
    const c = channels.find((x) => x.id === id)
    return c ? channelTitle(c, nameOf) : '대화방'
  }

  return (
    <>
      <div className="pane-head">
        <div className="grow ellipsis">
          <span className="dot big" style={{ background: project.color }} />
          <b>{project.name}</b>
          <span className="muted small"> · 대화방 {inProject.length}개</span>
        </div>
        <button className="primary small" onClick={onNewTopic} disabled={inProject.length === 0} title="이 프로젝트 대화방에 새 주제 스레드를 연다">
          <Icon name="plus" size={14} /> 새 주제
        </button>
        <button className="small" disabled={loading} onClick={() => void scan('all')} title="모든 대화방에서 이 프로젝트 태그가 붙은 스레드를 찾는다">
          모든 대화방에서 찾기
        </button>
        <button className="icon-btn" onClick={() => void scan(scope)} title="새로고침" aria-label="새로고침" disabled={loading}>
          <Icon name="refresh" size={16} />
        </button>
      </div>
      <div className="project-channels">
        {inProject.map((c) => (
          <button key={c.id} className="chip" onClick={() => onOpenChannel(c)}>
            # {channelTitle(c, nameOf)}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="empty small">스레드를 모으는 중…</div>
      ) : (
        <ThreadList
          threads={threads}
          projects={ui.projects}
          defaultProject={project}
          activeId={null}
          nameOf={nameOf}
          showChannel={titleOf}
          note={
            scope === 'project'
              ? `이 프로젝트 대화방들의 스레드입니다 (다른 프로젝트 태그가 붙은 것은 뺌). 다른 대화방의 [${project.name}] 스레드는 '모든 대화방에서 찾기'로 모읍니다. (각 대화방 최근 200개 메시지 기준)`
              : `모든 대화방에서 [${project.name}] 로 시작한 스레드입니다. (각 대화방 최근 200개 메시지 기준)`
          }
          onOpen={(t) => onOpenThread({ threadChannelId: t.thread.channelId, parentChannelId: t.parentChannelId, root: t.root })}
        />
      )}
    </>
  )
}

// ---------------- 대화 상자 ----------------

function NewTopicDialog({
  defaultProject,
  onClose,
  onSubmit,
  extra
}: {
  defaultProject: string | null
  onClose: () => void
  onSubmit: (topic: string, body: string) => Promise<void>
  extra?: ReactNode
}) {
  const { ui, toast } = useApp()
  const [project, setProject] = useState(defaultProject ?? '')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const preview = formatTopic(project.trim() || null, title || '제목')

  return (
    <Modal title="새 주제 (스레드)" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!title.trim()) return
          setBusy(true)
          try {
            await onSubmit(formatTopic(project.trim() || null, title), body.trim())
          } catch (err) {
            toast(errorText(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        {extra}
        <label>
          <span>프로젝트</span>
          <input list="project-names" value={project} onChange={(e) => setProject(e.target.value)} placeholder="없으면 비워 두세요" />
          <datalist id="project-names">
            {ui.projects.map((p) => (
              <option key={p.id} value={p.name} />
            ))}
          </datalist>
        </label>
        <label>
          <span>제목</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus required placeholder="예: 3월 릴리스 일정" />
        </label>
        <label>
          <span>스레드 첫 메시지 (선택)</span>
          <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <p className="muted small">
          대화방에는 <b>{preview}</b> 가 올라가고, 대화는 그 아래 스레드에서 이어집니다.
        </p>
        <div className="row end">
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button className="primary" disabled={busy || !title.trim()}>
            {busy ? '보내는 중…' : '주제 열기'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

function ProjectsDialog({ onClose }: { onClose: () => void }) {
  const { ui, updateUi } = useApp()
  const [name, setName] = useState('')
  return (
    <Modal title="프로젝트" onClose={onClose}>
      <p className="muted small">
        대화방을 프로젝트로 묶는 설정은 이 컴퓨터에만 저장됩니다. 스레드 제목의 [프로젝트] 표시는 메시지에 들어가므로 상대방도 같이 봅니다. 두 분이 같은
        이름을 쓰면 됩니다.
      </p>
      <ul className="project-edit">
        {ui.projects.map((p) => (
          <li key={p.id}>
            <input
              type="color"
              value={p.color}
              aria-label={`${p.name} 색`}
              onChange={(e) =>
                updateUi((u) => ({ ...u, projects: u.projects.map((x) => (x.id === p.id ? { ...x, color: e.target.value } : x)) }))
              }
            />
            <input
              value={p.name}
              aria-label="프로젝트 이름"
              onChange={(e) =>
                updateUi((u) => ({ ...u, projects: u.projects.map((x) => (x.id === p.id ? { ...x, name: e.target.value } : x)) }))
              }
            />
            <button
              className="icon-btn"
              aria-label={`${p.name} 삭제`}
              onClick={() => {
                if (!window.confirm(`'${p.name}' 프로젝트를 지울까요? 대화방은 '미분류'로 돌아갑니다.`)) return
                updateUi((u) => ({
                  ...u,
                  projects: u.projects.filter((x) => x.id !== p.id),
                  channelProject: Object.fromEntries(Object.entries(u.channelProject).filter(([, v]) => v !== p.id))
                }))
              }}
            >
              <Icon name="trash" size={15} />
            </button>
          </li>
        ))}
      </ul>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          const n = name.trim()
          if (!n) return
          updateUi((u) => ({ ...u, projects: [...u.projects, { id: crypto.randomUUID(), name: n, color: nextColor(u.projects) }] }))
          setName('')
        }}
      >
        <input className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="새 프로젝트 이름" autoFocus />
        <button className="primary">추가</button>
      </form>
    </Modal>
  )
}

function NewChannelDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const { toast } = useApp()
  const [title, setTitle] = useState('')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Member[]>([])
  const [picked, setPicked] = useState<Member[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (!q) return setResults([])
    const id = window.setTimeout(() => {
      call('messenger:searchMembers', q)
        .then(setResults)
        .catch((e) => toast(errorText(e)))
    }, 300)
    return () => window.clearTimeout(id)
  }, [query, toast])

  return (
    <Modal title="새 대화방" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!title.trim() || picked.length === 0) return
          setBusy(true)
          try {
            await call(
              'messenger:createChannel',
              title.trim(),
              picked.map((m) => m.id)
            )
            await onCreated()
          } catch (err) {
            toast(errorText(err))
          } finally {
            setBusy(false)
          }
        }}
      >
        <label>
          <span>대화방 이름</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
        </label>
        <label>
          <span>멤버 찾기</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="이름" />
        </label>
        {results.length > 0 && (
          <ul className="pick-list">
            {results.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={picked.some((p) => p.id === m.id)}
                  onClick={() => setPicked((p) => [...p, m])}
                >
                  {m.name} <span className="muted">{m.email}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="chips">
          {picked.map((m) => (
            <button type="button" key={m.id} className="chip active" onClick={() => setPicked((p) => p.filter((x) => x.id !== m.id))}>
              {m.name} ✕
            </button>
          ))}
        </div>
        <div className="row end">
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button className="primary" disabled={busy || !title.trim() || picked.length === 0}>
            만들기
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** 사람 → 1:1 대화. 아직 1:1 방이 없으면 첫 메시지를 보내 방을 만든다 (두레이 direct-send) */
function DirectComposeDialog({ memberId, onClose, onSent }: { memberId: string; onClose: () => void; onSent: () => Promise<void> }) {
  const { toast } = useApp()
  const nameOf = useMemberNames()
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const name = nameOf(memberId) ?? '…'

  async function send() {
    if (!text.trim()) return
    setBusy(true)
    try {
      await call('messenger:directSend', memberId, text.trim())
      await onSent()
    } catch (e) {
      toast(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={`${name}님과 1:1 대화`} onClose={onClose}>
      <div className="direct-head">
        <Avatar memberId={memberId} size={40} />
        <div>
          <b>{name}</b>
          <div className="muted small">아직 1:1 대화방이 없습니다. 첫 메시지를 보내면 대화방이 생깁니다.</div>
        </div>
      </div>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault()
          void send()
        }}
      >
        <textarea
          rows={4}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`${name}님에게 보낼 메시지`}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <div className="row end">
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button className="primary" disabled={busy || !text.trim()}>
            {busy ? '보내는 중…' : '보내기'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** 프로젝트 폴더에서 바로 "새 주제": 어느 대화방에 열지 고르고 [프로젝트] 제목으로 스레드를 만든다 */
function ProjectTopicDialog({
  project,
  channels,
  titleOf,
  onClose,
  onCreated
}: {
  project: ProjectGroup | null
  channels: Channel[]
  titleOf: (c: Channel) => string
  onClose: () => void
  onCreated: (c: Channel, threadChannelId: string, topic: string) => void
}) {
  const sorted = useMemo(() => [...channels].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')), [channels])
  const [channelId, setChannelId] = useState(sorted[0]?.id ?? '')
  if (!project) return null
  if (sorted.length === 0) {
    return (
      <Modal title={`[${project.name}] 새 주제`} onClose={onClose}>
        <p className="muted">이 프로젝트에 넣은 대화방이 없습니다. 대화방을 프로젝트 폴더로 끌어 놓거나 ⋯ 메뉴로 넣으세요.</p>
      </Modal>
    )
  }
  return (
    <NewTopicDialog
      defaultProject={project.name}
      onClose={onClose}
      extra={
        <label>
          <span>대화방</span>
          <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            {sorted.map((c) => (
              <option key={c.id} value={c.id}>
                {titleOf(c)}
              </option>
            ))}
          </select>
        </label>
      }
      onSubmit={async (topic, body) => {
        const c = sorted.find((x) => x.id === channelId) ?? sorted[0]
        const r = await call('messenger:createThread', c.id, topic, body || null)
        onCreated(c, r.channelId, topic)
      }}
    />
  )
}
