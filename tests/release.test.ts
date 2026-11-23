import { describe, expect, it } from 'vitest'
// @ts-expect-error 스크립트(.mjs)라 타입 없음
import { doorayAnnouncement, notesForChat } from '../scripts/lib/announce.mjs'
// @ts-expect-error 스크립트(.mjs)라 타입 없음
import { readReleaseNotes } from '../scripts/lib/mac-build.mjs'

describe('릴리스 공지·노트', () => {
  it('두레이 공지: 제목은 【】, 목록은 •, 자동 설치 안내는 뺀다', () => {
    const md = '0.1.8 에서 올라오면 **자동으로 설치됩니다**.\n\n## 새 알림\n- 15분마다 `확인`\n- **카드** 표시'
    expect(notesForChat(md)).toEqual(['【새 알림】', '• 15분마다 확인', '• 카드 표시'])
    const b = doorayAnnouncement({ version: '9.9.9', notes: md, url: 'https://example.com/v9' })
    expect(b.botName).toBeTruthy()
    expect(b.text).toContain('v9.9.9')
    expect(b.attachments[0]).toMatchObject({ titleLink: 'https://example.com/v9', text: '【새 알림】\n• 15분마다 확인\n• 카드 표시' })
  })
  it('긴 노트는 14줄 + …', () => {
    const md = Array.from({ length: 30 }, (_, i) => `- 항목 ${i}`).join('\n')
    const lines = notesForChat(md)
    expect(lines).toHaveLength(15)
    expect(lines.at(-1)).toBe('…')
  })
  it('지금 버전의 릴리스 노트가 있고 형식이 맞다', () => {
    const pkg = JSON.parse(require('node:fs').readFileSync('package.json', 'utf8'))
    expect(() => readReleaseNotes(pkg.version)).not.toThrow()
    expect(() => readReleaseNotes('0.0.0-없음')).toThrow(/릴리스 노트가 없습니다/)
  })
})
