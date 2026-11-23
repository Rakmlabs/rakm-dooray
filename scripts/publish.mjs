// 릴리스 게시: npm run release 로 만든 release/ 산출물을 GitHub 릴리스로 올리고, 자동 업데이트 피드를 확인하고, 두레이 대화방에 알린다.
//   npm run release:publish               # 태그 v<버전> → GitHub 릴리스(노트 = docs/releases/<버전>.md) → latest-mac.yml 확인 → 두레이 공지
//   npm run release:publish -- --announce   # 두레이 공지만 다시 (이미 게시한 버전)
//   npm run release:publish -- --dry-run    # 무엇을 할지만 보이기 (두레이에 보낼 글 미리 보기 포함, 아무것도 올리지 않음)
//
// 두레이 공지: 저장소 밖 ~/.config/sinawi/release.env 의 DOORAY_RELEASE_WEBHOOK (두레이 메신저 "서비스 연동 > Incoming" 웹훅 URL).
// 없으면 이 단계만 건너뛴다. URL 은 출력·로그에 남기지 않는다.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ENV_FILE, readEnvFile, readReleaseNotes, releaseNotesPath } from './lib/mac-build.mjs'
import { doorayAnnouncement } from './lib/announce.mjs'

const REPO = 'Rakmlabs/rakm-dooray'
const OUT = 'release'
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
const version = pkg.version
const tag = `v${version}`
const pageUrl = `https://github.com/${REPO}/releases/tag/${tag}`
const announceOnly = process.argv.includes('--announce')
const dry = process.argv.includes('--dry-run')

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`)
  if (dry) return ''
  const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: opts.capture ? 'pipe' : 'inherit' })
  if (r.status !== 0) {
    console.error(`실패: ${cmd} (종료 코드 ${r.status})${opts.capture ? `\n${r.stderr}` : ''}`)
    process.exit(r.status ?? 1)
  }
  return r.stdout ?? ''
}

let notes
try {
  notes = readReleaseNotes(version)
} catch (e) {
  console.error(e.message)
  process.exit(1)
}

if (!announceOnly) {
  const assets = [
    'latest-mac.yml',
    `RAKM-Dooray-${version}-arm64.dmg`,
    `RAKM-Dooray-${version}-arm64.dmg.blockmap`,
    `RAKM-Dooray-${version}-arm64.zip`,
    `RAKM-Dooray-${version}-arm64.zip.blockmap`
  ]
  const missing = assets.filter((f) => !existsSync(join(OUT, f)))
  if (missing.length) {
    console.error(`release/ 에 없는 파일: ${missing.join(', ')} — 먼저 npm run release`)
    process.exit(1)
  }
  const yml = readFileSync(join(OUT, 'latest-mac.yml'), 'utf8')
  if (!new RegExp(`^version: ${version.replace(/\./g, '\\.')}$`, 'm').test(yml)) {
    console.error(`release/latest-mac.yml 의 버전이 ${version} 이 아닙니다 — 다시 npm run release`)
    process.exit(1)
  }
  // 태그: 없으면 지금 HEAD 에 만들고 올린다 (main 이 먼저 올라가 있어야 한다)
  const local = spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`]).status === 0
  if (!local) run('git', ['tag', '-a', tag, '-m', tag])
  run('git', ['push', 'origin', tag])
  run('gh', ['release', 'create', tag, '-R', REPO, '--target', 'main', '--title', `RAKM 두레이 ${version}`, '--notes-file', releaseNotesPath(version), ...assets.map((f) => join(OUT, f))])

  // 자동 업데이트 피드가 새 버전을 가리키는지 (GitHub 가 반영하는 데 몇 초 걸릴 수 있다)
  if (!dry) {
    let ok = false
    for (let i = 0; i < 10 && !ok; i++) {
      try {
        const r = await fetch(`https://github.com/${REPO}/releases/latest/download/latest-mac.yml`, { redirect: 'follow' })
        ok = r.ok && (await r.text()).includes(`version: ${version}`)
      } catch {
        /* 다시 */
      }
      if (!ok) await new Promise((r) => setTimeout(r, 3000))
    }
    console.log(ok ? `\n자동 업데이트 피드: latest-mac.yml = ${version} 확인` : '\n경고: latest-mac.yml 이 아직 새 버전이 아닙니다. 잠시 뒤 다시 확인하세요.')
    if (!ok) process.exitCode = 1
  }
}

// 두레이 공지
const hook = process.env.DOORAY_RELEASE_WEBHOOK || readEnvFile(ENV_FILE).DOORAY_RELEASE_WEBHOOK || ''
const body = doorayAnnouncement({ version, notes, url: pageUrl })
if (!hook) {
  console.log(`\n두레이 공지 건너뜀: ${ENV_FILE} 에 DOORAY_RELEASE_WEBHOOK 이 없습니다.`)
} else if (!/^https:\/\/|^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(hook)) {
  console.error('\n두레이 공지 건너뜀: DOORAY_RELEASE_WEBHOOK 이 https 주소가 아닙니다.')
  process.exitCode = 1
} else if (dry) {
  console.log('\n두레이 공지 (미리 보기, 보내지 않음):\n' + JSON.stringify(body, null, 2))
} else {
  try {
    const r = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    console.log('\n두레이 공지: 보냄')
  } catch (e) {
    // 웹훅 URL 은 비밀이라 오류 문구에도 넣지 않는다
    console.error(`\n두레이 공지 실패: ${e instanceof Error ? e.message.replace(hook, '<웹훅>') : '알 수 없는 오류'}`)
    process.exitCode = 1
  }
}
console.log(`\n${pageUrl}`)
