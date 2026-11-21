import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** userData 아래 폴더 (없으면 만든다). 로컬 DB·캐시는 여기에만 둔다. */
export function dataDir(...parts: string[]): string {
  const d = join(app.getPath('userData'), ...parts)
  mkdirSync(d, { recursive: true })
  return d
}

/** userData 의 작은 JSON 파일 하나. 쓰기는 임시 파일 → rename 으로 깨지지 않게 한다. */
export function jsonStore<T>(file: string, fallback: T) {
  const path = () => join(dataDir(), file)
  return {
    read(): T {
      const p = path()
      if (!existsSync(p)) return fallback
      try {
        return JSON.parse(readFileSync(p, 'utf8')) as T
      } catch {
        return fallback
      }
    },
    write(value: T): void {
      const p = path()
      writeFileSync(p + '.tmp', JSON.stringify(value), { encoding: 'utf8', mode: 0o600 })
      renameSync(p + '.tmp', p)
    }
  }
}
