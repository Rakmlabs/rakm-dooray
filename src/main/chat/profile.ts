import type { MemberProfile } from '@shared/types-chat'

/** 공식 GET /common/v1/members/{id} 응답 (사진·부서·직책 필드는 없다) */
export interface RawMemberDetail {
  id?: string | number
  name?: string
  userCode?: string
  externalEmailAddress?: string
  englishName?: string
  nickname?: string
  defaultOrganization?: { id?: string | number }
}

export function toProfile(id: string, m: RawMemberDetail): MemberProfile {
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return {
    id: m.id !== undefined && m.id !== null ? String(m.id) : id,
    name: s(m.name) ?? id,
    email: s(m.externalEmailAddress),
    userCode: s(m.userCode),
    englishName: s(m.englishName),
    nickname: s(m.nickname),
    organizationId: m.defaultOrganization?.id !== undefined ? String(m.defaultOrganization.id) : null
  }
}
