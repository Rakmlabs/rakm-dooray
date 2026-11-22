// release.mjs 와 test-build.mjs 가 같이 쓰는 것: 자격 파일 읽기, 서명 인증서 확인, 자동 업데이트 정보(latest-mac.yml) 만들기.
// 자격 값은 출력하지 않는다.
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

export const ENV_FILE = join(homedir(), '.config', 'sinawi', 'release.env')
export const KEYS = ['APPLE_API_KEY', 'APPLE_API_ISSUER', 'APPLE_API_KEY_PATH', 'APPLE_SIGNING_IDENTITY']

export function readEnvFile(path) {
  const out = {}
  if (!existsSync(path)) return out
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

// ~, $HOME, ${HOME} 처럼 셸 파일에 흔히 쓰는 경로 표기를 푼다
export const expandHome = (p) =>
  (p || '')
    .replace(/^~(?=\/|$)/, homedir())
    .replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (m, k) => (k === 'HOME' ? homedir() : (process.env[k] ?? m)))

/** 이미 설정된 환경 변수 → 자격 파일 순. 값은 돌려주기만 하고 출력하지 않는다 */
export function loadCredentials() {
  const fileVals = readEnvFile(ENV_FILE)
  const cfg = {}
  for (const k of KEYS) cfg[k] = process.env[k] || fileVals[k] || ''
  cfg.APPLE_API_KEY_PATH = expandHome(cfg.APPLE_API_KEY_PATH)
  return cfg
}

export function quiet(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() }
}

/** 서명 인증서가 키체인에 있는지 확인하고, electron-builder 에 넘길 환경(자격 변수는 모두 비움)을 만든다 */
export function signingEnv(identity) {
  const identities = quiet('security', ['find-identity', '-v', '-p', 'codesigning']).out
  if (identity && !identities.includes(`"${identity}"`)) throw new Error('APPLE_SIGNING_IDENTITY 의 인증서가 이 Mac 키체인에 없습니다.')
  if (!identity && !identities.includes('Developer ID Application:')) throw new Error('키체인에 Developer ID Application 인증서가 없습니다.')
  const env = { ...process.env }
  for (const k of ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'APPLE_API_KEY_PATH', 'APPLE_KEYCHAIN', 'APPLE_KEYCHAIN_PROFILE', 'APPLE_SIGNING_IDENTITY', 'CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_NAME']) delete env[k]
  if (identity) {
    env.CSC_NAME = identity.replace(/^(Developer ID Application|Apple Development|Apple Distribution|Mac Developer|3rd Party Mac Developer Application):\s*/, '')
    env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  }
  return env
}

const sha512 = (path) =>
  new Promise((resolve, reject) => {
    const h = createHash('sha512')
    createReadStream(path)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('base64')))
      .on('error', reject)
  })

/**
 * electron-updater(맥)가 읽는 latest-mac.yml 을 만든다. 서명·공증·staple 이 끝난 "최종" zip 으로 계산해야 한다.
 * 맥 자동 업데이트는 zip 을 받아 Squirrel.Mac 이 서명을 확인한 뒤 바꿔 끼운다 (dmg 는 처음 설치용).
 */
export async function writeUpdateInfo(outDir, version, zipName, dmgName = null) {
  const entry = async (name) => ({ name, sha512: await sha512(join(outDir, name)), size: statSync(join(outDir, name)).size })
  const zip = await entry(zipName)
  const files = [zip, ...(dmgName ? [await entry(dmgName)] : [])]
  const yml = [
    `version: ${version}`,
    'files:',
    ...files.flatMap((f) => [`  - url: ${f.name}`, `    sha512: ${f.sha512}`, `    size: ${f.size}`]),
    `path: ${zip.name}`,
    `sha512: ${zip.sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    ''
  ].join('\n')
  const path = join(outDir, 'latest-mac.yml')
  writeFileSync(path, yml)
  return basename(path)
}
