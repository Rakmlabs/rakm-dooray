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
  폴링은 비공식 `GET .../logs` 에 의존한다. 열려 있는 대화방·스레드만 짧은 주기(창이 앞에 있으면 3초)로, 채널 목록은 30초마다 조회한다.
  채널 목록의 `updatedAt` 이 새 메시지마다 바뀌는지는 확인되지 않았다 → 안 읽은 표시는 근사치다.
- 두레이 서버의 "읽음" 상태를 읽거나 쓰는 API 는 없다. 안 읽음 표시는 이 앱이 로컬에서 계산한다.

### 읽음 확인 재확인 (2026-11-22)
- 공식 문서 메신저 절(`GET /messenger/v1/channels` 등 9개 API): 응답 필드는 id, title, organization, type, users.participants,
  me, capacity, status, createdAt, updatedAt, displayed, role, archivedAt 뿐. 읽음 수·읽은 위치·안 읽음 수 필드 없음. 읽음 처리 API 도 없음.
- 공식 `GET /common/v1/streams`(활동 피드)에는 `read` 필터·필드가 있으나 대상이 project, mail, schedule, event, post, page,
  pageComment, fileEvent 뿐이고 메신저는 없다.
- dooray-go/dooray-sdk 의 채널 모델(openapi/model/messenger/channel.go)과 Socket Mode 이벤트, my13each/DoorayMCPwithMessenger 의
  `Channel`·`ChannelMessage` 타입(id, seq, type, sender, sentAt, text, flags, attachments, file)에도 읽음 관련 필드가 없다. `seq` 는 메시지 순번.
- 실제 응답에 문서에 없는 필드가 오는지는 `npm run probe -- --fields` 로 필드 이름만 뽑아 확인할 수 있다 (실계정 미확인).
- 결론: 상대가 내 메시지를 읽었는지는 공개 API 로 알 수 없다. 두레이 웹의 비공개 API 를 세션 쿠키로 부르는 방식은 쓰지 않는다.
- 대안(v0.1.2 에 구현): 앱끼리 위키 페이지에 "대화방별 마지막으로 읽은 메시지 seq" 를 써서 주고받는다.
  - 운반체 비교: 메신저 채널(알림·소음 → 금지), 드라이브 덮어쓰기(새 버전 생성, 307 두 단계, 개인 드라이브는 상대가 못 봄) → 위키 `PUT .../content` 가 가장 조용하다(알림 없음, 버전만 쌓임).
  - 위치: 비개인 위키 중 (wikiId, pageId) 가 가장 작은 곳의 홈 아래 표식 있는 루트. 동시에 처음 켜 둘 다 만들면 2초 뒤 다시 훑어 작은 ID 쪽으로 모인다(남은 하나는 버려진 채로 남을 수 있다).
  - 믿는 조건: 본문의 표식·memberId 가 맞고 페이지 `creator` 가 그 사람일 때만.
  - 요청량: 쓰기 사람당 최대 30초 1회(바뀔 때만), 읽기 창이 앞이면 10초마다 상대 수만큼 GET, 상대 찾기 5분(못 찾으면 30초)마다 목록 1회.

### 메시지 본문 형식·스레드 삭제·리액션 (2026-11-22, 두레이 웹 메신저 번들 확인)
- 확인 방법: 이 Mac 에 설치된 공식 "Dooray Messenger" 앱(웹 메신저를 띄우는 Electron 껍데기)의 Service Worker 캐시에 남은
  두레이 웹 메신저 JS 번들을 문자열로 읽었다. 실계정 API 호출은 하지 않았다.
- **본문 형식**: 메시지 `text` 는 글자 그대로 저장되고, 보여 줄 때 토큰으로 나눈다. 메신저 토큰 종류는
  `EMOJI, TEXT, CODE_BLOCK, INLINE_CODE, MENTION, URL, MARKDOWN_LINK` 뿐이다.
  - 코드 블록: `/(```)(.*)?\n([\s\S]*?)(```)/` — 여는 ``` 뒤 언어(없으면 nohighlight), 줄바꿈 필수, 닫는 ``` 필수. 복사 버튼·문법 강조 있음.
  - 웹 입력창 단축키: ⌘⇧C 인라인 코드(`` `선택` ``), ⌘⌥C 코드 블록(```` ```\n선택\n``` ````). 이 앱도 같은 키를 쓴다.
  - 링크는 `[글](http… )` 만, 이모지는 `:이름:`, 멘션은 `[@이름](dooray://…)`.
  - **굵게·기울임·취소선(`**` `_` `~~`)은 메신저가 그리지 않는다** → 글자 그대로 보인다. 그래서 이 앱은 서식 버튼을 코드·링크만 둔다.
    (받은 메시지의 `**` 는 이 앱에서는 굵게 보인다 — 봇 메시지 등 호환용)
- **스레드 삭제**: 스레드(스레드 채널)를 지우는 API 는 공개 API 에도, 웹 내부 API 에도 없다. 웹 번들의 스레드 호출은
  만들기(`/thread-channels`)·목록·상태·업무 연결/해제(`/thread/{id}/tasks/{taskId}`)뿐이다.
  메시지 삭제는 `DELETE /channels/{id}/logs/{logId}`(공개 API 와 같은 형태)이고, 스레드 채널 ID 를 넣으면 스레드 답글이 지워진다(모의 서버로만 확인).
  첫 메시지를 지우면 답글이 남은 동안 `flags=DELETED_ROOT` 로 남는다. 남의 메시지 삭제 권한은 공개 문서에 없다(보낸 사람만으로 본다).
  → 앱의 "스레드 삭제" = 내 답글 + (내 것이면) 첫 메시지를 지우고, 남는 게 있으면 이 컴퓨터에서 목록 숨김.
- **메시지 수정·삭제 시간 제한 (v0.1.5 실계정에서 삭제 실패로 발견)**: 웹 번들의 `messengerGeneralSetting = { canDeleteMessage, messageDeletablePeriodMinutes(기본 5) }`
  (`GET {WAS}/settings/messenger.general`, 웹 내부 API)와 `canDeleteLog = 메뉴 권한 && isLogInEditableTime(log)` — 작성 후 N분이 지나면
  삭제·수정 메뉴가 사라진다("나와의 대화"는 예외). 서버 오류 코드 `CHANNEL_LOG_EXPIRED_DELETE_TIME_ERROR` = "작성 후, {{minutes}}분 이내에만 삭제할 수 있습니다."
  (`..._MODIFY_TIME_ERROR` 는 수정). 공개 API 에는 이 설정을 읽는 방법이 없다.
  - v0.1.5 에서 50분쯤 지난 내 스레드(첫 메시지+답글)를 지우려다 2개 모두 실패한 것이 이 제한으로 보인다. **실계정 응답 원문은 아직 못 봤다**
    (토큰이 키체인에 암호화돼 있어 개발 환경에서 같은 계정으로 호출하지 않았다).
  - v0.1.6 부터 쓰기 요청(POST/PUT/DELETE) 실패는 `userData/logs/api.log` 에 `메서드 경로 → 상태 code=결과코드 사유` 로 남고(토큰·본문 없음),
    삭제 실패 토스트에 서버 사유를 그대로 보여 준다. 다시 시도하면 원인을 확정할 수 있다.
- **이모지 리액션**: 웹 메신저에는 있다(👍❤️✔ 등, `EmojiReactionList`). 그러나 공개 API 문서에 메신저 리액션 API 가 없고,
  웹이 쓰는 내부 API 는 세션 쿠키 기반이라(이 앱 원칙상 쓰지 않음) 구현하지 않았다. 받은 메시지의 리액션도 `logs` 응답에 없다(커뮤니티 타입 기준).

### 요청 제한 (공식)
- 토큰 버킷, 1초마다 `X-RateLimit-Replenish-Rate` 만큼 보충, 최대 `X-RateLimit-Burst-Capacity`. 수치는 고지 없이 바뀔 수 있어 헤더를 보라고 한다.
- 앱: 열린 방 3초(창이 뒤면 10초, 숨기면 멈춤) + 뒤에서 안 읽음 확인(15초마다 3~4방) + 채널 목록 30초 → 평소 초당 1회 안쪽.
  남은 토큰이 2 미만이면 1초 쉬고 보내며, 429 는 Retry-After 를 따라 3번까지 다시 시도한다.

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
