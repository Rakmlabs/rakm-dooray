# RAKM 두레이 (dooray-client)

RAKM 전용 NHN Dooray 데스크톱 클라이언트 (메신저, 위키). Electron + React + TypeScript.
연결 대상은 코드에 고정돼 있다: 회사 도메인 `rakm.dooray.com`, API `https://api.dooray.com` (`src/main/settings.ts`).
메일(IMAP/SMTP) 코드는 남아 있지만 Free 플랜이라 IMAP 을 쓸 수 없어 화면에서는 숨겼다 (`src/renderer/src/App.tsx` 의 TABS).
로고·아이콘은 회사 사이트 저장소(rakm-site)의 R 마크 원본 `docs/brand/favicon-source-r.png` 로 만든다: 파란 판(#2f6bff, 1024 캔버스 안 824 판, 모서리 반경 185, 옅은 그림자) 위에 흰 R. `build/icon.png`·`icon.icns`·`icon.ico`(앱·Dock 아이콘), `src/renderer/src/assets/rakm-app-tile.png`(사이드바).
서버 없이 각자 자기 컴퓨터에 토큰을 넣어 쓴다. 네트워크 호출은 전부 main 프로세스에서 하고, 화면(renderer)은 IPC 로만 받는다.

API 조사 결과와 근거는 [docs/API_RESEARCH.md](docs/API_RESEARCH.md) 에 있다.

## 실행

Node 22.12 이상 (개발은 Node 24 에서 했다).

```sh
npm install
npx install-electron --no   # npm 11 이 설치 스크립트를 막아 Electron 바이너리가 없을 때만. 첫 실행 때 자동으로 받기도 한다.
npm run dev                 # 개발 모드
npm run build && npm start  # 빌드 결과로 실행
npm run dist                # 서명·공증 없이 arm64 dmg/zip 만 만들기 (확인용)
npm run release             # 배포용: 검사 → 빌드 → 서명 → 공증 → staple → 검증 (아래 '배포')
npm test                    # 단위 테스트
npm run typecheck
```

처음 켜면 설정 화면이 뜬다. 넣을 것은 토큰 하나다.
- **두레이 개인 API 토큰**: <https://rakm.dooray.com/setting/api/token> 에서 "토큰 생성" → 복사해 붙여 넣기.
  설정 화면의 "여기서 발급" 버튼이 이 주소를 기본 브라우저로 연다. (메뉴가 없으면 관리자에게 요청)
  한글·공백이 섞이면 저장하지 않는다 (앞뒤 공백은 자동으로 자른다).
- 토큰·비밀번호는 Electron `safeStorage`(macOS 키체인 / Windows DPAPI / 리눅스 키링)로 암호화해 `userData/secrets.json` 에 둔다.

### 실제 계정으로 읽기 점검

`.env.example` 을 `.env` 로 복사해 채운 뒤:

```sh
npm run probe              # 읽기 호출만 해서 형태·개수만 출력 (내용·토큰은 출력 안 함)
npm run probe -- --socket  # Socket Mode 토큰 발급이 개인 토큰으로 되는지도 확인
npm run probe -- --fields  # 채널·메시지(logs)·멤버 응답의 필드 이름만 전부 출력 (값은 출력 안 함). 읽음 관련일 수 있는 이름엔 ★
```

`.env` 는 개발 모드에서 설정이 비어 있을 때만 읽는다. 패키징된 앱은 `.env` 를 읽지 않는다.

### 토큰 없이 화면 보기 (모의 서버)

```sh
node scripts/mock-dooray.mjs                         # 127.0.0.1:8787
DOORAY_MOCK_BASE=http://127.0.0.1:8787 npm run dev   # 메신저·위키가 가짜 데이터로 뜬다
```

## 쓰는 법 — 프로젝트와 스레드

"한 대화방에 여러 프로젝트 얘기가 섞인다" 문제를 두 가지로 푼다.

1. **대화방을 프로젝트로 묶기**: 왼쪽 목록의 태그 버튼으로 프로젝트를 만들고, 대화방 옆 ⋯ 메뉴로 넣는다.
   이 묶음은 각자 컴퓨터에만 저장된다.
2. **주제는 스레드로**: 대화방 위의 "새 주제" 로 `[프로젝트] 제목` 메시지와 스레드를 만든다.
   이 접두어는 메시지 본문에 들어가므로 상대방 앱에서도 같은 프로젝트로 묶여 보인다.
   - 대화방의 "스레드" 탭: 그 방의 스레드를 프로젝트 태그별로 걸러 본다.
   - 프로젝트 "모아보기": 그 프로젝트 대화방들의 스레드를 모으고, "모든 대화방에서 찾기" 로 다른 방의 `[프로젝트]` 스레드까지 모은다.
   - 기존 메시지에서 바로 스레드를 시작할 수도 있다 (메시지 위에 마우스 → 스레드 아이콘).

## 편의 기능 한눈에

- **⌘K** 대화방·사람·위키 페이지 빠른 이동 (초성 검색 `ㅇㅍ` 가능), **⌘⇧F** 전체 검색(메시지·위키), **⌘F** 방 안 검색, **⌘[ / ⌘]** 이전·다음 위치.
- 대화방 목록: 즐겨찾기, 프로젝트 폴더(접기), 끌어 놓아 순서·폴더 바꾸기, 숨기기, 방별 알림 끄기.
- 받은 메시지는 이 컴퓨터(`userData/local/archive.db`, node:sqlite)에 쌓여 두레이가 주는 최신 1000개 이전도 보이고 검색된다. 앱이 받아 둔 시점 이후만 쌓인다.
- 안 읽음 수·Dock 배지·데스크톱 알림·"여기까지 읽음"은 이 컴퓨터에서 계산한 값이다(두레이에 읽음 API 가 없다).
  상대가 내 메시지를 읽었는지(읽음 확인)는 두레이 공개 API 가 주지 않아 표시할 수 없다 (공식 문서·응답 필드·공개 SDK 확인, 2026-11-22).
  - 앱이 켜져 있으면(창이 뒤에 있거나 닫혀 있어도) 15초마다 대화방을 돌아가며 확인한다. 창이 앞에 있고 그 방을 보고 있으면 바로 읽음 처리.
  - 앱을 켜면 모든 방을 한 번 훑어 꺼져 있던 동안 온 메시지를 안 읽음으로 센다. 한 번도 연 적 없는 방도 센다.
  - 앱을 처음 설치해 켠 시각 이전의 메시지는 읽은 것으로 시작한다. 그 뒤에 새로 생긴 방(처음 온 1:1 등)의 메시지는 안 읽음으로 센다.
  - 다른 컴퓨터·휴대폰·웹에서 읽어도 이 앱의 안 읽음은 줄지 않는다. 스레드 답글은 안 읽음 수에 들어가지 않는다.
- 채팅: 이니셜 아바타(두레이 멤버 API 에 사진이 없다)와 프로필 카드, 연속 메시지 묶음, 코드 강조, 답장 인용(이 앱에서 보낸 답장만), @멘션 자동완성, 이모지, 방별 임시 저장, 빈 입력창에서 ↑ 로 마지막 메시지 수정, 북마크, 위키로 보내기, 링크 미리보기(설정에서 끄기).
- 파일: 이미지·동영상·오디오·PDF·docx·xlsx·코드 등을 앱 안에서 보기, 끌어 놓기·붙여넣기 업로드, 방별 파일 모아보기, 캐시 상한(설정).
- 위키: 블록 편집(클릭해 바로 고치기, `/` 메뉴, 손잡이로 옮기기), 자동 저장, 저장 전 서버 버전 확인, 첫 저장 전 원문 백업과 되돌리기, 원문 보기.
- 설정: 테마(시스템/라이트/다크), 글자 크기, 메뉴 막대 상주, 로그인 시 자동 실행(설치한 앱만).

## 배포 (macOS, Apple Silicon)

자동 업데이트와 CI 는 없다. 이 Mac 에서 `npm run release` 한 줄로 만들고, GitHub 릴리스에 올린다.
설정 화면에 현재 버전과 릴리스 페이지 링크가 있어, 새 버전은 거기서 내려받아 덮어쓴다.

`npm run release` (`scripts/release.mjs`) 가 하는 일:
1. 타입 검사, 단위 테스트, `electron-vite build`
2. `electron-builder --mac --arm64`: Developer ID 로 서명(hardened runtime, `build/entitlements.mac.plist`), `.app` 공증·staple, dmg·zip 생성
3. dmg 도 공증하고 staple
4. `codesign --verify --deep --strict`, `spctl -a -vv`, `stapler validate` 결과와 파일 크기 출력

산출물은 `release/RAKM-Dooray-<버전>-arm64.dmg`, `.zip` (git 에는 안 올라간다).

앱 번들 이름은 `RAKM Dooray.app` (영문)이고 화면에 보이는 이름만 `RAKM 두레이` 다 (`CFBundleDisplayName`, `app.setName`).
`productName` 이나 `CFBundleName` 에 한글을 넣으면 Electron 이 helper 앱을 찾지 못해 실행하자마자 죽는다(SIGTRAP) — 바꾸지 말 것.

**자격**은 저장소 밖 `~/.config/sinawi/release.env` (권한 600) 에서 실행할 때만 읽는다. 이미 설정된 환경 변수가 먼저다.
항목 이름: `APPLE_API_KEY`(App Store Connect API 키 ID), `APPLE_API_ISSUER`, `APPLE_API_KEY_PATH`(`.p8` 경로), `APPLE_SIGNING_IDENTITY`(서명 인증서 이름).
값은 저장소·로그에 넣지 않는다. 파일이 없으면 공증을 건너뛰고 그렇다고 알린다 — 그 빌드는 처음 열 때
"시스템 설정 > 개인정보 보호 및 보안 > 그래도 열기" 가 필요하다.

**버전 올려 배포하는 순서**

```sh
npm version 0.2.0 --no-git-tag-version          # package.json 버전 (설정 화면 표시도 이 값)
git commit -am "chore: v0.2.0"
npm run release                                 # 마지막 줄에 '공증: 완료' 와 spctl 'Notarized Developer ID' 확인
git tag v0.2.0 && git push origin main v0.2.0
gh release create v0.2.0 release/RAKM-Dooray-0.2.0-arm64.dmg release/RAKM-Dooray-0.2.0-arm64.zip \
  --repo Rakmlabs/rakm-dooray --title "RAKM 두레이 0.2.0" --notes "바뀐 점 …"
```

받는 사람: dmg 를 열어 앱을 "응용 프로그램" 으로 끌어 놓고 실행 → 설정에서 자기 두레이 개인 API 토큰 입력.
데이터 폴더는 개발·배포 빌드 모두 `~/Library/Application Support/dooray-client` 라 새 버전을 덮어써도 토큰과 받아 둔 메시지가 남는다.

## 구조

```
src/main/            Electron main (네트워크·비밀 값은 여기서만)
  dooray/http.ts     인증 헤더, 429 재시도, 307 → file-api 리다이렉트를 인증 헤더 유지한 채 직접 따라감(두레이 도메인만)
  dooray/messenger.ts, wiki.ts, realtime.ts (Socket Mode 시도 → 실패 시 폴링)
  mail/service.ts    IMAP(imapflow) 읽기, SMTP(nodemailer) 발송
  settings.ts        설정 + safeStorage 비밀 값
src/preload/         허용된 IPC 채널만 통과
src/shared/          IPC 계약과 타입
src/renderer/        React 화면 (메신저 / 메일 / 위키 / 설정)
scripts/             probe-readonly.mjs (읽기 점검), mock-dooray.mjs (모의 서버)
```

## 알려진 제약 (두레이 쪽)

- 메신저 메시지 조회 `GET .../logs` 는 공식 문서에 없는 엔드포인트다. 최신 1000개까지만, 페이지네이션 없음.
- 공식 실시간 수신 수단이 없다. Socket Mode 는 에이전트 토큰용으로 보이며 개인 토큰으로 되는지 미확인 → 기본은 폴링.
  열린 방은 창이 앞에 있으면 3초, 뒤에 있으면 10초, 숨기면 멈춤(코드 고정, `src/renderer/src/lib/hooks.ts`). 대화방 목록 30초, 뒤에서 안 읽음 확인 15초.
  요청 제한은 1초마다 토큰이 차는 토큰 버킷(수치 비공개)이라, 남은 토큰(`X-RateLimit-Remaining`)이 2 미만이면 1초 쉬고 보내고 429 면 물러났다 다시 시도한다.
- 두레이 서버의 "읽음" 상태는 API 로 읽거나 쓸 수 없다(상대의 읽음 확인도 없다). 안 읽음 표시는 앱이 받아 둔 메시지로 계산한다.
- "나와의 대화"(type=me)는 채널 목록 API 에 나오지 않는다.
- 위키 페이지 단건 조회는 공식 `GET /wiki/v1/pages/{pageId}` 를 쓴다. `/wiki/v1/wikis/{wikiId}/pages/{pageId}` 는 실사용에서 "존재하지 않는 페이지" 로 실패했다.
  19자리 ID 가 JSON 숫자로 오면 JS 정밀도를 넘으므로 응답은 큰 정수를 문자열로 바꿔 읽는다 (`parseJsonSafe`).
- 메일은 IMAP/SMTP 뿐이며 Business 플랜 이상, 관리자 허용 필요, IMAP 폴더당 최대 5,000통.
