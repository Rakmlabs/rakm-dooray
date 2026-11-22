// 모의 서버 — 앱 전역 편의: ⌘K, 폴더, 안 읽음·알림, 로컬 보관·검색, 창·트레이 영역 경로. 이 영역 작업자만 고친다.
// 처리했으면 true 를 돌려준다. ctx: { req, res, url, p, send, ok, body, state }
// state 에는 mock-dooray.mjs 의 공용 데이터(members, channels, logs, wikis, wikiPages, comments, ME, log, iso)가 들어 있다.
//
// 이 영역이 더하는 것
// - 대화방 여러 개(프로젝트 폴더 시연), 사람 몇 명, 1:1 방 두 개
// - 'c-history': 메시지 1500개 → 서버는 최신 1000개만 준다 (로컬 보관 시연)
// - 새 메시지 도착: SHELL_MOCK_ARRIVE_MS(기본 45초)마다 다른 사람이 메시지를 보낸다 (안 읽음·알림 시연)
//   0 이면 끈다. 시험용으로 POST /mock/shell/arrive {channelId, text, sender} 로 바로 도착시킬 수 있다.
// - POST /mock/shell/newdm {sender, text}: 새 1:1 방이 생기며 첫 메시지가 온다
// - POST /mock/shell/flood {channelId, n}: n개를 더 보내 오래된 것을 서버의 1000개 창 밖으로 밀어낸다
// - POST /messenger/v1/channels/direct-send (1:1 첫 메시지; 방이 없으면 만든다)
// - GET logs 는 실제처럼 최대 1000개까지만

let ready = false
const ARRIVE_MS = Number(process.env.SHELL_MOCK_ARRIVE_MS ?? 45_000)

function init(state) {
  if (ready) return
  ready = true
  const { members, channels, logs, log, iso } = state
  const ME = state.BASE_ME ?? state.ME
  Object.assign(members, { 'm-design': '이디자인', 'm-ops': '최운영', 'm-sales': '정영업' })
  channels.push(
    { id: 'c-beta', title: '베타 결제 모듈', type: 'private', members: [ME, 'm-dev'], updatedAt: iso(1_800_000) },
    { id: 'c-design', title: '디자인 리뷰', type: 'private', members: [ME, 'm-design', 'm-co'], updatedAt: iso(10_800_000) },
    { id: 'c-ops', title: '운영 알림', type: 'private', members: [ME, 'm-ops'], updatedAt: iso(86_400_000) },
    { id: 'c-random', title: '잡담', type: 'private', members: [ME, 'm-co', 'm-dev', 'm-design'], updatedAt: iso(14_400_000) },
    { id: 'c-history', title: '오래된 기록방', type: 'private', members: [ME, 'm-co'], updatedAt: iso(30_000) },
    { id: 'c-dm2', title: '', type: 'direct', members: [ME, 'm-dev'], updatedAt: iso(5_400_000) }
  )
  logs['c-beta'] = [
    log('c-beta', 'm-dev', 'PG사 테스트 키 받았습니다', 3_600_000),
    log('c-beta', ME, '좋아요. 정산 주기는 D+2 로 갑시다', 3_000_000),
    log('c-beta', 'm-dev', '[베타] 환불 API 설계', 1_800_000, { thread: { channelId: 't-refund', totalCount: '3', lastUpdatedAt: Date.now() - 900_000 } })
  ]
  logs['t-refund'] = [
    log('t-refund', 'm-dev', '부분 환불도 지원해야 할까요?', 1_700_000),
    log('t-refund', ME, '1차는 전체 환불만', 1_600_000),
    log('t-refund', 'm-dev', '넵 정리해서 위키에 올릴게요', 900_000)
  ]
  logs['c-design'] = [
    log('c-design', 'm-design', '로그인 화면 시안 올렸어요', 11_000_000),
    log('c-design', 'm-co', '버튼 색을 브랜드 블루로 맞춰 주세요', 10_800_000)
  ]
  logs['c-ops'] = [log('c-ops', 'm-ops', '서버 점검 공지: 토요일 02:00~04:00', 86_400_000)]
  logs['c-random'] = [
    log('c-random', 'm-design', '오늘 점심 김치찌개 어때요', 14_500_000),
    log('c-random', 'm-co', '좋아요', 14_400_000)
  ]
  logs['c-dm2'] = [log('c-dm2', 'm-dev', '배포 스크립트 리뷰 부탁드려요', 5_400_000)]
  // 1500개 기록: 30일 전부터 25분 간격
  const hist = []
  for (let i = 0; i < 1500; i++) {
    const who = i % 3 === 0 ? ME : 'm-co'
    const n = i + 1
    const text = n % 100 === 0 ? `[기록] ${n}번째 메시지 — 분기 회고 메모` : `기록 메시지 ${n}`
    hist.push(log('c-history', who, text, (1500 - i) * 25 * 60_000 + 30_000))
  }
  logs['c-history'] = hist

  if (ARRIVE_MS > 0) {
    const plan = [
      ['c-alpha', 'm-co', '알파 QA 체크리스트 확인 부탁해요'],
      ['c-dm', 'm-co', '내일 10시 미팅 괜찮으세요?'],
      ['c-beta', 'm-dev', '결제 실패 재현했습니다. 로그 첨부할게요'],
      ['c-design', 'm-design', '수정 시안 v2 올렸어요']
    ]
    let k = 0
    setInterval(() => {
      const [cid, who, text] = plan[k++ % plan.length]
      arrive(state, cid, who, text)
    }, ARRIVE_MS).unref()
  }
}

function arrive(state, channelId, sender, text) {
  const l = state.log(channelId, sender, text, 0)
  l.sentAt = new Date().toISOString() // 공용 log() 는 서버 시작 시각 기준이라 지금 시각으로 고친다
  ;(state.logs[channelId] ??= []).push(l)
  const c = state.channels.find((x) => x.id === channelId)
  if (c) c.updatedAt = new Date().toISOString()
  return l
}

export async function handle(ctx) {
  const { req, url, p, send, ok, body, state } = ctx
  init(state)
  let m
  if ((m = p.match(/^\/messenger\/v1\/channels\/([^/]+)\/logs$/)) && req.method === 'GET') {
    const size = Math.min(1000, Number(url.searchParams.get('size') || 50))
    return send(200, { header: { isSuccessful: true, resultCode: 0, resultMessage: null }, result: (state.logs[m[1]] ?? []).slice(-size).reverse() }), true
  }
  if ((m = p.match(/^\/messenger\/v1\/channels\/([^/]+)\/logs$/)) && req.method === 'POST') {
    const b = await body(req)
    const l = arrive(state, m[1], state.ME, b.text ?? '')
    return send(200, ok({ id: l.id, channelId: m[1] })), true
  }
  if (p === '/messenger/v1/channels/direct-send' && req.method === 'POST') {
    const b = await body(req)
    let c = state.channels.find((x) => x.type === 'direct' && x.members.includes(b.organizationMemberId) && x.members.length === 2)
    if (!c) {
      c = { id: `c-dm-${b.organizationMemberId}`, title: '', type: 'direct', members: [state.ME, b.organizationMemberId], updatedAt: new Date().toISOString() }
      state.channels.push(c)
    }
    arrive(state, c.id, state.ME, b.text ?? '')
    return send(200, ok(null)), true
  }
  if (p === '/mock/shell/arrive' && req.method === 'POST') {
    const b = await body(req)
    const l = arrive(state, b.channelId ?? 'c-alpha', b.sender ?? 'm-co', b.text ?? '새 메시지 도착')
    return send(200, ok({ id: l.id })), true
  }
  // 다른 사람이 나에게 처음으로 1:1 을 보내 새 방이 생기는 상황 (새 방의 안 읽음 확인용)
  if (p === '/mock/shell/newdm' && req.method === 'POST') {
    const b = await body(req)
    const who = b.sender ?? 'm-sales'
    const c = { id: `c-dm-new-${who}`, title: '', type: 'direct', members: [state.ME, who], updatedAt: new Date().toISOString() }
    if (!state.channels.some((x) => x.id === c.id)) state.channels.push(c)
    const l = arrive(state, c.id, who, b.text ?? '처음 보내는 1:1 메시지')
    return send(200, ok({ channelId: c.id, id: l.id })), true
  }
  if (p === '/mock/shell/flood' && req.method === 'POST') {
    const b = await body(req)
    const cid = b.channelId ?? 'c-history'
    for (let i = 0; i < (b.n ?? 300); i++) arrive(state, cid, i % 2 ? state.ME : 'm-co', `밀어내기 메시지 ${i + 1}`)
    return send(200, ok({ total: state.logs[cid].length })), true
  }
  return false
}
