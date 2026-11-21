// 위키 편집기 전용 작은 아이콘 (Icon.tsx 는 셸 영역 소유라 따로 둔다). 선 굵기·크기는 Icon.tsx 와 맞춘다.
import type { ReactNode } from 'react'

const PATHS: Record<string, ReactNode> = {
  grip: (
    <>
      <circle cx="9" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  bold: <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" />,
  italic: <path d="M14 5h-4M14 19h-4M13 5l-2 14" />,
  strike: <path d="M5 12h14M16 7.5C15.4 6 14 5 12 5c-2.5 0-4 1.3-4 3 0 1.2.7 2.2 2.5 2.8M8 16.5C8.6 18 10 19 12 19c2.5 0 4-1.3 4-3" />,
  code: <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />,
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  text: <path d="M5 6h14M12 6v13" />,
  h1: (
    <>
      <path d="M4 6v12M12 6v12M4 12h8" />
      <path d="M16 9l3-2v11" />
    </>
  ),
  h2: (
    <>
      <path d="M3 6v12M11 6v12M3 12h8" />
      <path d="M15 9.5a2.5 2.5 0 0 1 5 .5c0 2-5 4.5-5 8h5" />
    </>
  ),
  h3: (
    <>
      <path d="M3 6v12M11 6v12M3 12h8" />
      <path d="M15 8h5l-3 4a3 3 0 1 1-2.5 4.5" />
    </>
  ),
  bullet: (
    <>
      <circle cx="5" cy="7" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="5" cy="17" r="1.3" fill="currentColor" stroke="none" />
      <path d="M10 7h10M10 12h10M10 17h10" />
    </>
  ),
  ordered: (
    <>
      <path d="M4 5h1.5v4M4 9h3M4 14.5a1.5 1.5 0 0 1 3 0c0 1.2-3 2-3 3.5h3" />
      <path d="M11 7h9M11 12h9M11 17h9" />
    </>
  ),
  check: (
    <>
      <rect x="3.5" y="4.5" width="6" height="6" rx="1.5" />
      <path d="M5 7.5l1.2 1.2L8.5 6.3M13 7.5h7M3.5 14.5h6v6h-6zM13 17.5h7" />
    </>
  ),
  table: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M3.5 10h17M3.5 14.5h17M10 10v9" />
    </>
  ),
  codeblock: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9.5 10l-2 2 2 2M14.5 10l2 2-2 2" />
    </>
  ),
  quote: <path d="M5 6v12M9 8h10M9 12h10M9 16h6" />,
  hr: <path d="M4 12h16M7 7h10M7 17h10" strokeDasharray="0" />,
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M20.5 16l-5-5-8 8" />
    </>
  ),
  history: <path d="M4 12a8 8 0 1 0 2.4-5.7M4 5v4h4M12 8v4l3 2" />,
  source: <path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14" />,
  blocks: (
    <>
      <rect x="4" y="4.5" width="16" height="6" rx="1.5" />
      <rect x="4" y="13.5" width="16" height="6" rx="1.5" />
    </>
  ),
  unlink: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7M4 4l16 16" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />
}

export function WIcon({ name, size = 16 }: { name: keyof typeof PATHS | string; size?: number }) {
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
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  )
}
