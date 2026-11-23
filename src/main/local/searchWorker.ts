// 검색 작업 스레드: 보관함을 읽기 전용으로 따로 열어 LIKE 검색을 돌린다.
// 메시지가 수십만 개면 검색 한 번이 100ms 가까이 걸려, 메인 프로세스에서 돌리면 그동안 IPC·알림·창 응답이 멈춘다.
import { parentPort, workerData } from 'node:worker_threads'
import { LocalArchive } from './archive'

export interface SearchRequest {
  id: number
  query: string
  channelId: string | null
}

const archive = new LocalArchive((workerData as { path: string }).path, { readOnly: true })
parentPort?.on('message', (m: SearchRequest) => {
  try {
    const value = {
      messages: archive.searchMessages(m.query, m.channelId),
      wiki: m.channelId ? [] : archive.searchWiki(m.query)
    }
    parentPort?.postMessage({ id: m.id, ok: true, value })
  } catch (e) {
    parentPort?.postMessage({ id: m.id, ok: false, error: e instanceof Error ? e.message : String(e) })
  }
})
