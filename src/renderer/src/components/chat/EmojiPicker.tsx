// 가벼운 이모지 선택기. 라이브러리 없이 자주 쓰는 목록 + 한국어/영어 낱말 검색.
import { useEffect, useMemo, useRef, useState } from 'react'

const EMOJIS: [string, string][] = [
  ['👍', '좋아요 엄지 like ok thumbs'],
  ['🙏', '감사 부탁 please thanks'],
  ['😀', '웃음 smile happy'],
  ['😂', '웃김 눈물 lol'],
  ['🤣', '빵터짐 rofl'],
  ['😊', '미소 blush'],
  ['🥲', '웃픈 슬픔'],
  ['😅', '땀 머쓱 sweat'],
  ['😍', '하트눈 love'],
  ['🤔', '고민 생각 thinking'],
  ['😮', '놀람 wow'],
  ['😢', '슬픔 sad cry'],
  ['😭', '엉엉 울음 sob'],
  ['😡', '화남 angry'],
  ['😴', '졸림 sleep'],
  ['🤯', '머리터짐 mind blown'],
  ['🥳', '축하 파티 party'],
  ['😎', '멋짐 cool'],
  ['🙌', '만세 hooray'],
  ['👏', '박수 clap'],
  ['👌', '오케이 ok'],
  ['✌️', '브이 peace'],
  ['💪', '힘 화이팅 strong'],
  ['🤝', '악수 deal'],
  ['👀', '보는중 확인 eyes look'],
  ['🙇', '죄송 sorry bow'],
  ['❤️', '하트 사랑 heart'],
  ['🔥', '불 대박 fire hot'],
  ['✨', '반짝 sparkles'],
  ['🎉', '축하 tada'],
  ['🚀', '출시 배포 launch rocket'],
  ['✅', '완료 체크 done check'],
  ['❌', '아니 실패 no x'],
  ['⚠️', '주의 경고 warning'],
  ['❓', '질문 question'],
  ['❗', '중요 important'],
  ['💯', '완벽 100'],
  ['⏰', '시간 마감 alarm'],
  ['📅', '일정 calendar'],
  ['📌', '고정 pin'],
  ['📎', '첨부 clip'],
  ['📝', '메모 note'],
  ['📄', '문서 page doc'],
  ['📊', '차트 데이터 chart'],
  ['💡', '아이디어 idea'],
  ['🐛', '버그 bug'],
  ['🛠️', '수정 고침 fix tools'],
  ['🧪', '테스트 test'],
  ['💰', '돈 투자 money'],
  ['☕', '커피 coffee'],
  ['🍚', '밥 점심 lunch'],
  ['🍺', '맥주 beer'],
  ['🏃', '출발 run'],
  ['🏠', '집 퇴근 home'],
  ['🌙', '밤 night'],
  ['☀️', '아침 sun'],
  ['👋', '안녕 인사 hi wave'],
  ['🤗', '포옹 hug'],
  ['😬', '어색 grimace'],
  ['🫡', '경례 알겠습니다 salute']
]

export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? EMOJIS.filter(([e, k]) => k.toLowerCase().includes(t) || e === t) : EMOJIS
  }, [q])
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as Element).closest?.('.emoji-toggle')) onClose()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [onClose])
  return (
    <div className="emoji-picker" ref={ref} role="dialog" aria-label="이모지 고르기">
      <input
        autoFocus
        value={q}
        placeholder="이모지 찾기 (예: 감사, 완료)"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
          if (e.key === 'Enter' && list[0]) {
            e.preventDefault()
            onPick(list[0][0])
          }
        }}
      />
      <div className="emoji-grid">
        {list.map(([e, k]) => (
          <button key={e} title={k.split(' ')[0]} aria-label={k.split(' ')[0]} onClick={() => onPick(e)}>
            {e}
          </button>
        ))}
        {list.length === 0 && <div className="muted small pad">없습니다</div>}
      </div>
    </div>
  )
}
