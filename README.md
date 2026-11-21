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
npm run dist                # 설치 파일 만들기 (mac: dmg, win: nsis, linux: AppImage — 각 OS 에서 실행)
npm test                    # 단위 테스트
npm run typecheck
```

처음 켜면 설정 화면이 뜬다. 넣을 것은 토큰 하나다.
- **두레이 개인 API 토큰**: 두레이 웹 "개인설정 > API > 개인 인증 토큰" 에서 발급 (메뉴가 없으면 관리자에게 요청).
  한글·공백이 섞이면 저장하지 않는다 (앞뒤 공백은 자동으로 자른다).
- 토큰·비밀번호는 Electron `safeStorage`(macOS 키체인 / Windows DPAPI / 리눅스 키링)로 암호화해 `userData/secrets.json` 에 둔다.

### 실제 계정으로 읽기 점검

`.env.example` 을 `.env` 로 복사해 채운 뒤:

```sh
npm run probe              # 읽기 호출만 해서 형태·개수만 출력 (내용·토큰은 출력 안 함)
npm run probe -- --socket  # Socket Mode 토큰 발급이 개인 토큰으로 되는지도 확인
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
- 공식 실시간 수신 수단이 없다. Socket Mode 는 에이전트 토큰용으로 보이며 개인 토큰으로 되는지 미확인 → 기본은 폴링(열린 방 4초, 목록 30초).
- 두레이 서버의 "읽음" 상태는 API 로 읽거나 쓸 수 없다. 안 읽음 표시는 앱이 채널 `updatedAt` 으로 추정한다.
- "나와의 대화"(type=me)는 채널 목록 API 에 나오지 않는다.
- 위키 페이지 단건 조회는 공식 `GET /wiki/v1/pages/{pageId}` 를 쓴다. `/wiki/v1/wikis/{wikiId}/pages/{pageId}` 는 실사용에서 "존재하지 않는 페이지" 로 실패했다.
  19자리 ID 가 JSON 숫자로 오면 JS 정밀도를 넘으므로 응답은 큰 정수를 문자열로 바꿔 읽는다 (`parseJsonSafe`).
- 메일은 IMAP/SMTP 뿐이며 Business 플랜 이상, 관리자 허용 필요, IMAP 폴더당 최대 5,000통.
