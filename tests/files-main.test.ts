import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileCache, cacheKey, safeFileName } from '../src/main/files/cache'
import { parseRange } from '../src/main/files/range'
import { serveFile } from '../src/main/files/protocol'

const dirs: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'files-cache-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('Range 해석', () => {
  it('없거나 형식이 다르면 전체 응답', () => {
    expect(parseRange(null, 100)).toBeNull()
    expect(parseRange('items=0-1', 100)).toBeNull()
    expect(parseRange('bytes=0-1,5-6', 100)).toBeNull()
  })
  it('시작-끝, 시작-, -마지막N', () => {
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 })
    expect(parseRange('bytes=50-', 100)).toEqual({ start: 50, end: 99 })
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 })
    expect(parseRange('bytes=90-500', 100)).toEqual({ start: 90, end: 99 })
  })
  it('범위 밖이면 416', () => {
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable')
    expect(parseRange('bytes=5-2', 100)).toBe('unsatisfiable')
    expect(parseRange('bytes=-0', 100)).toBe('unsatisfiable')
  })
})

describe('serveFile', () => {
  it('Range 요청에 206 과 Content-Range 로 일부만 준다', async () => {
    const d = tmp()
    const p = join(d, 'a.bin')
    writeFileSync(p, Buffer.from('0123456789'))
    const r = await serveFile(p, 'video/mp4', 'bytes=2-5')
    expect(r.status).toBe(206)
    expect(r.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(await r.text()).toBe('2345')
    const all = await serveFile(p, 'video/mp4', null)
    expect(all.status).toBe(200)
    expect(all.headers.get('accept-ranges')).toBe('bytes')
    expect((await all.arrayBuffer()).byteLength).toBe(10)
    expect((await serveFile(p, 'video/mp4', 'bytes=20-')).status).toBe(416)
  })
  it('HTML 은 글자로만 내보낸다', async () => {
    const d = tmp()
    const p = join(d, 'x.html')
    writeFileSync(p, '<script>alert(1)</script>')
    const r = await serveFile(p, 'text/html', null)
    expect(r.headers.get('content-type')).toContain('text/plain')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
  })
})

describe('safeFileName', () => {
  it('경로 구분자·제어 문자를 없애고 확장자를 지킨다', () => {
    expect(safeFileName('../../etc/passwd')).toBe('passwd')
    expect(safeFileName('a\\b\\c.txt')).toBe('c.txt')
    expect(safeFileName('보고서:최종?.hwp')).toBe('보고서_최종_.hwp')
    expect(safeFileName('...')).toBe('file')
    const long = 'x'.repeat(300) + '.pdf'
    expect(safeFileName(long).length).toBe(120)
    expect(safeFileName(long).endsWith('.pdf')).toBe(true)
  })
})

describe('FileCache', () => {
  function make(limit: number, files: Record<string, string>) {
    const dir = tmp()
    let t = 1000
    const download = vi.fn(async (_c: string, f: string) => {
      if (!(f in files)) throw new Error('없음')
      return { bytes: Buffer.from(files[f]), fileName: `${f}.bin`, contentType: 'application/x-test' }
    })
    const cache = new FileCache({ dir, limitBytes: () => limit, download, now: () => ++t })
    return { dir, cache, download }
  }

  it('같은 파일을 동시에 요청해도 한 번만 내려받고, 다음부터는 캐시에서 준다', async () => {
    const { cache, download } = make(1000, { a: 'hello' })
    const [e1, e2] = await Promise.all([cache.ensure('c', 'a', '인사.txt'), cache.ensure('c', 'a', '인사.txt')])
    expect(e1).toBe(e2)
    expect(download).toHaveBeenCalledTimes(1)
    expect(readFileSync(cache.blobPath(e1), 'utf8')).toBe('hello')
    expect(e1.name).toBe('인사.txt')
    expect(e1.mime).toBe('text/plain')
    await cache.ensure('c', 'a', '인사.txt')
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('이름 힌트가 없으면 서버 이름, 모르는 형식이면 서버 content-type', async () => {
    const { cache } = make(1000, { b: 'x' })
    const e = await cache.ensure('c', 'b', '')
    expect(e.name).toBe('b.bin')
    expect(e.mime).toBe('application/x-test')
  })

  it('키는 channelId+fileId 이고 디스크 경로는 캐시 폴더 안이다', async () => {
    const { cache, dir } = make(1000, { a: '1' })
    const e = await cache.ensure('../../x', 'a', '../../../evil.txt')
    expect(e.key).toBe(cacheKey('../../x', 'a'))
    expect(cache.blobPath(e).startsWith(join(dir, 'blobs', e.key))).toBe(true)
    expect(e.name).toBe('evil.txt')
  })

  it('상한을 넘으면 가장 오래 안 쓴 것부터 지운다 (방금 넣은 것은 남긴다)', async () => {
    const { cache } = make(10, { a: 'aaaa', b: 'bbbb', c: 'cccc' })
    await cache.ensure('ch', 'a', 'a')
    await cache.ensure('ch', 'b', 'b')
    await cache.ensure('ch', 'a', 'a') // a 를 다시 씀 → b 가 더 오래됨
    await cache.ensure('ch', 'c', 'c')
    expect(cache.has('ch', 'a')).toBe(true)
    expect(cache.has('ch', 'b')).toBe(false)
    expect(cache.has('ch', 'c')).toBe(true)
    expect(cache.stats()).toMatchObject({ bytes: 8, count: 2, limitBytes: 10 })
  })

  it('색인을 다시 읽어 재시작 후에도 캐시를 쓴다, 비우기', async () => {
    const { cache, dir, download } = make(1000, { a: 'aaaa' })
    await cache.ensure('ch', 'a', 'a.txt')
    cache.flush()
    const again = new FileCache({ dir, limitBytes: () => 1000, download })
    expect(again.has('ch', 'a')).toBe(true)
    await again.clear()
    expect(again.stats().count).toBe(0)
    expect(new FileCache({ dir, limitBytes: () => 1000, download }).has('ch', 'a')).toBe(false)
  })

  it('썸네일을 만들 수 없으면 원본을 준다', async () => {
    const dir = tmp()
    const cache = new FileCache({
      dir,
      limitBytes: () => 1e6,
      download: async () => ({ bytes: Buffer.from('img'), fileName: null, contentType: null }),
      makeThumb: async () => null
    })
    const t = await cache.thumb('c', 'i', '사진.jpg')
    expect(t.mime).toBe('image/jpeg')
    expect(t.path.endsWith('사진.jpg')).toBe(true)
    const withThumb = new FileCache({
      dir: tmp(),
      limitBytes: () => 1e6,
      download: async () => ({ bytes: Buffer.from('img'), fileName: null, contentType: null }),
      makeThumb: async () => Buffer.from('small')
    })
    const t2 = await withThumb.thumb('c', 'i', '사진.png')
    expect(t2.mime).toBe('image/png')
    expect(readFileSync(t2.path, 'utf8')).toBe('small')
  })
})
