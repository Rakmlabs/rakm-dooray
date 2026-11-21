import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Channel, Member, Message, ProjectGroup } from '@shared/types'
import { call, errorText, onEvent } from '../api'
import { rememberMember, useApp, useMemberNames } from '../state'
import { useChannelLogs, useInterval } from '../lib/hooks'
import {
  channelTitle,
  collectThreads,
  formatTopic,
  groupChannels,
  isUnread,
  nextColor,
  sameProject,
  threadTime,
  type ThreadEntry
} from '../lib/projects'
import { formatTime } from '../lib/format'
import { MessageList } from '../components/MessageList'
import { Composer } from '../components/Composer'
import { ThreadPanel, type OpenThread } from '../components/ThreadPanel'
import { Modal } from '../components/Modal'
import { Icon } from '../components/Icon'

type Selection = { kind: 'channel'; id: string } | { kind: 'project'; id: string } | null

export function MessengerView({ active }: { active: boolean }) {
  const { ui, updateUi, settings } = useApp()
  const nameOf = useMemberNames()
  const [channels, setChannels] = useState<Channel[]>([])
  const [me, setMe] = useState<Member | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const [thread, setThread] = useState<OpenThread | null>(null)
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['hidden']))
  const [activity, setActivity] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<'projects' | 'newChannel' | null>(null)
  const configured = !!settings && settings.dooray.tokenSource !== 'none'

  const loadChannels = useCallback(async () => {
    try {
      setChannels(await call('messenger:channels'))
      setError(null)
    } catch (e) {
      setError(errorText(e))
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

  // 채널 목록은 30초마다 (안 읽음 표시용, 근사치)
  useInterval(() => void loadChannels(), 30_000, configured)

  useEffect(
    () =>
      onEvent('messenger:activity', (a) => {
        setActivity((s) => (s.has(a.channelId) ? s : new Set(s).add(a.channelId)))
      }),
    []
  )

  const selectedChannel = selection?.kind === 'channel' ? (channels.find((c) => c.id === selection.id) ?? null) : null

  const openChannel = useCallback(
    (c: Channel) => {
      setSelection({ kind: 'channel', id: c.id })
      setThread(null)
      setActivity((s) => {
        if (!s.has(c.id)) return s
        const n = new Set(s)
        n.delete(c.id)
        return n
      })
      updateUi((u) => ({ ...u, lastSeenAt: { ...u.lastSeenAt, [c.id]: c.updatedAt ?? new Date().toISOString() } }))
    },
    [updateUi]
  )

  // 보고 있는 대화방은 계속 읽음 처리
  useEffect(() => {
    if (!selectedChannel?.updatedAt) return
    if (ui.lastSeenAt[selectedChannel.id] === selectedChannel.updatedAt) return
    updateUi((u) => ({ ...u, lastSeenAt: { ...u.lastSeenAt, [selectedChannel.id]: selectedChannel.updatedAt! } }))
  }, [selectedChannel?.id, selectedChannel?.updatedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && thread && active) setThread(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [thread, active])

  const sections = useMemo(() => groupChannels(channels, ui), [channels, ui])
  const q = filter.trim().toLowerCase()

  if (!configured) {
    return (
      <div className="empty">
        <p>설정 화면에서 두레이 개인 API 토큰을 먼저 입력하세요.</p>
      </div>
    )
  }

  return (
    <div className="cols">
      <aside className="list-col" aria-label="대화방 목록">
        <div className="pane-head">
          <input
            className="search"
            placeholder="대화방 찾기"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="대화방 찾기"
          />
          <button className="icon-btn" title="프로젝트 관리" aria-label="프로젝트 관리" onClick={() => setDialog('projects')}>
            <Icon name="tag" size={16} />
          </button>
          <button className="icon-btn" title="새 대화방" aria-label="새 대화방" onClick={() => setDialog('newChannel')}>
            <Icon name="plus" size={16} />
          </button>
        </div>
        {error && <div className="banner banner-err">{error}</div>}
        <div className="list-scroll">
          {sections.map((s) => {
            const list = q ? s.channels.filter((c) => channelTitle(c, nameOf).toLowerCase().includes(q)) : s.channels
            if (!s.project && list.length === 0) return null
            const isCollapsed = collapsed.has(s.key) && !q
            return (
              <div key={s.key} className="section">
                <div className="section-head">
                  <button
                    className="section-toggle"
                    aria-expanded={!isCollapsed}
                    onClick={() =>
                      setCollapsed((c) => {
                        const n = new Set(c)
                        if (n.has(s.key)) n.delete(s.key)
                        else n.add(s.key)
                        return n
                      })
                    }
                  >
                    <span className={`chev ${isCollapsed ? '' : 'open'}`}>
                      <Icon name="chevron" size={12} />
                    </span>
                    {s.project && <span className="dot" style={{ background: s.project.color }} />}
                    <span className="grow ellipsis">{s.title}</span>
                    <span className="count">{list.length}</span>
                  </button>
                  {s.project && (
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
                  )}
                </div>
                {!isCollapsed &&
                  list.map((c) => (
                    <ChannelRow
                      key={c.id}
                      channel={c}
                      title={channelTitle(c, nameOf)}
                      active={selection?.kind === 'channel' && selection.id === c.id}
                      unread={selection?.kind !== 'channel' || selection.id !== c.id ? isUnread(c, ui, activity) : false}
                      onOpen={() => openChannel(c)}
                    />
                  ))}
                {!isCollapsed && s.project && list.length === 0 && (
                  <div className="muted small pad">대화방 옆 ⋯ 버튼으로 이 프로젝트에 넣으세요.</div>
                )}
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
            onOpenThread={setThread}
            openThreadId={thread?.threadChannelId ?? null}
          />
        )}
        {selection?.kind === 'project' && (
          <ProjectPane
            key={selection.id}
            project={ui.projects.find((p) => p.id === selection.id) ?? null}
            channels={channels}
            onOpenThread={setThread}
            onOpenChannel={openChannel}
            nameOf={nameOf}
          />
        )}
        {!selection && (
          <div className="empty">
            <p>왼쪽에서 대화방을 고르세요.</p>
            <p className="muted small">
              프로젝트(⌗ 버튼)를 만들어 대화방을 묶고, 대화는 “새 주제”로 스레드를 열어 주제별로 나누세요. 주제 제목 앞의 [프로젝트] 표시는 상대방 화면에서도
              같은 프로젝트로 묶입니다.
            </p>
          </div>
        )}
      </div>

      {thread && <ThreadPanel thread={thread} meId={me?.id ?? null} onClose={() => setThread(null)} />}

      {dialog === 'projects' && <ProjectsDialog onClose={() => setDialog(null)} />}
      {dialog === 'newChannel' && (
        <NewChannelDialog
          onClose={() => setDialog(null)}
          onCreated={async () => {
            setDialog(null)
            await loadChannels()
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
  unread,
  onOpen
}: {
  channel: Channel
  title: string
  active: boolean
  unread: boolean
  onOpen: () => void
}) {
  const { ui, updateUi } = useApp()
  const [menu, setMenu] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const hidden = ui.hiddenChannels.includes(channel.id)

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

  return (
    <div className={`row-item ${active ? 'active' : ''} ${unread ? 'unread' : ''}`} ref={ref}>
      <button className="row-main" onClick={onOpen}>
        <span className={`ch-icon ch-${channel.type}`} aria-hidden="true">
          {channel.type === 'direct' ? '@' : '#'}
        </span>
        <span className="grow ellipsis">{title}</span>
        {unread && <span className="unread-dot" aria-label="새 메시지" />}
      </button>
      <button className="row-more" aria-label="대화방 메뉴" onClick={() => setMenu((m) => !m)}>
        <Icon name="more" size={16} />
      </button>
      {menu && (
        <div className="popover" role="menu">
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
  openThreadId
}: {
  channel: Channel
  title: string
  me: Member | null
  active: boolean
  onOpenThread: (t: OpenThread) => void
  openThreadId: string | null
}) {
  const { ui, toast } = useApp()
  const nameOf = useMemberNames()
  const [tab, setTab] = useState<'chat' | 'threads'>('chat')
  const [mode, setMode] = useState<ComposeMode>({ kind: 'normal' })
  const [newTopic, setNewTopic] = useState(false)
  const { messages, error, reload, loadMore, canLoadMore } = useChannelLogs(channel.id, active, 100)
  const threads = useMemo(() => collectThreads(messages), [messages])
  const project = ui.projects.find((p) => p.id === ui.channelProject[channel.id]) ?? null

  const open = (m: Message) => {
    if (m.thread) onOpenThread({ threadChannelId: m.thread.channelId, parentChannelId: channel.id, root: m })
  }

  async function send(text: string) {
    try {
      if (mode.kind === 'reply') {
        await call('messenger:reply', channel.id, mode.m.id, text)
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
        <button className="icon-btn" onClick={() => void reload()} title="새로고침" aria-label="새로고침">
          <Icon name="refresh" size={16} />
        </button>
      </div>
      {error && <div className="banner banner-err">{error}</div>}
      {tab === 'chat' ? (
        <>
          <MessageList
            messages={messages}
            meId={me?.id ?? null}
            onReply={(m) => setMode({ kind: 'reply', m })}
            onOpenThread={open}
            onStartThread={(m) => setMode({ kind: 'threadFrom', m })}
            onChanged={() => void reload()}
            canLoadMore={canLoadMore}
            onLoadMore={loadMore}
          />
          <Composer
            placeholder={`${title}에 메시지 보내기`}
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
        </>
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
  nameOf
}: {
  project: ProjectGroup | null
  channels: Channel[]
  onOpenThread: (t: OpenThread) => void
  onOpenChannel: (c: Channel) => void
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
  onSubmit
}: {
  defaultProject: string | null
  onClose: () => void
  onSubmit: (topic: string, body: string) => Promise<void>
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
