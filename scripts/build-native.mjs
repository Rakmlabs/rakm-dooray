// native/notify.mm → build/native/notify.node (macOS 알림 권한 조회·요청 모듈)
// Node-API 만 쓰므로 Electron 버전과 무관하게 한 번 빌드하면 된다. 헤더는 지금 쓰는 Node 의 include/node 에서 찾는다.
// 서명은 electron-builder 가 앱을 서명할 때 함께 한다 (Resources 안의 Mach-O 도 서명한다).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

if (process.platform !== 'darwin') {
  console.log('build-native: macOS 가 아니라 건너뜀')
  process.exit(0)
}

const root = join(dirname(new URL(import.meta.url).pathname), '..')
const src = join(root, 'native', 'notify.mm')
const out = join(root, 'build', 'native', 'notify.node')

const candidates = [
  join(dirname(dirname(process.execPath)), 'include', 'node'),
  join(homedir(), 'Library', 'Caches', 'node-gyp', process.versions.node, 'include', 'node')
]
const inc = candidates.find((d) => existsSync(join(d, 'node_api.h')))
if (!inc) {
  console.error('build-native: node_api.h 를 찾지 못했습니다 (Node 설치의 include/node). `npx node-gyp install` 후 다시 하세요.')
  process.exit(1)
}

mkdirSync(dirname(out), { recursive: true })
execFileSync(
  'clang++',
  [
    '-std=c++17', '-ObjC++', '-fobjc-arc', '-O2',
    '-bundle', '-undefined', 'dynamic_lookup',
    '-arch', 'arm64', '-mmacosx-version-min=12.0',
    '-DNODE_GYP_MODULE_NAME=notify',
    '-I', inc,
    '-framework', 'Foundation', '-framework', 'UserNotifications',
    src, '-o', out
  ],
  { stdio: 'inherit' }
)
console.log('build-native: build/native/notify.node')
