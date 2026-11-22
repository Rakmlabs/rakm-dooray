import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', isPackaged: false, getPath: () => '/tmp' } }))
vi.mock('electron-updater', () => ({ autoUpdater: {} }))

const { friendly } = await import('../src/main/updates/service')

describe('업데이트 오류 문구', () => {
  it('비공개 저장소(404)는 짧은 한국어로', () => {
    expect(friendly('HttpError: 404 "method: GET url: https://github.com/x/y/releases.atom\\n\\nPlease double check that your authentication token')).toContain('404')
    expect(friendly('HttpError: 404 …')).not.toContain('token')
  })
  it('네트워크·서명 오류', () => {
    expect(friendly('net::ERR_INTERNET_DISCONNECTED')).toBe('업데이트 서버에 연결할 수 없습니다.')
    expect(friendly('Code signature at URL did not pass validation: designated requirement')).toContain('서명')
  })
  it('그 밖은 첫 줄만, 길면 자른다', () => {
    expect(friendly('Error: 무언가\n둘째 줄')).toBe('무언가')
    expect(friendly('x'.repeat(300)).length).toBe(98)
  })
})
