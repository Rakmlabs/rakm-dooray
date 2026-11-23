import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getVersion: () => '0.0.0', isPackaged: false, getPath: () => '/tmp' } }))
vi.mock('electron-updater', () => ({ autoUpdater: {} }))

const { friendly, releaseNotesText } = await import('../src/main/updates/service')

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

describe('릴리스 노트 → 알림 카드 줄', () => {
  it('GitHub 가 주는 HTML: 제목·목록, 자동 설치 안내는 뺀다', () => {
    const html =
      '<p>0.1.8 에서 올라오면 이 버전은 <strong>자동으로 설치됩니다</strong> (받아 둔 뒤…)</p>\n<h2>새 버전 알림</h2>\n<ul>\n<li>15분마다 확인 &amp; 알림</li>\n<li><code>⌘K</code> 가 빨라졌습니다</li>\n</ul>'
    expect(releaseNotesText(html)).toEqual(['새 버전 알림', '• 15분마다 확인 & 알림', '• ⌘K 가 빨라졌습니다'])
  })
  it('마크다운·버전별 배열·빈 값', () => {
    expect(releaseNotesText('## 고친 것\n- **입력** 지연\n* 스크롤')).toEqual(['고친 것', '• 입력 지연', '• 스크롤'])
    expect(releaseNotesText([{ version: '0.1.9', note: '- 하나' }])).toEqual(['• 하나'])
    expect(releaseNotesText(null)).toEqual([])
    expect(releaseNotesText('')).toEqual([])
  })
  it('길면 12줄까지', () => {
    expect(releaseNotesText(Array.from({ length: 30 }, (_, i) => `- ${i}`).join('\n'))).toHaveLength(12)
  })
})
