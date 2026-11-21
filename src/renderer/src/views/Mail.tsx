import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ComposeInput, MailAddress, MailDetail, MailFolder, MailSummary } from '@shared/types'
import { call, errorText } from '../api'
import { useApp } from '../state'
import { useInterval } from '../lib/hooks'
import { sanitizeMailHtml } from '../lib/markdown'
import { formatSize, formatTime } from '../lib/format'
import { Icon } from '../components/Icon'
import { Modal } from '../components/Modal'

const PAGE = 50

function who(list: MailAddress[]): string {
  return list.map((a) => a.name || a.address).join(', ')
}
function full(list: MailAddress[]): string {
  return list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ')
}

export function MailView({ active }: { active: boolean }) {
  const { settings, toast } = useApp()
  const configured = !!settings && settings.mail.passwordSource !== 'none' && !!settings.mail.address
  const [folders, setFolders] = useState<MailFolder[]>([])
  const [folder, setFolder] = useState('INBOX')
  const [items, setItems] = useState<MailSummary[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [compose, setCompose] = useState<Partial<ComposeInput> | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!configured) return
    call('mail:folders')
      .then((f) => {
        setFolders(f)
        setError(null)
      })
      .catch((e) => setError(errorText(e)))
  }, [configured, settings?.mail.address])

  const load = useCallback(
    async (p: number, quiet = false) => {
      if (!configured) return
      if (!quiet) setLoading(true)
      try {
        const r = await call('mail:list', folder, p, PAGE)
        setTotal(r.total)
        setItems((prev) => {
          if (p === 0) {
            // 새로고침: 첫 페이지를 바꾸고, 이미 불러온 뒤쪽 페이지는 유지
            const firstUids = new Set(r.items.map((i) => i.uid))
            const rest = quiet ? prev.filter((i) => !firstUids.has(i.uid) && i.uid < (r.items.at(-1)?.uid ?? 0)) : []
            return [...r.items, ...rest]
          }
          const seen = new Set(prev.map((i) => i.uid))
          return [...prev, ...r.items.filter((i) => !seen.has(i.uid))]
        })
        setPage((cur) => (p === 0 && quiet ? cur : p))
        setError(null)
      } catch (e) {
        setError(errorText(e))
      } finally {
        if (!quiet) setLoading(false)
      }
    },
    [folder, configured]
  )

  useEffect(() => {
    setItems([])
    setSelected(null)
    setPage(0)
    void load(0)
  }, [folder, load])

  useInterval(() => void load(0, true), 60_000, active && configured)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => i.subject.toLowerCase().includes(q) || who(i.from).toLowerCase().includes(q))
  }, [items, query])

  if (!configured) {
    return (
      <div className="empty">
        <p>설정 화면에서 메일 주소와 IMAP 비밀번호를 입력하세요.</p>
        <p className="muted small">두레이 메일 IMAP 은 메일 포함 Business 플랜 이상에서 제공되고, 관리자가 허용해야 합니다.</p>
      </div>
    )
  }

  return (
    <div className="cols">
      <aside className="list-col" aria-label="메일 목록">
        <div className="pane-head column">
          <div className="row">
            <select className="grow" value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="메일함">
              {folders.length === 0 && <option value="INBOX">받은편지함</option>}
              {folders.map((f) => (
                <option key={f.path} value={f.path}>
                  {'  '.repeat(f.depth)}
                  {f.name}
                </option>
              ))}
            </select>
            <button className="icon-btn" onClick={() => void load(0)} title="새로고침" aria-label="새로고침">
              <Icon name="refresh" size={16} />
            </button>
            <button className="primary small" onClick={() => setCompose({})}>
              <Icon name="edit" size={14} /> 쓰기
            </button>
          </div>
          <input className="search" placeholder="불러온 메일에서 찾기" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {error && <div className="banner banner-err">{error}</div>}
        <div className="list-scroll">
          {shown.map((m) => (
            <button
              key={m.uid}
              className={`mail-row ${selected === m.uid ? 'active' : ''} ${m.seen ? '' : 'unread'}`}
              onClick={() => setSelected(m.uid)}
            >
              <div className="mail-row-top">
                <span className="grow ellipsis mail-from">{who(m.from) || '(보낸 사람 없음)'}</span>
                <span className="muted small">{formatTime(m.date)}</span>
              </div>
              <div className="ellipsis mail-subject">
                {m.hasAttachments && <Icon name="clip" size={12} />} {m.subject}
              </div>
            </button>
          ))}
          {loading && <div className="muted center small pad">불러오는 중…</div>}
          {!loading && items.length < total && (
            <button className="load-more" onClick={() => void load(page + 1)}>
              더 보기 ({items.length}/{total})
            </button>
          )}
          {!loading && total === 0 && !error && <div className="empty small">메일이 없습니다.</div>}
        </div>
      </aside>
      <div className="body-col">
        {selected !== null ? (
          <MailReader
            key={`${folder}:${selected}`}
            folder={folder}
            uid={selected}
            onSeen={() => setItems((list) => list.map((i) => (i.uid === selected ? { ...i, seen: true } : i)))}
            onDeleted={() => {
              setItems((list) => list.filter((i) => i.uid !== selected))
              setSelected(null)
            }}
            onCompose={setCompose}
            onUnread={() => setItems((list) => list.map((i) => (i.uid === selected ? { ...i, seen: false } : i)))}
          />
        ) : (
          <div className="empty">메일을 고르세요.</div>
        )}
      </div>
      {compose && (
        <ComposeDialog
          initial={compose}
          onClose={() => setCompose(null)}
          onSent={() => {
            setCompose(null)
            toast('보냈습니다.', 'info')
          }}
        />
      )}
    </div>
  )
}

function MailReader({
  folder,
  uid,
  onSeen,
  onDeleted,
  onCompose,
  onUnread
}: {
  folder: string
  uid: number
  onSeen: () => void
  onDeleted: () => void
  onCompose: (c: Partial<ComposeInput>) => void
  onUnread: () => void
}) {
  const { settings, toast } = useApp()
  const [mail, setMail] = useState<MailDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    call('mail:get', folder, uid)
      .then(async (m) => {
        if (!alive) return
        setMail(m)
        await call('mail:setSeen', folder, uid, true)
        onSeen()
      })
      .catch((e) => alive && setError(errorText(e)))
    return () => {
      alive = false
    }
  }, [folder, uid]) // eslint-disable-line react-hooks/exhaustive-deps

  const html = useMemo(() => (mail?.html ? sanitizeMailHtml(mail.html) : null), [mail?.html])

  if (error) return <div className="banner banner-err">{error}</div>
  if (!mail) return <div className="empty">불러오는 중…</div>

  const myAddress = settings?.mail.address.toLowerCase() ?? ''
  const quote = () => {
    const body = mail.text ?? ''
    const head = `\n\n${formatTime(mail.date)}, ${full(mail.from)} 작성:\n`
    return head + body.split('\n').map((l) => `> ${l}`).join('\n')
  }
  const reSubject = (prefix: string) => (mail.subject.toLowerCase().startsWith(prefix.toLowerCase()) ? mail.subject : `${prefix} ${mail.subject}`)
  const refs = [...mail.references, ...(mail.messageId ? [mail.messageId] : [])]
  const replyTo = mail.replyTo.length ? mail.replyTo : mail.from

  return (
    <div className="mail-view">
      <div className="pane-head">
        <h2 className="grow ellipsis">{mail.subject}</h2>
        <button
          className="small"
          onClick={() =>
            onCompose({ to: full(replyTo), subject: reSubject('Re:'), text: quote(), inReplyTo: mail.messageId, references: refs })
          }
        >
          <Icon name="reply" size={14} /> 답장
        </button>
        <button
          className="small"
          onClick={() =>
            onCompose({
              to: full(replyTo),
              cc: full([...mail.to, ...mail.cc].filter((a) => a.address.toLowerCase() !== myAddress)),
              subject: reSubject('Re:'),
              text: quote(),
              inReplyTo: mail.messageId,
              references: refs
            })
          }
        >
          전체 답장
        </button>
        <button className="small" onClick={() => onCompose({ subject: reSubject('Fwd:'), text: quote() })}>
          전달
        </button>
        <button
          className="icon-btn"
          title="안 읽음으로"
          aria-label="안 읽음으로 표시"
          onClick={async () => {
            try {
              await call('mail:setSeen', folder, uid, false)
              onUnread()
            } catch (e) {
              toast(errorText(e))
            }
          }}
        >
          <Icon name="eye" size={16} />
        </button>
        <button
          className="icon-btn"
          title="삭제 (휴지통으로)"
          aria-label="삭제"
          onClick={async () => {
            if (!window.confirm('이 메일을 휴지통으로 옮길까요? (휴지통에서 지우면 완전히 삭제됩니다)')) return
            try {
              await call('mail:delete', folder, uid)
              onDeleted()
            } catch (e) {
              toast(errorText(e))
            }
          }}
        >
          <Icon name="trash" size={16} />
        </button>
      </div>
      <dl className="mail-meta">
        <dt>보낸 사람</dt>
        <dd>{full(mail.from)}</dd>
        <dt>받는 사람</dt>
        <dd>{full(mail.to)}</dd>
        {mail.cc.length > 0 && (
          <>
            <dt>참조</dt>
            <dd>{full(mail.cc)}</dd>
          </>
        )}
        <dt>날짜</dt>
        <dd>{mail.date ? new Date(mail.date).toLocaleString('ko-KR') : ''}</dd>
      </dl>
      {mail.attachments.length > 0 && (
        <div className="attachments row wrap">
          {mail.attachments.map((a) => (
            <button
              key={a.index}
              className="file-chip"
              onClick={async () => {
                try {
                  const saved = await call('mail:downloadAttachment', folder, uid, a.index)
                  if (saved) toast(`저장했습니다: ${saved}`, 'info')
                } catch (e) {
                  toast(errorText(e))
                }
              }}
            >
              <Icon name="download" size={14} /> {a.filename} <span className="muted">{formatSize(a.size)}</span>
            </button>
          ))}
        </div>
      )}
      {html ? (
        // sandbox: 스크립트·폼·같은 출처 권한 없음. 링크는 새 창(=외부 브라우저)으로만 열린다. 외부 이미지는 CSP 로 막힌다(추적 방지).
        <iframe className="mail-frame" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={html} title="메일 본문" />
      ) : (
        <pre className="mail-text">{mail.text}</pre>
      )}
    </div>
  )
}

function ComposeDialog({ initial, onClose, onSent }: { initial: Partial<ComposeInput>; onClose: () => void; onSent: () => void }) {
  const { toast } = useApp()
  const [to, setTo] = useState(initial.to ?? '')
  const [cc, setCc] = useState(initial.cc ?? '')
  const [bcc, setBcc] = useState(initial.bcc ?? '')
  const [subject, setSubject] = useState(initial.subject ?? '')
  const [text, setText] = useState(initial.text ?? '')
  const [files, setFiles] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const [showCc, setShowCc] = useState(!!initial.cc)

  const close = () => {
    if ((text !== (initial.text ?? '') || to !== (initial.to ?? '')) && !window.confirm('작성 중인 메일을 버릴까요?')) return
    onClose()
  }

  return (
    <Modal title="메일 쓰기" onClose={close} wide>
      <form
        className="form compose"
        onSubmit={async (e) => {
          e.preventDefault()
          setSending(true)
          try {
            await call('mail:send', {
              to,
              cc,
              bcc,
              subject,
              text,
              attachmentPaths: files,
              inReplyTo: initial.inReplyTo ?? null,
              references: initial.references ?? []
            })
            onSent()
          } catch (err) {
            toast(errorText(err))
          } finally {
            setSending(false)
          }
        }}
      >
        <label>
          <span>받는 사람</span>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="쉼표로 구분" required autoFocus={!initial.to} />
        </label>
        {showCc ? (
          <>
            <label>
              <span>참조</span>
              <input value={cc} onChange={(e) => setCc(e.target.value)} />
            </label>
            <label>
              <span>숨은참조</span>
              <input value={bcc} onChange={(e) => setBcc(e.target.value)} />
            </label>
          </>
        ) : (
          <button type="button" className="link" onClick={() => setShowCc(true)}>
            참조·숨은참조 추가
          </button>
        )}
        <label>
          <span>제목</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} />
        </label>
        <textarea className="compose-body" value={text} onChange={(e) => setText(e.target.value)} autoFocus={!!initial.to} aria-label="본문" />
        <div className="row wrap">
          <button
            type="button"
            className="small"
            onClick={async () => {
              const picked = await call('file:pick')
              setFiles((f) => [...new Set([...f, ...picked])])
            }}
          >
            <Icon name="clip" size={14} /> 파일 첨부
          </button>
          {files.map((f) => (
            <button type="button" key={f} className="chip" onClick={() => setFiles((l) => l.filter((x) => x !== f))} title="빼기">
              {f.split(/[\\/]/).pop()} ✕
            </button>
          ))}
        </div>
        <div className="row end">
          <span className="muted small grow">일반 텍스트로 보냅니다.</span>
          <button type="button" onClick={close}>
            취소
          </button>
          <button className="primary" disabled={sending || !to.trim()}>
            {sending ? '보내는 중…' : '보내기'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
