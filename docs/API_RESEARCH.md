# 두레이 API 조사 결과 (2026-11-21)

출처
- 공식 문서 "서비스 API" (helpdesk.dooray.com, 페이지 2939987647631384419). JS로 렌더링되지만
  `https://helpdesk.dooray.com/v2/wapi/shared-tree/9wWo-xwiR66BO5LGshgVTg/pages/{pageId}` 가 본문 마크다운을 JSON으로 준다.
- 공식 도움말 "IMAP 설정"(2908919516990399163), "Thunderbird 설정"(2908919922803667602), "Outlook 설정"(2908919689264044467),
  "발송 메일 제한"(3463032584313338558), "파일 업/다운로드 관련 API 가이드"(3817617091196252578), "메신저 1:1 메시지 전송 API"(2939992834004986234)
- 커뮤니티 구현: dooray-go/dooray-sdk (Go), my13each/DoorayMCPwithMessenger (Kotlin, `CLAUDE.md` 에 실측 메모 있음)

> 이 문서의 내용은 **실제 계정으로 호출해 보지 않았다**. `.env` 가 없어서 실호출 검증을 하지 못했다.
> "공식"은 공식 문서에 적힌 것, "비공식"은 커뮤니티 구현이 실측했다고 적은 것이다.

## 공통
- 기본 주소: 민간 `https://api.dooray.com` / 공공 `https://api.gov-dooray.com` / 공공 업무망 `https://api.gov-dooray.co.kr` / 금융 `https://api.dooray.co.kr` (공식)
- 헤더: `Authorization: dooray-api {토큰}` (공식). 토큰은 "개인설정 > API > 개인 인증 토큰"에서 발급. 메뉴가 없으면 관리자에게 요청.
- 개인 토큰은 발급 계정과 같은 권한·ACL(IP ACL 포함)을 갖는다 (공식).
- 응답: `{ header: {isSuccessful, resultCode, resultMessage}, result, totalCount? }`. 스펙에 없는 필드가 더 올 수 있다.
- 요청 제한: 토큰 버킷. `X-RateLimit-Remaining` 등 헤더 제공, 초과 시 429 (공식). 수치는 비공개·변동.
- 파일 업/다운로드: `api.dooray.com` 이 307 로 `file-api.dooray.com` 을 가리킨다. 자동 리다이렉트는 Authorization 을
  떨어뜨려 401 이 나므로, Location 으로 **인증 헤더와 본문을 붙여 직접 재요청**해야 한다 (공식).

## 메신저
공식 문서에 있는 것
- `GET /messenger/v1/channels` — 내가 속한 대화방 목록. `type`: `direct`(1:1), `private`(일반 채널), `me`, `bot`
- `POST /messenger/v1/channels/direct-send` — 1:1 메시지 전송 (`organizationMemberId`, `text`)
- `POST /messenger/v1/channels?idType=` — 대화방 생성, `members/join`, `members/leave`
- `POST /messenger/v1/channels/{id}/logs` — 전송 (스레드 채널 ID 를 넣으면 스레드에 전송)
- `PUT|DELETE /messenger/v1/channels/{id}/logs/{logId}` — 수정/삭제
- `POST .../logs/{logId}/reply` — 답장
- `POST .../threads/create-and-send` — 스레드 있는 새 메시지 (`text`, `threadText`)
- `POST .../logs/{logId}/threads/create-and-send` — 기존 메시지에 스레드 생성

공식 문서에 **없는** 것 (비공식, 커뮤니티 실측)
- `GET /messenger/v1/channels/{id}/logs?size=N` — 메시지 조회. 최신 N개만(최대 1000), **페이지네이션 없음**. `header.resultMessage` 가 null.
  - 스레드 부모 메시지에 `thread: {channelId, totalCount(문자열), lastUpdatedAt(epoch ms)}` 가 붙는다. 스레드 답글은 부모 방 logs 에 안 나온다.
    스레드 채널 ID 로 다시 `GET .../logs` 하면 스레드 내용을 읽는다.
  - 답장(`type=REPLY`)은 `text` 가 `{"type":0,"text":"..."}` 형태의 JSON 문자열.
  - 파일 메시지(`type=FILE`)에 `file` 객체, 크기 필드는 `fileSize`.
  - `flags=DELETED_ROOT` 는 삭제됐지만 스레드가 남은 메시지.
- `GET /messenger/v1/channels/{id}/files/{fileId}` — 첨부 다운로드 (307 → file-api)
- `POST /messenger/v1/channels/{id}/files` — 첨부 업로드 (307 → file-api, multipart: `attach`, `fileName`, `mimeType`, `token`(임의 UUID))
- `type=me`(나와의 대화)는 채널 목록에 안 나온다.

### (a) 실시간 수신
- 공식 서비스 API 문서에는 **실시간 수신 수단이 없다** (WebSocket·웹훅 모두 메신저용은 없음. "Socket Mode" 도 공식 문서에 없다).
- dooray-sdk 의 Socket Mode: `POST /common/v1/socket-mode/tokens` (`dooray-api {에이전트 토큰}`) → `accessToken, tenantId, organizationMemberId`
  → `wss://{회사도메인}/messenger/v5/ws/{tenantId}/{memberId}` 에 `Bearer accessToken` 으로 접속. 이벤트 `type=channelLog`, `action=create|update`.
  README 상 "에이전트 설정에서 발급한 에이전트 토큰" 전용이다. 개인 토큰으로 토큰 발급이 되는지, 된다면 내 모든 대화가 오는지는 **알 수 없다**.
- 결론: 앱은 Socket Mode 를 **선택적으로 시도**하고(설정에 회사 도메인 입력 시), 실패하면 **폴링**으로 동작한다.
  폴링은 비공식 `GET .../logs` 에 의존한다. 열려 있는 대화방·스레드만 짧은 주기(기본 4초)로, 채널 목록은 30초마다 조회한다.
  채널 목록의 `updatedAt` 이 새 메시지마다 바뀌는지는 확인되지 않았다 → 안 읽은 표시는 근사치다.
- 두레이 서버의 "읽음" 상태를 읽거나 쓰는 API 는 없다. 안 읽음 표시는 이 앱이 로컬에서 계산한다.

### (c) 1:1 / 그룹 대화
- 공식: `GET /channels` 는 "속한 대화방 목록"이며 `direct`(1:1)와 `private`(그룹)를 모두 돌려준다. 개인 토큰은 계정과 같은 권한이다.
- 메시지 본문 조회는 비공식 `GET .../logs` 뿐이다. 커뮤니티 구현이 개인 토큰으로 동작을 확인했다고 적었다. 우리는 실호출로 확인하지 못했다.
- 위험: 비공식 엔드포인트라 예고 없이 바뀌거나 막힐 수 있다. 오래된 메시지(최신 1000개 이전)는 읽을 수 없다.

## 위키 (전부 공식)
- `GET /wiki/v1/wikis?page&size`, `GET /wiki/v1/wikis/{wikiId}/pages?parentPageId=` (한 단계씩), `GET /wiki/v1/wikis/{wikiId}/pages/{pageId}`, `GET /wiki/v1/pages/{pageId}`
- `POST /wiki/v1/wikis/{wikiId}/pages` (`parentPageId, subject, body{mimeType:text/x-markdown, content}, attachFileIds, referrers`)
- `PUT .../pages/{pageId}` (전체 수정), `PUT .../title`, `PUT .../content`, `PUT .../referrers`, `POST .../move`, `DELETE .../pages/{pageId}`
  - 비공식 메모: `PUT .../pages/{id}` 에 `referrers` 를 빼면 참조자가 지워진다 → 본문만 바꿀 땐 `PUT .../content` 를 쓴다.
- 댓글: `GET|POST .../comments`, `GET|PUT|DELETE .../comments/{commentId}` (POST 는 201 을 돌려준다 — 비공식 메모)
- 파일: `POST .../pages/{pageId}/files` (multipart `type` 을 `file` 보다 먼저), `GET .../pages/{pageId}/files/{fileId}`, `DELETE ...`, `GET /wiki/v1/wikis/{wikiId}/attachFiles/{attachFileId}`
- 본문 형식은 마크다운.

## 메일
### (b) IMAP/SMTP
- REST 메일 API 는 없다 (`/common/v1/streams` 가 최근 2주 수신 메일 "피드"를 주지만 본문 조회·발송 기능은 아니다).
- IMAP/SMTP 는 **제공된다** (공식 도움말):
  - 수신 `imap.dooray.com:993` SSL/TLS, 발신 `smtp.dooray.com:465` SSL/TLS, 평문 비밀번호 인증, 아이디는 메일 주소
  - 비밀번호는 두레이 "설정 > 메일 > IMAP" 화면의 값. SSO 를 쓰는 회사는 거기서 발급한 **별도 비밀번호 키**를 써야 한다.
- 제약 (공식):
  - **메일 포함 Business 플랜 이상**에서만 제공. 공공기관 테넌트는 미지원.
  - 관리자가 "Admin > 조직 서비스 관리 > 공통 설정 > 서비스 사용 및 제한 > 메일 > IMAP" 을 허용해야 한다.
  - 승인 메일 기능과 동시 사용 불가.
  - IMAP 폴더에서 조회 가능한 메일은 최대 5,000건.
  - 발송 제한: 외부 메일 1인당 1일 100통(Free/Basic), 메일 크기 40MB 등.
- 플랜/관리자 설정은 계정마다 다르므로 소유자가 두레이 설정 화면에서 IMAP 메뉴가 보이는지 확인해야 한다.

## 드라이브
- 메신저·위키 첨부는 각자 전용 파일 API 가 있어 드라이브 API 가 필요 없다. 메일 첨부는 SMTP 로 직접 보낸다.
- 그래서 이 앱은 드라이브 API 를 쓰지 않는다.
