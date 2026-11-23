// 성능 측정: 보관함(archive.db) 쿼리 시간. 앱이 쓰는 것과 같은 SQL 을 그대로 돌린다.
//   node scripts/bench/bench-db.mjs <userData 폴더>
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'

const db = new DatabaseSync(join(process.argv[2], 'local', 'archive.db'))
const CH = 'c-history'
const time = (label, fn, n = 20) => {
  fn()
  const t = performance.now()
  for (let i = 0; i < n; i++) fn()
  const ms = (performance.now() - t) / n
  console.log(`${label}: ${ms.toFixed(2)} ms`)
}
console.log('rows', db.prepare('select count(*) n from messages').get().n)
const latest = db.prepare('select data from messages where channel_id = ? order by seq desc, sent_ms desc limit ?')
time('최신 100개 + JSON.parse', () => latest.all(CH, 100).map((r) => JSON.parse(r.data)))
time('최신 3000개 + JSON.parse', () => latest.all(CH, 3000).map((r) => JSON.parse(r.data)))
const before = db.prepare('select data from messages where channel_id = ? and (seq < ? or (seq = ? and sent_ms < ?)) order by seq desc, sent_ms desc limit ?')
time('특정 지점 이전 200개 (커서)', () => before.all(CH, 20000, 20000, Number.MAX_SAFE_INTEGER, 200))
time('채널 메시지 수', () => db.prepare('select count(*) as n from messages where channel_id = ?').get(CH))
const unread = db.prepare('select count(*) as n from messages where channel_id = ? and sent_ms > ? and sender_id is not null and sender_id <> ?')
time('안 읽음 수 (채널 하나)', () => unread.get(CH, Date.now() - 86_400_000 * 3, 'm-me'))
console.log('plan 안 읽음:', db.prepare('explain query plan select count(*) as n from messages where channel_id = ? and sent_ms > ? and sender_id is not null and sender_id <> ?').all(CH, 0, 'x').map((r) => r.detail).join(' | '))
const like = db.prepare("select count(*) n from messages where text like ? escape '\\'")
time('본문 검색 LIKE', () => like.get('%회고%'), 5)
