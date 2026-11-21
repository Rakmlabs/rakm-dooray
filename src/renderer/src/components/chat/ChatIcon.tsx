// 채팅 영역 전용 작은 SVG 아이콘 (Icon.tsx 는 셸 소유라 여기 따로 둔다)
const PATHS = {
  bookmark: 'M6 4h12v17l-6-4-6 4z',
  bookmarkFill: 'M6 4h12v17l-6-4-6 4z',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  wiki: 'M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z M9 9h6 M9 13h6',
  smile: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2 M9 9.5h.01 M15 9.5h.01',
  at: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  mail: 'M3 6h18v12H3z M3 6l9 7 9-7',
  chat: 'M4 5h16v11H8l-4 4z',
  page: 'M6 3h9l4 4v14H6z M14 3v5h5',
  chevron: 'M9 6l6 6-6 6',
  check: 'M5 12l5 5 9-10',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4'
} as const

export type ChatIconName = keyof typeof PATHS

export function ChatIcon({ name, size = 16 }: { name: ChatIconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={name === 'bookmarkFill' ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
