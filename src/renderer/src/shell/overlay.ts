// 메신저 화면 등에서 App 의 검색 창을 열 때 쓰는 작은 이벤트 (App 이 받는다)
export interface SearchRequest {
  q?: string
  scope?: { channelId: string; title: string } | null
}

const bus = new EventTarget()

export function openSearch(req: SearchRequest = {}): void {
  bus.dispatchEvent(new CustomEvent('search', { detail: req }))
}

export function onOpenSearch(cb: (req: SearchRequest) => void): () => void {
  const h = (e: Event) => cb((e as CustomEvent<SearchRequest>).detail)
  bus.addEventListener('search', h)
  return () => bus.removeEventListener('search', h)
}
