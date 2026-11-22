// 두레이 시스템 메시지 (type=SYSTEM). 본문이 {"type":"joinMember","joinMember":{"host":"…","members":["…"]}} 같은 JSON 으로 온다.
// 목록 미리보기·대화창·검색에 원문 JSON 이 보이지 않게, 사람이 읽는 문구로 바꾼다. 모르는 종류는 일반 문구로.

export interface SystemEvent {
  /** joinMember, leaveMember, createChannel, … (모르면 원래 이름 그대로) */
  kind: string
  /** 한 사람(초대한 사람·만든 사람 등). 멤버 ID */
  host: string | null
  /** 대상 멤버 ID 들 */
  members: string[]
  title: string | null
}

type Msg = { type?: string | null; text?: string | null; senderId?: string | null }

/** 시스템 메시지면 내용을 꺼낸다. 시스템 메시지가 아니면 null */
export function parseSystem(m: Msg): SystemEvent | null {
  const raw = (m.text ?? '').trim()
  const looksJson = raw.startsWith('{"type":"')
  if (m.type !== 'SYSTEM' && !(looksJson && !m.senderId)) return null
  let obj: Record<string, unknown> | null = null
  try {
    const v = JSON.parse(raw) as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) obj = v as Record<string, unknown>
  } catch {
    /* JSON 이 아니면 아래에서 일반 문구 */
  }
  const kind = typeof obj?.type === 'string' ? obj.type : 'unknown'
  const body = obj && typeof obj[kind] === 'object' && obj[kind] !== null ? (obj[kind] as Record<string, unknown>) : {}
  const id = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v) : null)
  const list = (v: unknown) => (Array.isArray(v) ? v.map(id).filter((x): x is string => !!x) : [])
  return {
    kind,
    host: id(body.host),
    members: list(body.members ?? body.memberIds ?? body.member),
    title: typeof body.title === 'string' ? body.title : null
  }
}

function names(ids: string[], nameOf: (id: string) => string | null): string {
  const shown = ids.slice(0, 3).map((i) => nameOf(i) ?? '멤버')
  const more = ids.length - shown.length
  return shown.join(', ') + (more > 0 ? ` 외 ${more}명` : '')
}

/** 사람이 읽는 한 줄. nameOf 가 이름을 모르면 '멤버'로 쓴다 */
export function systemText(e: SystemEvent, nameOf: (id: string) => string | null = () => null): string {
  const who = (id: string | null) => (id ? (nameOf(id) ?? '멤버') : null)
  const host = who(e.host)
  const targets = e.members.filter((m) => m !== e.host)
  switch (e.kind) {
    case 'joinMember':
    case 'inviteMember':
      if (host && targets.length) return `${host}님이 ${names(targets, nameOf)}님을 초대했습니다`
      if (e.members.length) return `${names(e.members, nameOf)}님이 참여했습니다`
      return host ? `${host}님이 참여했습니다` : '새 멤버가 참여했습니다'
    case 'leaveMember':
    case 'exitMember':
      if (e.members.length) return `${names(e.members, nameOf)}님이 나갔습니다`
      return host ? `${host}님이 나갔습니다` : '멤버가 나갔습니다'
    case 'kickMember':
    case 'removeMember':
      if (targets.length) return `${names(targets, nameOf)}님이 내보내졌습니다`
      return '멤버가 내보내졌습니다'
    case 'createChannel':
      if (host && e.title) return `${host}님이 대화방 "${e.title}"을(를) 만들었습니다`
      return host ? `${host}님이 대화방을 만들었습니다` : '대화방이 만들어졌습니다'
    case 'updateTitle':
    case 'changeTitle':
    case 'updateChannelTitle':
      return e.title ? `대화방 이름이 "${e.title}"(으)로 바뀌었습니다` : '대화방 이름이 바뀌었습니다'
    default:
      return '알림 메시지'
  }
}
