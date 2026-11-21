import WebSocket from 'ws'
import type { RealtimeStatus } from '@shared/types'
import type { DoorayHttp } from './http'

/**
 * 메신저 실시간 수신.
 *
 * 두레이 공식 문서에는 실시간 수신 수단이 없다. dooray-go/dooray-sdk 의 "Socket Mode" 를 따라
 *   1) POST /common/v1/socket-mode/tokens  (dooray-api 토큰) → accessToken, tenantId, organizationMemberId
 *   2) wss://{회사도메인}/messenger/v5/ws/{tenantId}/{memberId}  (Bearer accessToken)
 * 를 시도한다. SDK 는 이것을 "에이전트(봇) 토큰" 용으로 설명하므로 개인 토큰으로 되는지는 확인되지 않았다.
 * 회사 도메인이 없거나 실패하면 'polling' 상태로 두고, renderer 가 열린 대화방을 주기적으로 조회한다.
 */

interface SocketToken {
  accessToken: string
  tenantId: string
  organizationMemberId: string
}

export interface RealtimeDeps {
  http: DoorayHttp
  getDomain: () => string
  onStatus: (s: RealtimeStatus) => void
  onActivity: (channelId: string) => void
}

export function extractChannelId(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.type !== 'channelLog') return null
  const content = (r.content && typeof r.content === 'object' ? r.content : {}) as Record<string, unknown>
  const id = content.channelId ?? r.channelId
  return id === undefined || id === null ? null : String(id)
}

export class RealtimeService {
  private ws: WebSocket | null = null
  private status: RealtimeStatus = { mode: 'off', detail: '시작 전' }
  private reconnectTimer: NodeJS.Timeout | null = null
  private pingTimer: NodeJS.Timeout | null = null
  private failures = 0
  private stopped = true

  constructor(private readonly deps: RealtimeDeps) {}

  getStatus(): RealtimeStatus {
    return this.status
  }

  private setStatus(s: RealtimeStatus): void {
    this.status = s
    this.deps.onStatus(s)
  }

  async restart(): Promise<RealtimeStatus> {
    this.stop()
    this.stopped = false
    this.failures = 0
    await this.connect()
    return this.status
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.reconnectTimer = null
    this.pingTimer = null
    if (this.ws) {
      this.ws.removeAllListeners()
      this.ws.close()
      this.ws = null
    }
  }

  private async connect(): Promise<void> {
    const domain = this.deps.getDomain()
    if (!domain) {
      this.setStatus({ mode: 'polling', detail: '회사 도메인이 없어 폴링으로 동작합니다.' })
      return
    }
    let token: SocketToken
    try {
      const { result } = await this.deps.http.json<SocketToken>('POST', '/common/v1/socket-mode/tokens')
      if (!result?.accessToken || !result.tenantId || !result.organizationMemberId) throw new Error('응답에 필요한 값이 없음')
      token = result
    } catch (e) {
      // 개인 토큰으로 발급이 안 되는 경우가 예상된다. 폴링으로 계속한다.
      this.setStatus({ mode: 'polling', detail: `Socket Mode 토큰 발급 실패 → 폴링 (${errMsg(e)})` })
      return
    }
    const url = `wss://${domain}/messenger/v5/ws/${encodeURIComponent(token.tenantId)}/${encodeURIComponent(token.organizationMemberId)}`
    const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token.accessToken}` }, handshakeTimeout: 10_000 })
    this.ws = ws
    ws.on('open', () => {
      this.failures = 0
      this.setStatus({ mode: 'socket', detail: 'Socket Mode 연결됨' })
      this.pingTimer = setInterval(() => ws.ping(), 30_000)
    })
    ws.on('message', (data) => {
      let raw: unknown
      try {
        raw = JSON.parse(data.toString())
      } catch {
        return
      }
      const r = raw as Record<string, unknown>
      if (typeof r.envelope_id === 'string') ws.send(JSON.stringify({ envelope_id: r.envelope_id }))
      const channelId = extractChannelId(raw)
      if (channelId) this.deps.onActivity(channelId)
    })
    ws.on('error', () => {
      /* close 에서 처리 */
    })
    ws.on('close', () => {
      if (this.pingTimer) clearInterval(this.pingTimer)
      this.pingTimer = null
      this.ws = null
      if (this.stopped) return
      this.failures++
      this.setStatus({ mode: 'polling', detail: 'Socket Mode 연결 끊김 → 재연결 대기 중 (그동안 폴링)' })
      if (this.failures > 5) return
      const delay = Math.min(30_000, 1000 * 2 ** this.failures)
      this.reconnectTimer = setTimeout(() => void this.connect(), delay)
    })
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
