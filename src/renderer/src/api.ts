import type { IpcChannel, IpcContract, IpcEventName, IpcEvents } from '@shared/ipc'

interface Envelope {
  ok: boolean
  value?: unknown
  error?: string
  notConfigured?: boolean
}

declare global {
  interface Window {
    dooray: {
      invoke(channel: IpcChannel, ...args: unknown[]): Promise<Envelope>
      on(event: IpcEventName, cb: (payload: unknown) => void): () => void
    }
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly notConfigured: boolean
  ) {
    super(message)
  }
}

/** main 프로세스 호출. 네트워크는 전부 main 에서 일어난다. */
export async function call<K extends IpcChannel>(
  channel: K,
  ...args: IpcContract[K]['args']
): Promise<IpcContract[K]['result']> {
  const r = await window.dooray.invoke(channel, ...args)
  if (!r.ok) throw new ApiError(r.error ?? '알 수 없는 오류', !!r.notConfigured)
  return r.value as IpcContract[K]['result']
}

export function onEvent<E extends IpcEventName>(event: E, cb: (payload: IpcEvents[E]) => void): () => void {
  return window.dooray.on(event, (p) => cb(p as IpcEvents[E]))
}

export function errorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  // 네트워크가 끊겼을 때 Node fetch 가 주는 영어 문구를 그대로 보이지 않게
  if (/^(.*: )?(fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|network error)/i.test(raw)) {
    return '두레이에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.'
  }
  return raw
}
