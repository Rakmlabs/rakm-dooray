// 외부 아이콘 폰트·CDN 없이 쓰는 작은 SVG 아이콘 모음 (CSP 상 외부 리소스를 막는다)
const PATHS = {
  chat: 'M4 5h16v11H8l-4 4z',
  mail: 'M3 6h18v12H3z M3 6l9 7 9-7',
  book: 'M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4z M5 16a4 4 0 0 1 4-4h10',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M12 2v3 M12 19v3 M2 12h3 M19 12h3 M4.9 4.9l2.1 2.1 M17 17l2.1 2.1 M4.9 19.1L7 17 M17 7l2.1-2.1',
  plus: 'M12 5v14 M5 12h14',
  thread: 'M5 6h14 M5 12h10 M5 18h6 M17 14l3 3-3 3',
  reply: 'M10 8L4 13l6 5 M4 13h10a6 6 0 0 1 6 6',
  edit: 'M4 20h4L19 9l-4-4L4 16z',
  trash: 'M5 7h14 M9 7V4h6v3 M7 7l1 13h8l1-13',
  clip: 'M16 6l-8 8a3 3 0 0 0 4 4l8-8a5 5 0 0 0-7-7l-8 8',
  close: 'M6 6l12 12 M18 6L6 18',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  download: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.6 M20 4v5h-5',
  folder: 'M3 6h6l2 2h10v11H3z',
  send: 'M4 12l16-8-6 16-2-6z',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  chevron: 'M9 6l6 6-6 6',
  tag: 'M3 12V3h9l9 9-9 9z M7.5 7.5h.01',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4',
  bell: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z M10 21h4',
  bellOff: 'M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z M10 21h4 M3 3l18 18',
  user: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M4 20a8 8 0 0 1 16 0',
  grip: 'M9 6h.01 M15 6h.01 M9 12h.01 M15 12h.01 M9 18h.01 M15 18h.01',
  offline: 'M2 8a15 15 0 0 1 20 0 M5 12a10 10 0 0 1 14 0 M8.5 15.5a5 5 0 0 1 7 0 M12 19h.01 M3 3l18 18',
  page: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 13h7 M9 17h5',
  panelClose: 'M4 4h16v16H4z M10 4v16 M16 10l-2 2 2 2',
  panelOpen: 'M4 4h16v16H4z M10 4v16 M14 10l2 2-2 2'
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
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
