// 이 앱이 붙는 두레이 회사 도메인 — 한 곳에서만 정한다 (main·renderer 공용).
// 다른 회사가 쓰려면 이 값을 설정 화면에서 정하게 바꾸면 된다 (토큰 발급 주소·위키 링크·실시간 연결이 모두 이 값을 따른다).
export const DOORAY_DOMAIN = 'rakm.dooray.com'
export const DOORAY_API_BASE = 'https://api.dooray.com'
/** 개인 API 토큰 발급 화면 */
export const TOKEN_URL = `https://${DOORAY_DOMAIN}/setting/api/token`
