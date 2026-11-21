import type { RecentItem } from '@shared/types-shell'
import type { NavRequest } from '../lib/nav'

export function targetKey(t: NavRequest): string {
  switch (t.kind) {
    case 'channel':
      return `c:${t.channelId}`
    case 'thread':
      return `t:${t.threadChannelId}`
    case 'direct':
      return `m:${t.memberId}`
    case 'wikiPage':
      return `w:${t.pageId}`
    default:
      return t.kind
  }
}

/** 최근 목록 맨 앞에 넣는다 (같은 대상은 하나만) */
export function pushRecent(list: RecentItem[], item: Omit<RecentItem, 'at' | 'key'>, max = 30, now = Date.now()): RecentItem[] {
  const target = item.target.kind === 'channel' ? { kind: 'channel' as const, channelId: item.target.channelId } : item.target
  const key = targetKey(target)
  return [{ ...item, target, key, at: now }, ...list.filter((r) => r.key !== key)].slice(0, max)
}
