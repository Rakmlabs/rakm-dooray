# 개발 문서 — RAKM 두레이

사용자용 안내는 [README](../README.md) 에 있다. 여기는 빌드·모의 서버·배포·구조.

- Electron + React + TypeScript (electron-vite), macOS Apple Silicon.
- 연결 대상은 코드에 고정돼 있다: 회사 도메인 `rakm.dooray.com`, API `https://api.dooray.com` (`src/shared/company.ts` 한 곳).
  다른 회사가 쓰려면 이 값을 설정 화면에서 받도록 바꿔야 한다 (반나절~하루 정도 일).
- 메일(IMAP/SMTP) 코드는 남아 있지만 Free 플랜이라 IMAP 을 쓸 수 없어 화면에서는 숨겼다 (`src/renderer/src/App.tsx` 의 TABS).
- 서버 없이 각자 자기 컴퓨터에 토큰을 넣어 쓴다. 네트워크 호출은 전부 main 프로세스에서 하고, 화면(renderer)은 IPC 로만 받는다.
- 로고·아이콘은 RAKM 의 R 마크: 파란 판(#2f6bff, 1024 캔버스 안 824 판, 모서리 반경 185, 옅은 그림자) 위에 흰 R.
  `build/icon.png`·`icon.icns`·`icon.ico`(앱·Dock 아이콘), `src/renderer/src/assets/rakm-app-tile.png`(사이드바). 두레이 로고·상표는 쓰지 않는다.
- README 스크린샷(`docs/images/`)은 모의 서버 화면이다 (가상 인물·가상 데이터).
- API 조사 결과와 근거: [API_RESEARCH.md](API_RESEARCH.md)

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

두 사용자로 읽음 확인을 보려면 같은 모의 서버에 앱을 두 개 띄운다. 두 번째는 `DOORAY_MOCK_USER=co`(김공동)로, user-data-dir 를 따로 준다.
(`npm run build` 후 `npx electron . --user-data-dir=/tmp/b` 처럼)

## 배포 (macOS, Apple Silicon)

CI 는 없다. 이 Mac 에서 `npm run release` 한 줄로 만들고, GitHub 릴리스에 올린다.

`npm run release` (`scripts/release.mjs`) 가 하는 일:
1. 타입 검사, 단위 테스트, 알림 권한 모듈 빌드(`scripts/build-native.mjs`), `electron-vite build` (시험 빌드 표시 `RAKM_TEST_BUILD` 는 지우고 빌드한다)
2. `electron-builder --mac --arm64`: Developer ID 로 서명(hardened runtime, `build/entitlements.mac.plist`), `.app` 공증·staple, dmg·zip 생성
3. dmg 도 공증하고 staple
4. **자동 업데이트 정보 `latest-mac.yml`** 을 최종 zip·dmg 로 계산해 만든다 (sha512·크기)
5. `.app`, dmg, **zip 을 풀어 그 안의 앱**까지 `codesign --verify --deep --strict`, `spctl -a -vv`, `stapler validate` 하고, 하나라도 실패하면 멈춘다

산출물은 `release/` 의 세 파일이고 셋 다 릴리스에 올린다 (git 에는 안 올라간다):
- `RAKM-Dooray-<버전>-arm64.dmg` — 처음 설치용
- `RAKM-Dooray-<버전>-arm64.zip` — 자동 업데이트가 받는 것 (서명·공증·staple 된 앱)
- `latest-mac.yml` — 자동 업데이트가 "새 버전이 있는지" 읽는 것

앱 번들 이름은 `RAKM Dooray.app` (영문)이고 화면에 보이는 이름만 `RAKM 두레이` 다 (`CFBundleDisplayName`, `app.setName`).
`productName` 이나 `CFBundleName` 에 한글을 넣으면 Electron 이 helper 앱을 찾지 못해 실행하자마자 죽는다(SIGTRAP) — 바꾸지 말 것.

**자격**은 저장소 밖 `~/.config/sinawi/release.env` (권한 600) 에서 실행할 때만 읽는다. 이미 설정된 환경 변수가 먼저다.
항목 이름: `APPLE_API_KEY`(App Store Connect API 키 ID), `APPLE_API_ISSUER`, `APPLE_API_KEY_PATH`(`.p8` 경로), `APPLE_SIGNING_IDENTITY`(서명 인증서 이름).
값은 저장소·로그에 넣지 않는다. 파일이 없으면 공증을 건너뛰고 그렇다고 알린다 — 그 빌드는 처음 열 때
"시스템 설정 > 개인정보 보호 및 보안 > 그래도 열기" 가 필요하고, 자동 업데이트로 배포하면 안 된다.

**버전 올려 배포하는 순서**

```sh
npm version 0.2.0 --no-git-tag-version          # package.json 버전 (앱 버전·업데이트 비교 기준)
git commit -am "chore: v0.2.0"
npm run release                                 # '공증: 완료', zip 안 앱의 spctl 'Notarized Developer ID' 확인
git tag v0.2.0 && git push origin main v0.2.0
gh release create v0.2.0 release/RAKM-Dooray-0.2.0-arm64.dmg release/RAKM-Dooray-0.2.0-arm64.zip release/latest-mac.yml \
  release/*.blockmap --repo Rakmlabs/rakm-dooray --title "RAKM 두레이 0.2.0" --notes "바뀐 점 …" --latest
```

받는 사람: 처음 한 번은 dmg 를 열어 앱을 "응용 프로그램" 으로 끌어 놓고 실행 → 설정에서 자기 두레이 개인 API 토큰 입력.
데이터 폴더는 개발·배포 빌드 모두 `~/Library/Application Support/dooray-client` 라 새 버전이 들어와도 토큰과 받아 둔 메시지가 남는다.

### 자동 업데이트

- `electron-updater` (맥은 Squirrel.Mac). 앱을 켜고 15초 뒤, 그 뒤 4시간마다 `latest-mac.yml` 을 확인하고 새 버전 zip 을 뒤에서 받는다.
- 다 받으면 화면 위에 "새 버전 x.y.z 준비됨 · 재시작" 띠가 뜨고, 설정 > 업데이트에도 같은 버튼이 있다.
  재시작 전에 보류 중인 위키 자동 저장과 읽음 위치 쓰기를 끝낸다. 재시작하지 않으면 다음에 앱을 끌 때 설치된다.
- 받은 zip 은 Squirrel.Mac 이 **지금 앱과 같은 Developer ID(팀) 서명인지** 확인한 뒤에만 바꿔 끼운다 (끄지 않는다). 피드에는 서명·공증된 zip 만 올린다.
- 오류는 화면에 띄우지 않고 `userData/logs/updates.log` 에 남긴다. 설정 > 업데이트에 마지막 확인 시각·결과와 "지금 확인" 버튼이 있다.
- 개발 실행(`npm run dev`)에서는 확인하지 않는다.
- **피드 위치는 `src/main/updates/feed.ts` 의 `UPDATE_FEED` 한 곳**에서 정한다: 이 저장소의 GitHub 릴리스 (electron-updater `github` provider, 토큰 없음 — 공개 저장소라야 한다).
  릴리스에 zip·dmg·`latest-mac.yml`·blockmap 이 있어야 하고, 최신(latest)으로 표시된 릴리스를 본다. 앱에는 토큰·비밀 값을 넣지 않는다.

### 시험 빌드 (알림 권한·자동 업데이트 확인용)

`--variant N` 을 주면 번들 ID·이름·userData 에 N 이 붙는다 (`kr.co.rakm.dooray.testN`). macOS 는 번들 ID 마다 권한 창을 한 번만 띄우므로,
"처음 권한을 묻는" 흐름을 다시 시험할 때는 새 variant 로 만든다. 업그레이드 경로 시험은 같은 variant 로 이전 버전(태그의 코드)과 새 버전을 만들어
이전 버전을 설치·실행한 뒤 로컬 피드로 새 버전을 받게 한다.

알림 권한과 자동 업데이트는 **서명된 패키징 앱**에서만 실제처럼 동작한다 (개발 실행은 서명 안 된 `Electron.app` 이라 macOS 가 알림을 막는다).
실제 앱과 섞이지 않는 시험 빌드를 만든다:

```sh
node scripts/test-build.mjs --version 0.0.1 --out /tmp/tb/v1 --mock http://127.0.0.1:8790 --feed http://127.0.0.1:8791/feed
node scripts/test-build.mjs --version 0.0.2 --out /tmp/tb/v2 --mock http://127.0.0.1:8790 --feed http://127.0.0.1:8791/feed
```

- 번들 ID `kr.co.rakm.dooray.test`, 이름 `RAKM 두레이 시험`, 데이터 `~/Library/Application Support/dooray-client-test`, 키체인 항목도 따로 →
  소유자 앱의 토큰·데이터·알림 권한을 건드리지 않는다. 모의 서버·피드 주소(로컬만)를 빌드에 박는다 (업데이트로 다시 켜질 때 실행 인자가 사라지므로).
- 서명은 하고 공증은 안 한다. **`~/Applications` 처럼 정식 앱 폴더에 두고 `open` 으로 연다** — 임시 폴더(`/tmp`)에 둔 앱은 macOS 가 알림 권한 요청을 거절한다.
- 업데이트 흐름: `node scripts/mock-dooray.mjs` (PORT=8790) 와 아무 정적 서버로 `/feed/` 에 v2 의 `latest-mac.yml`·zip 을 두고, v1 을 켜면
  확인 → 받기 → "준비됨" 띠 → 재시작 → 0.0.2 로 다시 켜진다.

### 알림 권한 모듈 (`native/notify.mm`)

Electron 에는 알림 권한을 조회·요청하는 API 가 없고, `Notification` 의 `show` 이벤트는 권한이 없어도 온다.
그래서 UNUserNotificationCenter 를 직접 부르는 작은 Node-API 모듈을 둔다 (`settings()` 실제 상태, `request()` 권한 요청).

- `npm run build`·`dev`·`dist`·`release`·`test-build` 가 먼저 `scripts/build-native.mjs` 로 `build/native/notify.node` 를 만든다 (clang, Xcode 필요).
  패키징 때 `Contents/Resources/native/notify.node` 로 들어가고 앱과 같은 Developer ID 로 서명된다 (release 가 서명을 검증한다).
- 앱을 켤 때마다 상태를 읽고, 허용이 아니면 바로 요청한다 (이미 고른 경우 macOS 는 창을 띄우지 않는다). 그 뒤 주기적으로·창이 앞에 올 때 다시 읽는다.
- macOS 26 은 한 번도 답하지 않은 앱도 `denied` 로 알려 준다 → "미결정"과 "거부"를 구분하지 않고 같은 안내(시스템 설정 열기)를 띄운다.
- 권한이 없으면 macOS 는 Dock 배지도 그리지 않는다 (`app.setBadgeCount` 는 값만 넣는다. `lsappinfo` 의 StatusLabel 에는 보여도 Dock 에는 안 보인다).
  권한이 생기면 배지를 다시 넣는다. 실제로 보이는지는 Dock 접근성 값으로 확인한다:
  `osascript -e 'tell application "System Events" to tell process "Dock" to get value of attribute "AXStatusLabel" of UI element "RAKM Dooray" of list 1'`
- `com.apple.ncprefs` 에는 사용자가 답한 앱만 있다. 항목이 없다고 "권한을 요청한 적 없음"은 아니다.

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
- 두레이 서버의 "읽음" 상태는 API 로 읽거나 쓸 수 없다. 안 읽음 표시는 앱이 받아 둔 메시지로 계산하고, 읽음 확인은 앱끼리 위키 페이지로 주고받는다(모바일·웹 읽음은 반영 안 됨).
- "나와의 대화"(type=me)는 채널 목록 API 에 나오지 않는다.
- 위키 페이지 단건 조회는 공식 `GET /wiki/v1/pages/{pageId}` 를 쓴다. `/wiki/v1/wikis/{wikiId}/pages/{pageId}` 는 실사용에서 "존재하지 않는 페이지" 로 실패했다.
  19자리 ID 가 JSON 숫자로 오면 JS 정밀도를 넘으므로 응답은 큰 정수를 문자열로 바꿔 읽는다 (`parseJsonSafe`).
- 메일은 IMAP/SMTP 뿐이며 Business 플랜 이상, 관리자 허용 필요, IMAP 폴더당 최대 5,000통.
