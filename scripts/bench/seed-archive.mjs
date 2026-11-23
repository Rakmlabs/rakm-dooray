// 성능 측정용: 로컬 보관함(archive.db)에 '오래된 기록방'(c-history)의 오래된 메시지 N개를 미리 넣는다.
//   node scripts/bench/seed-archive.mjs <userData 폴더> [개수=30000]
// 모의 서버의 c-history 는 seq 1,000,000 부터라, 여기서 넣는 seq 1..N 은 그보다 오래된 기록으로 남는다.
// 앱을 켜기 전에 돌린다 (앱이 열고 있으면 잠겨 있을 수 있다).
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const [dir, countArg] = process.argv.slice(2)
if (!dir) {
  console.error('사용법: node scripts/bench/seed-archive.mjs <userData 폴더> [개수]')
  process.exit(1)
}
const N = Number(countArg || 30000)
mkdirSync(join(dir, 'local'), { recursive: true })
const db = new DatabaseSync(join(dir, 'local', 'archive.db'))
db.exec('pragma journal_mode = wal;')
db.exec(`create table if not exists messages(
  channel_id text not null, id text not null, seq integer not null, sent_ms integer not null,
  sender_id text, text text not null default '', data text not null, primary key(channel_id, id));
create index if not exists idx_messages_order on messages(channel_id, seq, sent_ms);
create index if not exists idx_messages_sent on messages(sent_ms);`)

const CH = 'c-history'
// 서버 쪽 기록(1500개 × 25분)보다 오래되게: 27일 전부터 거꾸로 10분 간격
const end = Date.now() - 27 * 86_400_000
const ins = db.prepare('insert or replace into messages(channel_id, id, seq, sent_ms, sender_id, text, data) values (?, ?, ?, ?, ?, ?, ?)')
db.exec('begin')
for (let i = 1; i <= N; i++) {
  const sent = end - (N - i) * 10 * 60_000
  const who = i % 3 === 0 ? 'm-me' : i % 3 === 1 ? 'm-co' : 'm-dev'
  let text = `오래된 기록 ${i}`
  let type = 'TEXT'
  let file = null
  if (i % 9 === 0) text = `오래된 기록 ${i}\n\`\`\`js\nconst n = ${i}\nconsole.log(n * 2)\n\`\`\``
  else if (i % 4 === 0) text = `오래된 기록 ${i}: 지난 분기 회의 내용을 정리했습니다. 일정, 담당, 남은 일, 고객 문의를 같이 적습니다.`
  if (i % 13 === 0) {
    type = 'FILE'
    text = ''
    file = { id: ['f-img1', 'f-img2', 'f-img3'][i % 3], name: `오래된사진_${i}.jpg`, size: 120_000, mimeType: 'image/jpeg' }
  }
  const m = { id: `old-${i}`, channelId: CH, seq: i, type, senderId: who, senderType: 'member', sentAt: new Date(sent).toISOString(), text, flags: null, file, thread: null }
  ins.run(CH, m.id, m.seq, sent, who, text, JSON.stringify(m))
}
db.exec('commit')
const n = db.prepare('select count(*) as n from messages where channel_id = ?').get(CH).n
console.log(`보관함 ${CH}: ${n}개`)
db.close()
