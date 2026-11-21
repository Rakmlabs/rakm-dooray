// 파일 영역 renderer 공용: 메시지 → 파일 항목, 분류·표시 이름, 바이트 읽기.
import type { Message } from '@shared/types'
import { extOf, fileKind, fileUrl, thumbUrl, type FileKind } from '@shared/types-files'

export interface FileItem {
  channelId: string
  fileId: string
  messageId: string
  seq: number
  name: string
  size: number | null
  mime: string | null
  kind: FileKind
  sentAt: string | null
  senderId: string | null
}

export function itemOf(m: Message): FileItem | null {
  if (!m.file) return null
  return {
    channelId: m.channelId,
    fileId: m.file.id,
    messageId: m.id,
    seq: m.seq,
    name: m.file.name,
    size: m.file.size,
    mime: m.file.mimeType,
    kind: fileKind(m.file.name, m.file.mimeType),
    sentAt: m.sentAt,
    senderId: m.senderId
  }
}

export const urlOf = (f: FileItem) => fileUrl(f.channelId, f.fileId, f.name)
export const thumbOf = (f: FileItem) => thumbUrl(f.channelId, f.fileId, f.name)

/** 모아보기·뷰어 넘김 묶음 */
export type FileGroup = 'photo' | 'media' | 'doc'
export function groupOf(kind: FileKind): FileGroup {
  if (kind === 'image') return 'photo'
  if (kind === 'video' || kind === 'audio') return 'media'
  return 'doc'
}

const KIND_LABEL: Record<FileKind, string> = {
  image: '사진',
  video: '동영상',
  audio: '오디오',
  pdf: 'PDF 문서',
  docx: 'Word 문서',
  xlsx: 'Excel 표',
  pptx: 'PowerPoint 발표',
  hwp: '한글 문서',
  hwpx: '한글 문서',
  markdown: '마크다운',
  csv: '표 (CSV)',
  json: 'JSON',
  code: '코드',
  text: '텍스트',
  other: '파일'
}
export const kindLabel = (k: FileKind) => KIND_LABEL[k]

/** 카드에 붙이는 짧은 형식 표시 (PDF, DOCX …) */
export function badgeOf(name: string): string {
  const e = extOf(name)
  return (e || 'file').slice(0, 4).toUpperCase()
}

/** 배지 색 묶음 (files.css 의 .fbadge.tone-*) */
export function toneOf(kind: FileKind): string {
  switch (kind) {
    case 'pdf':
      return 'red'
    case 'xlsx':
    case 'csv':
      return 'green'
    case 'pptx':
      return 'orange'
    case 'docx':
    case 'hwp':
    case 'hwpx':
      return 'blue'
    case 'code':
    case 'json':
    case 'markdown':
      return 'ink'
    default:
      return 'gray'
  }
}

/** 앱 안에서 열 수 있는 형식인지 */
export function viewable(kind: FileKind): boolean {
  return kind !== 'other'
}

export const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent)

/** rakm-file:// 에서 바이트를 읽는다 (캐시에 없으면 main 이 내려받는다) */
export async function fetchBytes(f: FileItem, signal?: AbortSignal): Promise<ArrayBuffer> {
  const r = await fetch(urlOf(f), { signal })
  if (!r.ok) throw new Error((await r.text().catch(() => '')) || `파일을 불러오지 못했습니다 (${r.status})`)
  return r.arrayBuffer()
}

/** 글자 파일 읽기: UTF-8 이 아니면 EUC-KR(엑셀에서 저장한 CSV 등)로 다시 읽는다 */
export function decodeText(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '')
  } catch {
    try {
      return new TextDecoder('euc-kr').decode(bytes)
    } catch {
      return new TextDecoder('utf-8').decode(bytes)
    }
  }
}
