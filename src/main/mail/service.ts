import { ImapFlow, type FetchMessageObject, type MessageAddressObject } from 'imapflow'
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser'
import nodemailer from 'nodemailer'
import { basename } from 'node:path'
import type { ComposeInput, MailAddress, MailDetail, MailFolder, MailPage, MailSummary } from '@shared/types'
import { NotConfiguredError } from '../dooray/http'

/**
 * 두레이 메일은 REST API 가 없어 IMAP(수신)/SMTP(발신)로 다룬다.
 * 공식 도움말 기준: imap.dooray.com:993 SSL, smtp.dooray.com:465 SSL, 아이디는 메일 주소,
 * 비밀번호는 "설정 > 메일 > IMAP" 화면의 값. Business 플랜 이상 + 관리자 허용 필요.
 */

export interface MailConfig {
  address: string
  displayName: string
  password: string
  imapHost: string
  imapPort: number
  smtpHost: string
  smtpPort: number
}

export class MailService {
  private client: ImapFlow | null = null
  private connecting: Promise<ImapFlow> | null = null
  private configKey = ''

  constructor(private readonly getConfig: () => Promise<MailConfig | null>) {}

  private async config(): Promise<MailConfig> {
    const c = await this.getConfig()
    if (!c || !c.address || !c.password) {
      throw new NotConfiguredError('메일 계정이 설정되지 않았습니다. 설정 화면에서 메일 주소와 IMAP 비밀번호를 입력하세요.')
    }
    return c
  }

  private async imap(): Promise<ImapFlow> {
    const c = await this.config()
    const key = `${c.address}|${c.imapHost}|${c.imapPort}|${c.password.length}`
    if (this.client && this.client.usable && key === this.configKey) return this.client
    if (this.connecting) return this.connecting
    this.connecting = (async () => {
      await this.close()
      const client = new ImapFlow({
        host: c.imapHost,
        port: c.imapPort,
        secure: c.imapPort === 993,
        auth: { user: c.address, pass: c.password },
        logger: false
      })
      client.on('error', () => {
        /* 끊기면 다음 호출에서 다시 연결한다 */
      })
      await client.connect()
      this.client = client
      this.configKey = key
      return client
    })()
    try {
      return await this.connecting
    } finally {
      this.connecting = null
    }
  }

  async close(): Promise<void> {
    const c = this.client
    this.client = null
    if (c) {
      try {
        await c.logout()
      } catch {
        /* 무시 */
      }
    }
  }

  /** 설정 확인용: IMAP 로그인과 SMTP 인증을 각각 시험한다. */
  async test(): Promise<string> {
    const c = await this.config()
    await this.close()
    const client = new ImapFlow({
      host: c.imapHost,
      port: c.imapPort,
      secure: c.imapPort === 993,
      auth: { user: c.address, pass: c.password },
      logger: false
    })
    client.on('error', () => {})
    await client.connect()
    await client.logout()
    await this.transport(c).verify()
    return 'IMAP 로그인과 SMTP 인증에 성공했습니다.'
  }

  async folders(): Promise<MailFolder[]> {
    const client = await this.imap()
    const list = await client.list()
    return list
      .filter((f) => !f.flags?.has('\\Noselect'))
      .map((f) => ({
        path: f.path,
        name: folderLabel(f.specialUse ?? null, f.name),
        specialUse: f.specialUse ?? null,
        depth: f.delimiter ? f.path.split(f.delimiter).length - 1 : 0
      }))
      .sort((a, b) => folderRank(a.specialUse) - folderRank(b.specialUse) || a.path.localeCompare(b.path))
  }

  /** 최신 메일부터 page 단위로. 순번(seq) 범위로 가져오고 UID 를 돌려준다. */
  async list(folder: string, page: number, pageSize: number): Promise<MailPage> {
    const client = await this.imap()
    const lock = await client.getMailboxLock(folder)
    try {
      const mailbox = client.mailbox
      const total = mailbox ? mailbox.exists : 0
      const items: MailSummary[] = []
      const end = total - page * pageSize
      const start = Math.max(1, end - pageSize + 1)
      if (end >= 1) {
        for await (const m of client.fetch(`${start}:${end}`, {
          uid: true,
          envelope: true,
          flags: true,
          size: true,
          bodyStructure: true
        })) {
          items.push(summary(m))
        }
      }
      items.sort((a, b) => b.uid - a.uid)
      return { folder, total, page, pageSize, items }
    } finally {
      lock.release()
    }
  }

  private async parsed(folder: string, uid: number): Promise<ParsedMail> {
    const client = await this.imap()
    const lock = await client.getMailboxLock(folder)
    try {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true })
      if (!msg || !msg.source) throw new Error('메일을 찾을 수 없습니다.')
      return await simpleParser(msg.source)
    } finally {
      lock.release()
    }
  }

  async get(folder: string, uid: number): Promise<MailDetail> {
    const p = await this.parsed(folder, uid)
    const inline = new Map<string, string>()
    for (const a of p.attachments) {
      if (a.cid && a.size < 3 * 1024 * 1024 && a.contentType.startsWith('image/')) {
        inline.set(a.cid, `data:${a.contentType};base64,${a.content.toString('base64')}`)
      }
    }
    let html = typeof p.html === 'string' ? p.html : null
    if (html && inline.size) {
      html = html.replace(/cid:([^"'\s)>]+)/g, (m, cid: string) => inline.get(cid) ?? m)
    }
    return {
      uid,
      folder,
      subject: p.subject ?? '(제목 없음)',
      from: addrs(p.from),
      to: addrs(p.to),
      cc: addrs(p.cc),
      replyTo: addrs(p.replyTo),
      date: p.date ? p.date.toISOString() : null,
      messageId: p.messageId ?? null,
      references: Array.isArray(p.references) ? p.references : p.references ? [p.references] : [],
      html,
      text: p.text ?? null,
      attachments: p.attachments
        .map((a, index) => ({ a, index }))
        .filter(({ a }) => !(a.cid && inline.has(a.cid) && a.contentDisposition === 'inline'))
        .map(({ a, index }) => ({
          index,
          filename: a.filename ?? `첨부${index + 1}`,
          contentType: a.contentType,
          size: a.size
        }))
    }
  }

  async attachment(folder: string, uid: number, index: number): Promise<{ filename: string; content: Buffer }> {
    const p = await this.parsed(folder, uid)
    const a = p.attachments[index]
    if (!a) throw new Error('첨부 파일을 찾을 수 없습니다.')
    return { filename: a.filename ?? `첨부${index + 1}`, content: a.content }
  }

  async setSeen(folder: string, uid: number, seen: boolean): Promise<null> {
    const client = await this.imap()
    const lock = await client.getMailboxLock(folder)
    try {
      if (seen) await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
      else await client.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true })
    } finally {
      lock.release()
    }
    return null
  }

  /** 휴지통으로 옮긴다. 이미 휴지통이면 삭제 표시 후 지운다. */
  async remove(folder: string, uid: number): Promise<null> {
    const client = await this.imap()
    const trash = (await client.list()).find((f) => f.specialUse === '\\Trash')?.path
    const lock = await client.getMailboxLock(folder)
    try {
      if (trash && trash !== folder) await client.messageMove(String(uid), trash, { uid: true })
      else await client.messageDelete(String(uid), { uid: true })
    } finally {
      lock.release()
    }
    return null
  }

  private transport(c: MailConfig) {
    return nodemailer.createTransport({
      host: c.smtpHost,
      port: c.smtpPort,
      secure: c.smtpPort === 465,
      auth: { user: c.address, pass: c.password }
    })
  }

  async send(input: ComposeInput): Promise<null> {
    const c = await this.config()
    const to = splitAddresses(input.to)
    if (to.length === 0) throw new Error('받는 사람을 입력하세요.')
    await this.transport(c).sendMail({
      from: c.displayName ? { name: c.displayName, address: c.address } : c.address,
      to,
      cc: splitAddresses(input.cc),
      bcc: splitAddresses(input.bcc),
      subject: input.subject,
      text: input.text,
      inReplyTo: input.inReplyTo ?? undefined,
      references: input.references && input.references.length ? input.references : undefined,
      attachments: input.attachmentPaths.map((p) => ({ path: p, filename: basename(p) }))
    })
    return null
  }
}

export function splitAddresses(v: string): string[] {
  return v
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function addrs(a: AddressObject | AddressObject[] | undefined): MailAddress[] {
  if (!a) return []
  const list = Array.isArray(a) ? a : [a]
  return list.flatMap((o) => o.value.map((v) => ({ name: v.name ?? '', address: v.address ?? '' })))
}

function envAddrs(list: MessageAddressObject[] | undefined): MailAddress[] {
  return (list ?? []).map((v) => ({ name: v.name ?? '', address: v.address ?? '' }))
}

function hasAttachment(node: FetchMessageObject['bodyStructure']): boolean {
  if (!node) return false
  if (node.disposition === 'attachment') return true
  return (node.childNodes ?? []).some(hasAttachment)
}

function summary(m: FetchMessageObject): MailSummary {
  return {
    uid: m.uid,
    subject: m.envelope?.subject || '(제목 없음)',
    from: envAddrs(m.envelope?.from),
    to: envAddrs(m.envelope?.to),
    date: m.envelope?.date ? new Date(m.envelope.date).toISOString() : null,
    seen: !!m.flags?.has('\\Seen'),
    flagged: !!m.flags?.has('\\Flagged'),
    hasAttachments: hasAttachment(m.bodyStructure),
    size: m.size ?? 0
  }
}

const RANK: Record<string, number> = { '\\Inbox': 0, '\\Flagged': 1, '\\Sent': 2, '\\Drafts': 3, '\\Junk': 5, '\\Trash': 6 }
function folderRank(s: string | null): number {
  return s ? (RANK[s] ?? 4) : 4
}

function folderLabel(specialUse: string | null, name: string): string {
  switch (specialUse) {
    case '\\Inbox':
      return '받은편지함'
    case '\\Sent':
      return '보낸편지함'
    case '\\Drafts':
      return '임시보관함'
    case '\\Trash':
      return '휴지통'
    case '\\Junk':
      return '스팸'
    default:
      return name === 'INBOX' ? '받은편지함' : name
  }
}
