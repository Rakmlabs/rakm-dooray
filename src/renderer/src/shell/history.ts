import type { NavRequest } from '../lib/nav'

// ⌘[ / ⌘] 로 오가는 최근 위치 (대화방·위키 페이지). 앱을 켜 있는 동안만 기억한다.

export function sameTarget(a: NavRequest, b: NavRequest): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'channel':
      return a.channelId === (b as typeof a).channelId
    case 'thread':
      return a.threadChannelId === (b as typeof a).threadChannelId
    case 'direct':
      return a.memberId === (b as typeof a).memberId
    case 'wikiPage':
      return a.pageId === (b as typeof a).pageId
    default:
      return true
  }
}

export class NavHistory {
  private items: NavRequest[] = []
  private index = -1

  constructor(private readonly max = 50) {}

  private paused = false

  /** fn 이 도는 동안의 이동은 기록하지 않는다 (뒤로/앞으로 이동 자체) */
  silently(fn: () => void): void {
    this.paused = true
    try {
      fn()
    } finally {
      this.paused = false
    }
  }

  push(t: NavRequest): void {
    if (this.paused) return
    // 메시지 위치까지는 기억하지 않는다 (대화방 단위로)
    const entry: NavRequest = t.kind === 'channel' ? { kind: 'channel', channelId: t.channelId } : t
    const cur = this.items[this.index]
    if (cur && sameTarget(cur, entry)) return
    this.items = this.items.slice(0, this.index + 1)
    this.items.push(entry)
    if (this.items.length > this.max) this.items.shift()
    this.index = this.items.length - 1
  }

  back(): NavRequest | null {
    if (this.index <= 0) return null
    return this.items[--this.index]
  }

  forward(): NavRequest | null {
    if (this.index >= this.items.length - 1) return null
    return this.items[++this.index]
  }

  get canBack(): boolean {
    return this.index > 0
  }

  get canForward(): boolean {
    return this.index < this.items.length - 1
  }
}

export const navHistory = new NavHistory()
