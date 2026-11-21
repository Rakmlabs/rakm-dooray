import { randomUUID } from 'node:crypto'
import type { Channel, Member, Message, MessageFile, ThreadInfo } from '@shared/types'
import type { DoorayHttp, DownloadedFile } from './http'

// 응답 원형 (공식 문서 + 커뮤니티 실측). 알 수 없는 필드는 무시한다.
interface RawChannel {
  id: string | number
  title?: string | null
  type?: string
  status?: string
  updatedAt?: string | null
  users?: { participants?: { member?: { organizationMemberId?: string } }[] }
  me?: { member?: { organizationMemberId?: string } }
}

interface RawLog {
  id: string | number
  seq?: number | string
  type?: string
  sender?: { type?: string; member?: { organizationMemberId?: string } }
  sentAt?: string
  text?: string | null
  flags?: string | null
  file?: { id?: string | number; name?: string; fileName?: string; fileSize?: number; size?: number; mimeType?: string } | null
  thread?: { channelId?: string | number; totalCount?: string | number; lastUpdatedAt?: number | string } | null
}

interface RawMember {
  id: string
  name?: string
  externalEmailAddress?: string
}

interface SendResult {
  id: string | number
  channelId?: string | number
}

export function normalizeChannel(c: RawChannel): Channel {
  return {
    id: String(c.id),
    title: c.title ?? '',
    type: c.type ?? 'private',
    status: c.status ?? 'normal',
    updatedAt: c.updatedAt ?? null,
    participantIds: (c.users?.participants ?? [])
      .map((p) => p.member?.organizationMemberId)
      .filter((v): v is string => !!v),
    meId: c.me?.member?.organizationMemberId ?? null
  }
}

/** 답장(REPLY)은 text 가 {"type":0,"text":"..."} JSON 문자열로 온다 (비공식). 본문만 꺼낸다. */
export function unwrapText(type: string | undefined, text: string | null | undefined): string {
  const raw = text ?? ''
  if (type !== 'REPLY' && !raw.startsWith('{"')) return raw
  try {
    const parsed = JSON.parse(raw) as { text?: unknown }
    if (typeof parsed.text === 'string') return parsed.text
  } catch {
    /* 원문 유지 */
  }
  return raw
}

function normalizeFile(f: RawLog['file']): MessageFile | null {
  if (!f || f.id === undefined || f.id === null) return null
  return {
    id: String(f.id),
    name: f.name ?? f.fileName ?? '첨부 파일',
    size: f.fileSize ?? f.size ?? null,
    mimeType: f.mimeType ?? null
  }
}

function normalizeThread(t: RawLog['thread']): ThreadInfo | null {
  if (!t || t.channelId === undefined || t.channelId === null) return null
  const last = t.lastUpdatedAt === undefined || t.lastUpdatedAt === null ? null : Number(t.lastUpdatedAt)
  return {
    channelId: String(t.channelId),
    totalCount: Number(t.totalCount ?? 0) || 0,
    lastUpdatedAt: Number.isFinite(last) ? last : null
  }
}

export function normalizeLog(channelId: string, l: RawLog): Message {
  return {
    id: String(l.id),
    channelId,
    seq: Number(l.seq ?? 0) || 0,
    type: l.type ?? 'TEXT',
    senderId: l.sender?.member?.organizationMemberId ?? null,
    senderType: l.sender?.type ?? null,
    sentAt: l.sentAt ?? null,
    text: unwrapText(l.type, l.text),
    flags: l.flags ?? null,
    file: normalizeFile(l.file),
    thread: normalizeThread(l.thread)
  }
}

function toSendResult(r: SendResult | null, fallbackChannel: string): { id: string; channelId: string } {
  return { id: r ? String(r.id) : '', channelId: r?.channelId !== undefined ? String(r.channelId) : fallbackChannel }
}

export class MessengerApi {
  private readonly members = new Map<string, Member>()

  constructor(private readonly http: DoorayHttp) {}

  async me(): Promise<Member> {
    const m = await this.http.get<RawMember>('/common/v1/members/me')
    const member = { id: String(m.id), name: m.name ?? '', email: m.externalEmailAddress ?? null }
    this.members.set(member.id, member)
    return member
  }

  async channels(): Promise<Channel[]> {
    const list = await this.http.get<RawChannel[]>('/messenger/v1/channels')
    return (list ?? []).map(normalizeChannel)
  }

  /** 비공식 엔드포인트. 최신 size 개만 (최대 1000), 페이지네이션 없음. seq 오름차순으로 돌려준다. */
  async logs(channelId: string, size: number): Promise<Message[]> {
    const n = Math.min(1000, Math.max(1, Math.round(size)))
    const list = await this.http.get<RawLog[]>(`/messenger/v1/channels/${enc(channelId)}/logs`, { size: n })
    return (list ?? []).map((l) => normalizeLog(channelId, l)).sort((a, b) => a.seq - b.seq)
  }

  async member(id: string): Promise<Member> {
    const cached = this.members.get(id)
    if (cached) return cached
    const m = await this.http.get<RawMember>(`/common/v1/members/${enc(id)}`)
    const member = { id: String(m.id ?? id), name: m.name ?? id, email: m.externalEmailAddress ?? null }
    this.members.set(id, member)
    return member
  }

  async searchMembers(name: string): Promise<Member[]> {
    const list = await this.http.get<RawMember[]>('/common/v1/members', { name, size: 20 })
    return (list ?? []).map((m) => ({ id: String(m.id), name: m.name ?? '', email: m.externalEmailAddress ?? null }))
  }

  async send(channelId: string, text: string) {
    const { result } = await this.http.json<SendResult>('POST', `/messenger/v1/channels/${enc(channelId)}/logs`, {
      body: { text }
    })
    return toSendResult(result, channelId)
  }

  async update(channelId: string, logId: string, text: string): Promise<null> {
    await this.http.json('PUT', `/messenger/v1/channels/${enc(channelId)}/logs/${enc(logId)}`, { body: { text } })
    return null
  }

  async remove(channelId: string, logId: string): Promise<null> {
    await this.http.json('DELETE', `/messenger/v1/channels/${enc(channelId)}/logs/${enc(logId)}`)
    return null
  }

  async reply(channelId: string, logId: string, text: string) {
    const { result } = await this.http.json<SendResult>(
      'POST',
      `/messenger/v1/channels/${enc(channelId)}/logs/${enc(logId)}/reply`,
      { body: { text } }
    )
    return toSendResult(result, channelId)
  }

  /** 새 메시지 + 스레드. 응답 channelId 가 스레드 채널 ID 다. */
  async createThread(channelId: string, text: string, threadText: string | null) {
    const body: Record<string, string> = { text }
    if (threadText) body.threadText = threadText
    const { result } = await this.http.json<SendResult>(
      'POST',
      `/messenger/v1/channels/${enc(channelId)}/threads/create-and-send`,
      { body }
    )
    return toSendResult(result, channelId)
  }

  async threadFromMessage(channelId: string, logId: string, text: string) {
    const { result } = await this.http.json<SendResult>(
      'POST',
      `/messenger/v1/channels/${enc(channelId)}/logs/${enc(logId)}/threads/create-and-send`,
      { body: { text } }
    )
    return toSendResult(result, channelId)
  }

  async directSend(memberId: string, text: string): Promise<null> {
    await this.http.json('POST', '/messenger/v1/channels/direct-send', { body: { organizationMemberId: memberId, text } })
    return null
  }

  async createChannel(title: string, memberIds: string[]): Promise<{ id: string }> {
    const { result } = await this.http.json<{ id: string | number }>('POST', '/messenger/v1/channels', {
      query: { idType: 'member-id' },
      body: { type: 'private', capacity: '100', memberIds, title }
    })
    return { id: String(result?.id ?? '') }
  }

  /** 비공식. 307 → file-api */
  downloadFile(channelId: string, fileId: string): Promise<DownloadedFile> {
    return this.http.download(`/messenger/v1/channels/${enc(channelId)}/files/${enc(fileId)}`)
  }

  /** 비공식. 307 → file-api, multipart(attach, fileName, mimeType, token) */
  async uploadFile(channelId: string, fileName: string, mimeType: string, bytes: Buffer): Promise<void> {
    const token = randomUUID()
    await this.http.upload(`/messenger/v1/channels/${enc(channelId)}/files`, () => {
      const form = new FormData()
      form.append('attach', new Blob([new Uint8Array(bytes)], { type: mimeType }), fileName)
      form.append('fileName', fileName)
      form.append('mimeType', mimeType)
      form.append('token', token)
      return form
    })
  }
}

function enc(v: string): string {
  return encodeURIComponent(v)
}
