// 시험용 패키징 빌드: 알림 권한·자동 업데이트처럼 "서명된 패키징 앱"에서만 확인되는 것을 실제 앱과 섞이지 않게 시험한다.
//   node scripts/test-build.mjs --version 0.0.1 --out <폴더> [--mock http://127.0.0.1:8790] [--feed http://127.0.0.1:8791/]
//
// 실제 앱과 다른 점 (소유자의 /Applications 앱·토큰·데이터·알림 권한을 건드리지 않게):
//   - 번들 ID kr.co.rakm.dooray.test, 이름 "RAKM Dooray Test" / 표시 이름 "RAKM 두레이 시험"
//   - userData: ~/Library/Application Support/dooray-client-test (키체인 항목도 "RAKM 두레이 시험 Safe Storage")
//   - 모의 두레이 서버(--mock)와 모의 업데이트 피드(--feed)를 빌드에 박는다 (업데이트로 다시 켜질 때 인자가 사라지므로)
// Developer ID 로 서명하지만 공증은 하지 않는다 (이 Mac 에서 만든 파일이라 격리 표시가 없어 그대로 열린다).
// 결과: <out>/RAKM Dooray Test.app (mac-arm64 안), <out>/*.zip, <out>/latest-mac.yml
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { loadCredentials, signingEnv, writeUpdateInfo } from './lib/mac-build.mjs'

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const version = arg('version')
const out = arg('out') && resolve(arg('out'))
if (!version || !out) {
  console.error('사용법: node scripts/test-build.mjs --version 0.0.1 --out <폴더> [--mock URL] [--feed URL]')
  process.exit(1)
}

const NAME = 'RAKM Dooray Test'
const flags = {
  name: 'RAKM 두레이 시험',
  userData: 'dooray-client-test',
  mockBase: arg('mock'),
  updateFeed: arg('feed')
}

function run(cmd, args, env = process.env) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { stdio: 'inherit', env })
  if (r.status !== 0) {
    console.error(`실패: ${cmd} (종료 코드 ${r.status})`)
    process.exit(r.status ?? 1)
  }
}

let env
try {
  env = signingEnv(loadCredentials().APPLE_SIGNING_IDENTITY)
} catch (e) {
  console.error(e.message)
  process.exit(1)
}

run('npx', ['electron-vite', 'build'], { ...process.env, RAKM_TEST_BUILD: JSON.stringify(flags) })
rmSync(out, { recursive: true, force: true })
run(
  'npx',
  [
    'electron-builder',
    '--mac',
    'zip',
    '--arm64',
    '--publish',
    'never',
    `-c.directories.output=${out}`,
    '-c.appId=kr.co.rakm.dooray.test',
    `-c.productName=${NAME}`,
    `-c.extraMetadata.version=${version}`,
    '-c.mac.extendInfo.CFBundleDisplayName=RAKM 두레이 시험',
    '-c.mac.notarize=false',
    `-c.artifactName=RAKM-Dooray-Test-\${version}-\${arch}.\${ext}`
  ],
  env
)
// 다음 실제 빌드가 시험 표시 없이 다시 만들어지도록 out 을 지운다
rmSync('out', { recursive: true, force: true })

const zip = readdirSync(out).find((f) => f.endsWith('.zip'))
const app = join(out, 'mac-arm64', `${NAME}.app`)
if (!zip || !existsSync(app)) {
  console.error('zip 또는 .app 을 찾지 못했습니다.')
  process.exit(1)
}
await writeUpdateInfo(out, version, zip)
console.log(`\n시험 빌드 ${version}:\n- ${app}\n- ${join(out, zip)}\n- ${join(out, 'latest-mac.yml')}`)
