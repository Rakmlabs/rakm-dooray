// 두레이 메신저 Incoming 웹훅으로 보낼 릴리스 공지 본문.
// 형식: { botName, botIconImage?, text, attachments: [{ title, titleLink, text, color }] } (두레이 "서비스 연동 > Incoming")

const MAX_LINES = 14

/** 릴리스 노트 마크다운 → 공지용 줄 글 (제목은 【】, 목록은 •, 자동 설치 안내 문단은 뺀다) */
export function notesForChat(markdown) {
  const lines = []
  for (const raw of markdown.replace(/\r/g, '').split('\n')) {
    const l = raw.trim()
    if (!l || /자동으로 설치됩니다/.test(l)) continue
    const h = /^#{1,6}\s+(.*)$/.exec(l)
    const li = /^[-*+]\s+(.*)$/.exec(l)
    const text = (h ? h[1] : li ? li[1] : l).replace(/\*\*|__|`/g, '')
    lines.push(h ? `【${text}】` : li ? `• ${text}` : text)
  }
  if (lines.length > MAX_LINES) return [...lines.slice(0, MAX_LINES), '…']
  return lines
}

export function doorayAnnouncement({ version, notes, url }) {
  return {
    botName: 'RAKM 두레이 릴리스',
    text: `RAKM 두레이 v${version} 출시 — 앱을 켜 두면 자동으로 받아 알려 드립니다.`,
    attachments: [
      {
        title: `v${version} 변경점 · 내려받기`,
        titleLink: url,
        text: notesForChat(notes).join('\n'),
        color: '#2f6bff'
      }
    ]
  }
}
