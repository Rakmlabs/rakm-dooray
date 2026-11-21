/**
 * 화면 사이 이동 요청 (영역끼리 서로의 내부 상태를 몰라도 되게 하는 작은 이벤트 버스).
 * 요청은 누구나 보내고, 처리는 셸(App/Messenger/Wiki) 쪽이 onNav 로 받는다.
 */
export type NavRequest =
  | { kind: 'channel'; channelId: string; messageId?: string }
  | { kind: 'thread'; channelId: string; threadChannelId: string }
  | { kind: 'direct'; memberId: string }
  | { kind: 'wikiPage'; wikiId: string; pageId: string }
  | { kind: 'settings' }

const bus = new EventTarget()

export function navigate(req: NavRequest): void {
  bus.dispatchEvent(new CustomEvent('nav', { detail: req }))
}

export function onNav(cb: (req: NavRequest) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<NavRequest>).detail)
  bus.addEventListener('nav', h)
  return () => bus.removeEventListener('nav', h)
}
