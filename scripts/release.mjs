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
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ENV_FILE = join(homedir(), '.config', 'sinawi', 'release.env')
const KEYS = ['APPLE_API_KEY', 'APPLE_API_ISSUER', 'APPLE_API_KEY_PATH', 'APPLE_SIGNING_IDENTITY']
const OUT = 'release'
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

function readEnvFile(path) {
  const out = {}
  if (!existsSync(path)) return out
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}
// ~, $HOME, ${HOME} 처럼 셸 파일에 흔히 쓰는 경로 표기를 푼다
const expandHome = (p) =>
  (p || '')
    .replace(/^~(?=\/|$)/, homedir())
    .replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (m, k) => (k === 'HOME' ? homedir() : (process.env[k] ?? m)))

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
function quiet(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() }
}

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  console.error('이 스크립트는 Apple Silicon Mac 에서만 돈다.')
  process.exit(1)
}

const fileVals = readEnvFile(ENV_FILE)
const cfg = {}
for (const k of KEYS) cfg[k] = process.env[k] || fileVals[k] || ''
cfg.APPLE_API_KEY_PATH = expandHome(cfg.APPLE_API_KEY_PATH)
console.log(existsSync(ENV_FILE) ? `자격 파일: ${ENV_FILE} (값은 표시하지 않음)` : `자격 파일 없음: ${ENV_FILE}`)

// 서명 인증서: 키체인에 있는지만 확인 (이름은 출력하지 않음)
const identities = quiet('security', ['find-identity', '-v', '-p', 'codesigning']).out
const identity = cfg.APPLE_SIGNING_IDENTITY
if (identity && !identities.includes(`"${identity}"`)) {
  console.error('APPLE_SIGNING_IDENTITY 의 인증서가 이 Mac 키체인에 없습니다.')
  process.exit(1)
}
if (!identity && !identities.includes('Developer ID Application:')) {
  console.error('키체인에 Developer ID Application 인증서가 없습니다.')
  process.exit(1)
}

const canNotarize = !!(cfg.APPLE_API_KEY && cfg.APPLE_API_ISSUER && cfg.APPLE_API_KEY_PATH && existsSync(cfg.APPLE_API_KEY_PATH))
console.log(canNotarize ? '공증: API 키 사용' : '공증 건너뜀: 자격 파일·항목 또는 .p8 파일이 없음')

run('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'])
run('npx', ['vitest', 'run'])
run('npx', ['electron-vite', 'build'])

// electron-builder 에 넘길 환경: 다른 자격 변수는 비우고, electron-builder 이름 규칙으로 다시 넣는다
//   (electron-builder 의 APPLE_API_KEY 는 .p8 경로, APPLE_API_KEY_ID 는 키 ID)
const env = { ...process.env }
for (const k of ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'APPLE_API_KEY_PATH', 'APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE', 'APPLE_SIGNING_IDENTITY', 'CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_NAME']) delete env[k]
if (identity) {
  env.CSC_NAME = identity.replace(/^(Developer ID Application|Apple Development|Apple Distribution|Mac Developer|3rd Party Mac Developer Application):\s*/, '')
  env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
}
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

console.log('\n=== 검증 ===')
for (const [name, cmd, args] of [
  ['codesign (app)', 'codesign', ['--verify', '--deep', '--strict', appDir]],
  ['spctl (app)', 'spctl', ['-a', '-vv', appDir]],
  ['stapler (app)', 'xcrun', ['stapler', 'validate', appDir]],
  ['codesign (dmg)', 'codesign', ['--verify', join(OUT, dmg)]],
  ['spctl (dmg)', 'spctl', ['-a', '-vv', '-t', 'open', '--context', 'context:primary-signature', join(OUT, dmg)]],
  ['stapler (dmg)', 'xcrun', ['stapler', 'validate', join(OUT, dmg)]]
]) {
  const r = quiet(cmd, args)
  console.log(`- ${name}: ${r.ok ? '통과' : '실패'}\n  ${r.out.split('\n').join('\n  ')}`)
}
const mb = (f) => `${(statSync(join(OUT, f)).size / 1024 / 1024).toFixed(1)} MB`
console.log(`\n산출물:\n- ${join(OUT, dmg)} (${mb(dmg)})${zip ? `\n- ${join(OUT, zip)} (${mb(zip)})` : ''}`)
console.log(canNotarize ? '공증: 완료 (app·dmg staple)' : '공증: 안 됨 — 처음 열 때 시스템 설정 > 개인정보 보호 및 보안 > "그래도 열기" 필요')
