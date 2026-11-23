// 성능 측정: 모의 서버로 켠 앱(--remote-debugging-port=9333)에 붙어 '오래된 기록방'을 열고 숫자를 잰다.
//   node scripts/bench/bench-ui.mjs [불러올 메시지 수=3000] [포트=9333]
// 먼저: node scripts/bench/seed-archive.mjs <userData> 30000 → 모의 서버 → 앱 (DOORAY_MOCK_BASE, --user-data-dir=<userData>)
const TARGET = Number(process.argv[2] || 3000)
const PORT = Number(process.argv[3] || 9333)

const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
const ws = new WebSocket(list.find((x) => x.type === 'page').webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
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
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval 실패')
  return r.result?.result?.value
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await send('Performance.enable')
const metrics = async () => {
  const r = await send('Performance.getMetrics')
  const m = Object.fromEntries(r.result.metrics.map((x) => [x.name, x.value]))
  return { jsHeapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), domNodes: m.Nodes }
}
const firstId = () => ev(`document.querySelector('.messages [data-msg-id]')?.dataset.msgId ?? ''`)
const msgCount = () => ev(`document.querySelectorAll('.messages [data-msg-id]').length`)
/** 보이는(불러온) 메시지 수: 가상화로 DOM 에 없는 것까지 (앱이 data-total 로 알려 주면 그것, 아니면 DOM 수) */
const loadedCount = () => ev(`(() => { const el = document.querySelector('.messages'); return Number(el?.dataset.total || 0) || document.querySelectorAll('.messages [data-msg-id]').length })()`)

// 깨끗하게 시작: 다른 방에 갔다가
await ev(`[...document.querySelectorAll('.ch-row')].find(e => e.textContent.includes('창업팀'))?.querySelector('.row-main')?.click()`)
await sleep(1500)
await ev(`window.__lt = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration) }).observe({ type: 'longtask', buffered: false })`)

const out = {}
async function typeAndMeasure() {
  await ev(`(() => { const t = document.querySelector('.composer-input'); t.focus();
    window.__lat = [];
    if (!window.__latHooked2) { window.__latHooked2 = true; document.addEventListener('keydown', (e) => { const s = e.timeStamp; requestAnimationFrame(() => setTimeout(() => window.__lat.push(performance.now() - s), 0)) }, true) } })()`)
  await ev(`window.__lt = []`)
  const word = '성능 측정용 입력입니다 abcdefghijklmnopqrstuvwxyz 0123'
  for (const ch of word.slice(0, 40)) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch, unmodifiedText: ch })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
    await sleep(60)
  }
  await sleep(500)
  const lat = (await ev('window.__lat')).sort((a, b) => a - b)
  const pct = (p) => +lat[Math.min(lat.length - 1, Math.floor(lat.length * p))].toFixed(1)
  const longTasks = (await ev('window.__lt')).length
  await ev(`(() => { const t = document.querySelector('.composer-input'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  return { n: lat.length, p50: pct(0.5), p95: pct(0.95), max: +lat[lat.length - 1].toFixed(1), longTasks }
}
// 1) 방 열기
const t0 = Date.now()
await ev(`[...document.querySelectorAll('.ch-row')].find(e => e.textContent.includes('오래된 기록방')).querySelector('.row-main').click()`)
let last = -1
let stableSince = 0
for (;;) {
  const n = await msgCount()
  if (n > 0 && n === last) {
    if (!stableSince) stableSince = Date.now()
    if (Date.now() - stableSince > 400) break
  } else stableSince = 0
  last = n
  await sleep(30)
  if (Date.now() - t0 > 20000) break
}
out.openMs = stableSince - t0
await sleep(1500)
out.afterOpen = { domMessages: await msgCount(), loaded: await loadedCount(), ...(await metrics()) }

// 2) 위로 올리며 TARGET 개까지 불러오기 (load-more 버튼 또는 맨 위로 스크롤). 한 번 올릴 때 새 줄이 그려지기까지의 시간
const t1 = Date.now()
let rounds = 0
const perRound = []
while ((await loadedCount()) < TARGET && rounds < 200 && Date.now() - t1 < 180000) {
  const before = `${await loadedCount()}/${await firstId()}`
  await ev(`(() => { const b = document.querySelector('.load-more'); const s = document.querySelector('.messages'); s.scrollTop = 0; s.dispatchEvent(new Event('scroll')); if (b && b.tagName === 'BUTTON' && !b.classList.contains('auto')) b.click() })()`)
  const s0 = Date.now()
  while (`${await loadedCount()}/${await firstId()}` === before && Date.now() - s0 < 8000) await sleep(20)
  perRound.push(Date.now() - s0)
  rounds++
}
perRound.sort((a, b) => a - b)
out.loadMore = { ms: Date.now() - t1, rounds, loaded: await loadedCount(), roundP50: perRound[Math.floor(perRound.length / 2)], roundMax: perRound[perRound.length - 1] }
await sleep(2000)
out.afterLoad = { domMessages: await msgCount(), loaded: await loadedCount(), ...(await metrics()) }

// 2-1) 위쪽(불러온 것이 많은 상태)에서 입력 지연
out.typingScrolledUp = await typeAndMeasure()

// 3) 그 상태로 맨 아래로 가서 입력 지연 측정 (40글자)
// 사람이 하듯 '최근 메시지로' 버튼 (없으면 맨 아래로 스크롤)
await ev(`(() => { const b = document.querySelector('.jump-latest'); if (b) b.click(); const s = document.querySelector('.messages'); s.scrollTop = s.scrollHeight; s.dispatchEvent(new Event('scroll')) })()`)
await sleep(500)
await ev(`(() => { const s = document.querySelector('.messages'); s.scrollTop = s.scrollHeight; s.dispatchEvent(new Event('scroll')) })()`)
await sleep(1500)
out.typing = await typeAndMeasure()

// 4) 가만히 20초 (폴링 3초) 동안 긴 작업
await ev(`window.__lt = []`)
await sleep(20000)
const lt = await ev('window.__lt')
out.idle20s = { longTasks: lt.length, totalMs: Math.round(lt.reduce((a, b) => a + b, 0)), maxMs: Math.round(Math.max(0, ...lt)) }
out.end = await metrics()

console.log(JSON.stringify(out, null, 1))
ws.close()
