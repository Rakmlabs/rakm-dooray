// 자동 업데이트를 어디서 받을지 — 이 파일 한 곳에서만 정한다.
//
// 이 저장소(Rakmlabs/rakm-dooray)의 GitHub 릴리스를 그대로 피드로 쓴다 (공개 저장소, 토큰 없음).
// 릴리스마다 RAKM-Dooray-<버전>-arm64.zip, .dmg, latest-mac.yml (+ blockmap) 이 올라가 있어야 한다 (npm run release 가 만든다).
// 받은 zip 은 Squirrel.Mac 이 "지금 앱과 같은 Developer ID(팀) 서명"인지 확인한 뒤에만 바꿔 끼운다.
// 저장소가 비공개면 확인이 실패하고(조용히 기록), 앱은 그대로 동작한다. 토큰이나 비밀 값은 여기에 넣지 않는다.

export type UpdateFeed =
  | { provider: 'github'; owner: string; repo: string }
  /** latest-mac.yml 과 zip 이 있는 폴더 주소 (시험용 로컬 피드) */
  | { provider: 'generic'; url: string }

export const UPDATE_FEED: UpdateFeed | null = { provider: 'github', owner: 'Rakmlabs', repo: 'rakm-dooray' }
