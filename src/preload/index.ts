import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC_CHANNELS, IPC_EVENTS, type IpcChannel, type IpcEventName } from '@shared/ipc'

// renderer 에는 Node·Electron 을 직접 열지 않고, 정해진 채널만 통과시키는 두 함수만 내보낸다.
const allowed = new Set<string>(IPC_CHANNELS)
const allowedEvents = new Set<string>(IPC_EVENTS)

contextBridge.exposeInMainWorld('dooray', {
  invoke(channel: IpcChannel, ...args: unknown[]) {
    if (!allowed.has(channel)) return Promise.reject(new Error(`허용되지 않은 채널: ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  },
  on(event: IpcEventName, cb: (payload: unknown) => void) {
    if (!allowedEvents.has(event)) return () => {}
    const listener = (_e: IpcRendererEvent, payload: unknown) => cb(payload)
    ipcRenderer.on(event, listener)
    return () => ipcRenderer.removeListener(event, listener)
  }
})
