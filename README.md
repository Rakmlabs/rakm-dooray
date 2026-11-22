# RAKM 두레이 (dooray-client)

> **두레이(Dooray!) 비공식 데스크톱 클라이언트입니다. NHN 및 NHN Dooray 와 무관하며, NHN 이 만들거나 보증하지 않습니다.**
> 두레이의 공개 API 와 각자 발급한 개인 API 토큰으로 동작합니다. 두레이 로고·상표는 쓰지 않습니다 (아이콘은 RAKM 마크).

RAKM 에서 쓰려고 만든 NHN Dooray 데스크톱 클라이언트 (메신저, 위키). Electron + React + TypeScript. macOS (Apple Silicon) 용.
연결 대상은 코드에 고정돼 있다: 회사 도메인 `rakm.dooray.com`, API `https://api.dooray.com` (`src/shared/company.ts` 한 곳).
메일(IMAP/SMTP) 코드는 남아 있지만 Free 플랜이라 IMAP 을 쓸 수 없어 화면에서는 숨겼다 (`src/renderer/src/App.tsx` 의 TABS).
로고·아이콘은 RAKM 의 R 마크로 만든다: 파란 판(#2f6bff, 1024 캔버스 안 824 판, 모서리 반경 185, 옅은 그림자) 위에 흰 R. `build/icon.png`·`icon.icns`·`icon.ico`(앱·Dock 아이콘), `src/renderer/src/assets/rakm-app-tile.png`(사이드바).
서버 없이 각자 자기 컴퓨터에 토큰을 넣어 쓴다. 네트워크 호출은 전부 main 프로세스에서 하고, 화면(renderer)은 IPC 로만 받는다.

## 설치 (사용자)

1. [Releases](https://github.com/Rakmlabs/rakm-dooray/releases/latest) 에서 `RAKM-Dooray-<버전>-arm64.dmg` 를 내려받는다 (Apple Silicon Mac, macOS 12 이상).
2. dmg 를 열고 `RAKM Dooray` 를 **응용 프로그램(Applications)** 폴더로 끌어 놓는다. Developer ID 서명·Apple 공증을 받아 바로 열린다.
3. 처음 켜면 설정 화면이 뜬다. **각자 자기 두레이 개인 API 토큰**을 발급해 붙여 넣는다:
   두레이 웹 → 오른쪽 위 프로필 → **개인 설정 > API > 개인 인증 토큰** 에서 "토큰 생성" (설정 화면의 "여기서 발급" 버튼이 이 화면을 연다).
   토큰은 이 Mac 의 키체인으로 암호화해 이 컴퓨터에만 저장한다. 다른 사람과 공유하지 말 것.
4. 처음 켜면 macOS 가 **알림 허용**을 묻는다. "허용"을 눌러야 새 메시지 알림이 뜬다 (나중에는 시스템 설정 > 알림 > RAKM 두레이).
5. 0.1.3 부터는 새 버전이 나오면 앱이 알아서 받아 "새 버전 준비됨 · 재시작" 띠를 띄운다 (0.1.2 이하에서 올 때는 0.1.3 을 한 번 직접 설치).

라이선스: 정하지 않음.

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

두 사용자로 읽음 확인을 보려면 같은 모의 서버에 앱을 두 개 띄운다. 두 번째는 `DOORAY_MOCK_USER=co`(김공동)로, user-data-dir 를 따로 준다.
(`npm run build` 후 `npx electron . --user-data-dir=/tmp/b` 처럼)

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
  - 앱이 켜져 있으면(창이 뒤에 있거나 닫혀 있어도) 15초마다 대화방을 돌아가며 확인한다. 창이 앞에 있고 그 방을 보고 있으면 바로 읽음 처리.
  - 앱을 켜면 모든 방을 한 번 훑어 꺼져 있던 동안 온 메시지를 안 읽음으로 센다. 한 번도 연 적 없는 방도 센다.
  - 앱을 처음 설치해 켠 시각 이전의 메시지는 읽은 것으로 시작한다. 그 뒤에 새로 생긴 방(처음 온 1:1 등)의 메시지는 안 읽음으로 센다.
  - 다른 컴퓨터·휴대폰·웹에서 읽어도 이 앱의 안 읽음은 줄지 않는다. 스레드 답글은 안 읽음 수에 들어가지 않는다.
- **읽음 확인**(설정 > 읽음 확인, 기본 켜짐): 내 메시지 옆에 아직 안 읽은 사람 수(노란 `1`)가 떴다가 상대가 읽으면 사라진다.
  두레이에 읽음 API 가 없어서, 두 사람의 앱이 두레이 위키 페이지로 "어디까지 읽었는지"를 주고받는다(서버 없음).
  - 저장 위치: 두 사람이 모두 볼 수 있는 위키 중 ID 가 가장 작은 비개인 위키의 홈 아래 `RAKM 두레이 · 읽음 확인 (앱 전용)` 페이지,
    그 아래 사람마다 `읽음 위치 · 이름 (memberId)` 페이지 하나. 대화방 ID 와 마지막 메시지 번호만 쓴다(메시지 내용 없음).
    두 앱이 같은 규칙으로 찾고, 없으면 만든다. 자동으로 못 정하면 설정에서 위키를 고른다. 표식(`<!-- rakm-dooray:read-receipts:... -->`)이 없는 페이지는 절대 고치지 않는다.
  - 읽음 기준: 창이 앞에 있고 그 방(스레드 포함)을 보고 있으면 마지막 메시지까지 읽은 것.
  - 쓰기: 읽은 위치가 바뀌었을 때만, 사람당 30초에 한 번까지 묶어서. 읽기: 창이 앞이면 10초, 보이기만 하면 60초, 숨기면 멈춤. 실패는 조용히 물러났다 다시.
  - 한계: 상대가 두레이 모바일·웹에서 읽은 것은 알 수 없다(그 뒤에 상대가 답을 보냈으면 읽은 것으로 본다). 상대가 이 기능을 켜기 전 메시지·기록이 없는 상대에게는 숫자를 띄우지 않는다.
    3명 이상 방은 기록이 있는 사람만 센다. 위키 페이지 버전 기록이 쌓인다.
- 채팅: 이니셜 아바타(두레이 멤버 API 에 사진이 없다)와 프로필 카드, 연속 메시지 묶음, 코드 강조, 답장 인용(이 앱에서 보낸 답장만), @멘션 자동완성, 이모지, 방별 임시 저장, 빈 입력창에서 ↑ 로 마지막 메시지 수정, 북마크, 위키로 보내기, 링크 미리보기(설정에서 끄기).
- 파일: 이미지·동영상·오디오·PDF·docx·xlsx·코드 등을 앱 안에서 보기, 끌어 놓기·붙여넣기 업로드, 방별 파일 모아보기, 캐시 상한(설정).
- 위키: 블록 편집(클릭해 바로 고치기, `/` 메뉴, 손잡이로 옮기기), 자동 저장, 저장 전 서버 버전 확인, 첫 저장 전 원문 백업과 되돌리기, 원문 보기.
- 설정: 테마(시스템/라이트/다크), 글자 크기, 메뉴 막대 상주, 로그인 시 자동 실행(설치한 앱만).

## 배포 (macOS, Apple Silicon)

CI 는 없다. 이 Mac 에서 `npm run release` 한 줄로 만들고, GitHub 릴리스에 올린다.

`npm run release` (`scripts/release.mjs`) 가 하는 일:
1. 타입 검사, 단위 테스트, `electron-vite build` (시험 빌드 표시 `RAKM_TEST_BUILD` 는 지우고 빌드한다)
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
