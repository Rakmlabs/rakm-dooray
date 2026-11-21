// 모의 서버 — 앱 전역 편의: ⌘K, 폴더, 안 읽음·알림, 로컬 보관·검색, 창·트레이 영역 경로. 이 영역 작업자만 고친다.
// 처리했으면 true 를 돌려준다. ctx: { req, res, url, p, send, ok, body, state }
// state 에는 mock-dooray.mjs 의 공용 데이터(members, channels, logs, wikis, wikiPages, comments, ME, log, iso)가 들어 있다.
export async function handle(_ctx) {
  return false
}
