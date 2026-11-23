// 성능 측정 (채팅 밖 전체): 앱을 직접 켜서 시작 시간·탭 전환·⌘K·검색·유휴 CPU·장시간 메모리를 잰다.
//   node scripts/bench/bench-app.mjs <userData> [유휴 초=60] [반복 전환 횟수=150]
// 먼저: npx electron-vite build, 모의 서버(SHELL_MOCK_ARRIVE_MS=0 node scripts/mock-dooray.mjs), 보관함 채우기(seed-archive.mjs)
// 앱은 out/ 을 쓴다. 결과는 JSON 으로 출력.
import { spawn, execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const UD = resolve(process.argv[2] || '')
const IDLE_S = Number(process.argv[3] || 60)
const LOOPS = Number(process.argv[4] || 150)
const PORT = 9334
if (!process.argv[2]) {
  console.error('사용법: node scripts/bench/bench-app.mjs <userData> [유휴 초] [반복 횟수]')
  process.exit(1)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const t0 = Date.now()
const child = spawn('./node_modules/.bin/electron', ['.', `--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`], {
  env: { ...process.env, DOORAY_MOCK_BASE: process.env.DOORAY_MOCK_BASE || 'http://127.0.0.1:8787' },
  stdio: 'ignore',
  detached: !!process.env.BENCH_KEEP
})

let ws
for (;;) {
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
    const page = list.find((x) => x.type === 'page')
    if (page) {
      ws = new WebSocket(page.webSocketDebuggerUrl)
      break
    }
  } catch {
    /* 아직 */
  }
  await sleep(20)
  if (Date.now() - t0 > 30000) throw new Error('앱이 뜨지 않음')
}
await new Promise((r) => (ws.onopen = r))
// 창을 앞으로 (가려져 있으면 Chromium 이 그리기를 멈춰 측정이 달라진다)
try {
  execFileSync('osascript', ['-e', `tell application "System Events" to set frontmost of (first process whose unix id is ${child.pid}) to true`])
} catch {
  /* 권한 없으면 그대로 */
}
let id = 0
const pending = new Map()
ws.onmessage = (m) => {
  const d = JSON.parse(m.data)
  if (pending.has(d.id)) {
    pending.get(d.id)(d)
    pending.delete(d.id)
  }
}
const send = (method, params = {}) =>
  new Promise((r) => {
    const i = ++id
    pending.set(i, r)
    ws.send(JSON.stringify({ id: i, method, params }))
  })
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
  return r.result?.result?.value
}
const waitFor = async (expr, ms = 20000) => {
  const s = Date.now()
  while (Date.now() - s < ms) {
    if (await ev(expr)) return Date.now()
    await sleep(10)
  }
  return null
}
await send('Performance.enable')
const metrics = async (gc = false) => {
  if (gc) {
    await send('HeapProfiler.enable')
    await send('HeapProfiler.collectGarbage')
  }
  const r = await send('Performance.getMetrics')
  const m = Object.fromEntries(r.result.metrics.map((x) => [x.name, x.value]))
  return { jsHeapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), domNodes: m.Nodes, listeners: m.JSEventListeners, scriptMs: Math.round(m.ScriptDuration * 1000), taskMs: Math.round(m.TaskDuration * 1000) }
}
const out = {}

// 1) 시작: 채널 목록이 보일 때, 첫 방 메시지가 보일 때
const tList = await waitFor(`!!document.querySelector('.ch-row')`)
const tMsgs = await waitFor(`!!document.querySelector('.messages [data-msg-id]') || !!document.querySelector('.messages .empty, .chat-empty')`, 8000)
const nav = await ev(`(() => { const n = performance.getEntriesByType('navigation')[0]; return { origin: performance.timeOrigin, dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) } })()`)
const res = await ev(`performance.getEntriesByType('resource').filter(e => /\\.js|\\.mjs|\\.css/.test(e.name)).map(e => ({ name: e.name.split('/').pop(), kb: Math.round((e.decodedBodySize||0)/1024) }))`)
out.startup = { channelListMs: tList - t0, firstMessagesMs: tMsgs ? tMsgs - t0 : null, mainUntilPageMs: Math.round(nav.origin - t0), rendererDCL: nav.dcl, initialScriptsKB: res.reduce((a, b) => a + b.kb, 0), initialScripts: res.map((x) => `${x.name} ${x.kb}KB`) }
await sleep(3000)
out.afterStart = await metrics(true)

// 2) 탭: 위키 열기 → 트리 첫 줄, 메일, 설정
const clickTab = (label) => ev(`[...document.querySelectorAll('.rail-btn')].find(b => b.textContent.includes('${label}'))?.click()`)
let s = Date.now()
await clickTab('위키')
const tTree = await waitFor(`!!document.querySelector('.tree-col .tree-title')`)
out.wikiTreeMs = tTree ? tTree - s : null
// 위키 페이지 하나 열기 → 본문
s = Date.now()
await ev(`document.querySelector('.tree-col .tree-title')?.click()`)
const tPage = await waitFor(`!!document.querySelector('.wiki-body, .ProseMirror, .wiki-html')`, 10000)
out.wikiPageMs = tPage ? tPage - s : null
s = Date.now()
await clickTab('메일')
await sleep(300)
out.mailTabMs = Date.now() - s - 300
await clickTab('메신저')
await sleep(500)

// 3) ⌘K: 열기 → 목록, 타이핑 지연
s = Date.now()
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'k', code: 'KeyK', modifiers: 4, windowsVirtualKeyCode: 75 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'k', code: 'KeyK', modifiers: 4, windowsVirtualKeyCode: 75 })
const tQs = await waitFor(`!!document.querySelector('.qs-list .qs-label')`, 5000)
out.quickSwitcherOpenMs = tQs ? tQs - s : null
await ev(`window.__lat = []; document.addEventListener('keydown', (e) => { const s = e.timeStamp; requestAnimationFrame(() => setTimeout(() => window.__lat.push(performance.now() - s), 0)) }, true)`)
for (const ch of '기록방잡담') {
  await send('Input.insertText', { text: ch })
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Unidentified' })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Unidentified' })
  await sleep(80)
}
await sleep(300)
const lat = ((await ev('window.__lat')) || []).sort((a, b) => a - b)
out.quickSwitcherTypingMaxMs = lat.length ? +lat[lat.length - 1].toFixed(1) : null
await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await sleep(300)

// 4) 유휴 CPU: 앱 프로세스(메인·렌더러·GPU·유틸) 누적 CPU 시간 차이
const procs = () => {
  const lines = execFileSync('ps', ['-A', '-o', 'pid=,time=,rss=,command='], { encoding: 'utf8' }).split('\n')
  return lines
    .filter((l) => l.includes(`--user-data-dir=${UD}`) || l.includes(`user-data-dir=${UD}`))
    .map((l) => {
      const [pid, time, rss] = l.trim().split(/\s+/)
      const [m, sec] = time.split(':')
      const type = /--type=renderer/.test(l) ? 'renderer' : /--type=gpu/.test(l) ? 'gpu' : /--type=/.test(l) ? 'utility' : 'main'
      return { pid, type, cpu: Number(m) * 60 + Number(sec), rssMB: Number(rss) / 1024 }
    })
}
await ev(`window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration) }).observe({ type: 'longtask' })`)
// 창이 앞에 있는 상태(포커스)와 같은 조건: 메신저 탭, 맨 아래
const cpu = (ps) => ps.reduce((a, b) => a + b.cpu, 0)
const byType = (a, b, secs) => {
  const r = {}
  for (const x of b) {
    const prev = a.find((y) => y.pid === x.pid)
    r[x.type] = +((r[x.type] || 0) + ((x.cpu - (prev?.cpu ?? 0)) / secs) * 100).toFixed(2)
  }
  return r
}
// 켠 직후 30초 (보관함 수집·첫 동기화가 도는 구간)
const pS = procs()
await sleep(30000)
const pS1 = procs()
out.first30s = { cpuPercent: +(((cpu(pS1) - cpu(pS)) / 30) * 100).toFixed(2), byType: byType(pS, pS1, 30) }
const p0 = procs()
const m0 = await metrics()
await sleep(IDLE_S * 1000)
const p1 = procs()
const m1 = await metrics()
out.idle = {
  seconds: IDLE_S,
  cpuPercent: +(((cpu(p1) - cpu(p0)) / IDLE_S) * 100).toFixed(2),
  byType: byType(p0, p1, IDLE_S),
  rendererScriptMs: m1.scriptMs - m0.scriptMs,
  rendererTaskMs: m1.taskMs - m0.taskMs,
  longTasks: ((await ev('window.__lt')) || []).length,
  processes: p1.length,
  rssMB: Math.round(p1.reduce((a, b) => a + b.rssMB, 0))
}

// 5) 장시간: 방·탭을 오가며 LOOPS 번 → GC 뒤 힙·리스너·노드가 계속 늘어나는지
const visibility = await ev('document.visibilityState')
const before = await metrics(true)
for (let i = 0; i < LOOPS; i++) {
  await ev(`(() => { const rows = [...document.querySelectorAll('.ch-row .row-main')]; rows[${i} % Math.min(rows.length, 6)]?.click() })()`)
  await sleep(120)
  if (i % 10 === 9) {
    await clickTab('위키')
    await sleep(150)
    await clickTab('메신저')
    await sleep(150)
  }
}
await sleep(2000)
const after = await metrics(true)
out.soak = { visibility, loops: LOOPS, before, after, heapGrowthMB: +(after.jsHeapMB - before.jsHeapMB).toFixed(1), listenerGrowth: after.listeners - before.listeners, nodeGrowth: after.domNodes - before.domNodes }
out.end = { rssMB: Math.round(procs().reduce((a, b) => a + b.rssMB, 0)) }

console.log(JSON.stringify(out, null, 1))
ws.close()
if (process.env.BENCH_KEEP) process.exit(0)
child.kill()
await sleep(500)
try {
  execFileSync('pkill', ['-f', `user-data-dir=${UD}`])
} catch {
  /* 이미 꺼짐 */
}
process.exit(0)
