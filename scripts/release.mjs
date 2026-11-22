// 릴리스 빌드: 검사 → 빌드 → 서명(Developer ID) → 공증(App Store Connect API 키) → staple → 검증.
//   npm run release
//
// 자격은 저장소 밖 ~/.config/sinawi/release.env (권한 600) 에서 실행 시점에만 읽는다. 이미 설정된 환경 변수가 우선.
//   APPLE_API_KEY          API 키 ID
//   APPLE_API_ISSUER       Issuer ID
//   APPLE_API_KEY_PATH     .p8 파일 경로
//   APPLE_SIGNING_IDENTITY 서명 인증서 이름 (예: "Developer ID Application: 이름 (팀ID)")
// 값은 출력·로그에 남기지 않는다. 파일이나 항목이 없으면 공증만 건너뛰고 서명된 dmg/zip 을 만든다.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ENV_FILE, loadCredentials, quiet, signingEnv, writeUpdateInfo } from './lib/mac-build.mjs'

const OUT = 'release'
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
// 시험용 빌드 표시(모의 서버·로컬 피드)가 실제 배포본에 들어가지 않게 지운다 (src/main/buildFlags.ts)
delete process.env.RAKM_TEST_BUILD

// 명령과 인자를 보여주되, 비밀 값이 들어가는 인자는 가린다
function run(cmd, args, { env, secretArgs = [] } = {}) {
  const shown = args.map((a) => (secretArgs.includes(a) ? '<숨김>' : a))
  console.log(`\n$ ${cmd} ${shown.join(' ')}`)
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: env ?? process.env })
  if (r.status !== 0) {
    console.error(`실패: ${cmd} (종료 코드 ${r.status})`)
    process.exit(r.status ?? 1)
  }
}

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  console.error('이 스크립트는 Apple Silicon Mac 에서만 돈다.')
  process.exit(1)
}

const cfg = loadCredentials()
console.log(existsSync(ENV_FILE) ? `자격 파일: ${ENV_FILE} (값은 표시하지 않음)` : `자격 파일 없음: ${ENV_FILE}`)

// 서명 인증서: 키체인에 있는지만 확인 (이름은 출력하지 않음)
let env
try {
  env = signingEnv(cfg.APPLE_SIGNING_IDENTITY)
} catch (e) {
  console.error(e.message)
  process.exit(1)
}

const canNotarize = !!(cfg.APPLE_API_KEY && cfg.APPLE_API_ISSUER && cfg.APPLE_API_KEY_PATH && existsSync(cfg.APPLE_API_KEY_PATH))
console.log(canNotarize ? '공증: API 키 사용' : '공증 건너뜀: 자격 파일·항목 또는 .p8 파일이 없음')

run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'])
run('npx', ['vitest', 'run'])
run('node', ['scripts/build-native.mjs'])
run('npx', ['electron-vite', 'build'])

// electron-builder 이름 규칙으로 공증 자격을 넣는다 (electron-builder 의 APPLE_API_KEY 는 .p8 경로, APPLE_API_KEY_ID 는 키 ID)
if (canNotarize) {
  env.APPLE_API_KEY = cfg.APPLE_API_KEY_PATH
  env.APPLE_API_KEY_ID = cfg.APPLE_API_KEY
  env.APPLE_API_ISSUER = cfg.APPLE_API_ISSUER
}

rmSync(OUT, { recursive: true, force: true })
// 공증이 되면 electron-builder 가 .app 을 공증·staple 한 뒤 dmg/zip 을 만든다
run('npx', ['electron-builder', '--mac', '--arm64', '--publish', 'never', ...(canNotarize ? [] : ['-c.mac.notarize=false'])], { env })

const files = readdirSync(OUT)
const dmg = files.find((f) => f.endsWith('.dmg'))
const zip = files.find((f) => f.endsWith('.zip'))
if (!zip) {
  console.error('자동 업데이트용 zip 을 찾지 못했습니다.')
  process.exit(1)
}
const appDir = join(OUT, 'mac-arm64', `${pkg.build.productName}.app`)
if (!dmg || !existsSync(appDir)) {
  console.error('dmg 또는 .app 을 찾지 못했습니다.')
  process.exit(1)
}

if (canNotarize) {
  // dmg 자체도 공증하고 staple 한다 (내려받은 dmg 를 열 때 바로 통과하도록)
  const keyArgs = ['--key', cfg.APPLE_API_KEY_PATH, '--key-id', cfg.APPLE_API_KEY, '--issuer', cfg.APPLE_API_ISSUER]
  run('xcrun', ['notarytool', 'submit', join(OUT, dmg), ...keyArgs, '--wait'], { secretArgs: keyArgs.filter((_, i) => i % 2 === 1) })
  run('xcrun', ['stapler', 'staple', join(OUT, dmg)])
}

// 자동 업데이트가 받을 zip 안의 앱도 서명·공증(staple)됐는지 풀어서 확인한다
const unz = mkdtempSync(join(tmpdir(), 'rakm-zip-'))
run('ditto', ['-x', '-k', join(OUT, zip), unz])
const zipApp = join(unz, `${pkg.build.productName}.app`)

// 자동 업데이트 정보: 최종 zip·dmg 로 계산한다 (위에서 dmg 를 staple 했으므로 그 뒤에)
await writeUpdateInfo(OUT, pkg.version, zip, dmg)

console.log('\n=== 검증 ===')
let verifyFailed = false
for (const [name, cmd, args] of [
  ['codesign (app)', 'codesign', ['--verify', '--deep', '--strict', appDir]],
  ['spctl (app)', 'spctl', ['-a', '-vv', appDir]],
  ['stapler (app)', 'xcrun', ['stapler', 'validate', appDir]],
  ['codesign (dmg)', 'codesign', ['--verify', join(OUT, dmg)]],
  ['spctl (dmg)', 'spctl', ['-a', '-vv', '-t', 'open', '--context', 'context:primary-signature', join(OUT, dmg)]],
  ['stapler (dmg)', 'xcrun', ['stapler', 'validate', join(OUT, dmg)]],
  ['codesign (zip 안 app)', 'codesign', ['--verify', '--deep', '--strict', zipApp]],
  ['spctl (zip 안 app)', 'spctl', ['-a', '-vv', zipApp]],
  ['stapler (zip 안 app)', 'xcrun', ['stapler', 'validate', zipApp]],
  // 알림 권한 모듈: 없거나 서명이 안 맞으면 앱이 권한 상태를 못 읽는다
  ['codesign (zip 안 notify.node)', 'codesign', ['--verify', '--strict', join(zipApp, 'Contents', 'Resources', 'native', 'notify.node')]]
]) {
  const r = quiet(cmd, args)
  if (!r.ok && (canNotarize || !/spctl|stapler/.test(name))) verifyFailed = true
  console.log(`- ${name}: ${r.ok ? '통과' : '실패'}\n  ${r.out.split('\n').join('\n  ')}`)
}
const mb = (f) => `${(statSync(join(OUT, f)).size / 1024 / 1024).toFixed(1)} MB`
rmSync(unz, { recursive: true, force: true })
console.log(`\n산출물 (릴리스에 셋 다 올린다. zip·latest-mac.yml 은 자동 업데이트용):\n- ${join(OUT, dmg)} (${mb(dmg)})\n- ${join(OUT, zip)} (${mb(zip)})\n- ${join(OUT, 'latest-mac.yml')}`)
if (verifyFailed) {
  console.error('\n검증 실패: 위에서 "실패" 항목을 확인하세요. 이 산출물은 올리지 말 것.')
  process.exit(1)
}
console.log(canNotarize ? '공증: 완료 (app·dmg staple)' : '공증: 안 됨 — 처음 열 때 시스템 설정 > 개인정보 보호 및 보안 > "그래도 열기" 필요')
