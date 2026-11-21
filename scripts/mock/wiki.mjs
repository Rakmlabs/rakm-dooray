// 모의 서버 — 위키 블록 편집기 영역 경로. 이 영역 작업자만 고친다.
// 처리했으면 true 를 돌려준다. ctx: { req, res, url, p, send, ok, body, state }
// state 에는 mock-dooray.mjs 의 공용 데이터(members, channels, logs, wikis, wikiPages, comments, ME, log, iso)가 들어 있다.
export async function handle(_ctx) {
  return false
}
