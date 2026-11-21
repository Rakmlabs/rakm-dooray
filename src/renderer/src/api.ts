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
  return e instanceof Error ? e.message : String(e)
}
