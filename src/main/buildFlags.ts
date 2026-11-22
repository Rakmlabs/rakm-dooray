// 시험용 패키징 빌드 표시 (scripts/test-build.mjs 가 빌드할 때만 넣는다. npm run release 는 이 값을 지우고 빌드한다).
// 시험 빌드는 이름·userData·키체인 항목·번들 ID 가 실제 앱과 달라서, 소유자 앱의 토큰·데이터·알림 권한을 건드리지 않는다.
// 자동 업데이트로 다시 켜질 때는 실행 인자·환경 변수가 사라지므로, 시험에 필요한 값은 여기 빌드 시점에 박아 둔다.
// 비밀 값은 넣지 않는다 (모의 서버 주소와 로컬 피드 주소뿐).

export interface TestBuild {
  /** 앱 이름 (키체인 "<이름> Safe Storage" 항목도 이 이름을 쓴다) */
  name: string
  /** appData 아래 userData 폴더 이름 */
  userData: string
  /** 패키징 앱에서도 쓸 모의 두레이 서버 (http://127.0.0.1:포트) */
  mockBase: string | null
  /** 모의 업데이트 피드 (http://127.0.0.1:포트/경로), 또는 'real' = feed.ts 의 실제 피드 */
  updateFeed: string | null
}

declare const __RAKM_TEST_BUILD__: string | undefined

const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost):\d+(\/[\w./-]*)?$/

function parse(): TestBuild | null {
  const raw = typeof __RAKM_TEST_BUILD__ === 'string' ? __RAKM_TEST_BUILD__ : ''
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<TestBuild>
    if (!v.name || !v.userData) return null
    return {
      name: String(v.name),
      userData: String(v.userData),
      // 로컬 주소만 허용 (시험 빌드가 밖으로 새지 않게)
      mockBase: v.mockBase && LOCAL.test(v.mockBase) ? v.mockBase : null,
      updateFeed: v.updateFeed === 'real' || (v.updateFeed && LOCAL.test(v.updateFeed)) ? v.updateFeed : null
    }
  } catch {
    return null
  }
}

export const TEST_BUILD: TestBuild | null = parse()
