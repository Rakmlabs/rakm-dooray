import type { Wiki, WikiComment, WikiFile, WikiPage, WikiPageSummary } from '@shared/types'
import type { DoorayHttp, DownloadedFile } from './http'

interface RawWiki {
  id: string
  name?: string
  type?: string
  scope?: string
  project?: { id?: string }
  home?: { pageId?: string }
}

interface RawPageSummary {
  id: string
  wikiId?: string
  parentPageId?: string | null
  subject?: string
  root?: boolean
  version?: string | number
  creator?: { member?: { organizationMemberId?: string } }
}

interface RawPage extends RawPageSummary {
  body?: { mimeType?: string; content?: string }
  createdAt?: string
  updatedAt?: string
  files?: RawFile[]
  images?: RawFile[]
}

interface RawFile {
  id: string
  name?: string
  size?: number
  attachFileId?: string
}

interface RawComment {
  id: string
  createdAt?: string
  modifiedAt?: string
  creator?: { member?: { organizationMemberId?: string } }
  body?: { content?: string }
}

const MARKDOWN = 'text/x-markdown'

function summary(p: RawPageSummary, wikiId: string): WikiPageSummary {
  return {
    id: String(p.id),
    wikiId: p.wikiId ? String(p.wikiId) : wikiId,
    parentPageId: p.parentPageId ? String(p.parentPageId) : null,
    subject: p.subject ?? '(제목 없음)',
    root: !!p.root,
    version: String(p.version ?? '')
  }
}

function file(f: RawFile): WikiFile {
  return { id: String(f.id), name: f.name ?? '파일', size: f.size ?? null, attachFileId: f.attachFileId ?? null }
}

export class WikiApi {
  constructor(private readonly http: DoorayHttp) {}

  async wikis(): Promise<Wiki[]> {
    const out: Wiki[] = []
    const size = 100
    for (let page = 0; page < 20; page++) {
      const { result, totalCount } = await this.http.json<RawWiki[]>('GET', '/wiki/v1/wikis', { query: { page, size } })
      const list = result ?? []
      for (const w of list) {
        out.push({
          id: String(w.id),
          name: w.name ?? '(이름 없음)',
          projectId: w.project?.id ?? null,
          homePageId: w.home?.pageId ?? null,
          type: w.type ?? '',
          scope: w.scope ?? ''
        })
      }
      if (list.length < size || (totalCount !== undefined && out.length >= totalCount)) break
    }
    return out
  }

  async pages(wikiId: string, parentPageId: string | null): Promise<WikiPageSummary[]> {
    const list = await this.http.get<RawPageSummary[]>(`/wiki/v1/wikis/${enc(wikiId)}/pages`, {
      parentPageId: parentPageId ?? undefined
    })
    return (list ?? []).map((p) => summary(p, wikiId))
  }

  /**
   * 공식 문서의 페이지 단건 조회는 위키 ID 없이 `GET /wiki/v1/pages/{page-id}` 다.
   * (`/wikis/{wiki-id}/pages/{page-id}` 는 실사용에서 "존재하지 않는 페이지입니다" 로 실패했다.)
   * 응답의 wikiId 를 돌려주므로 댓글·수정·파일 호출은 그 값을 쓴다.
   */
  async page(wikiId: string, pageId: string): Promise<WikiPage> {
    const p = await this.http.get<RawPage>(`/wiki/v1/pages/${enc(pageId)}`)
    return {
      ...summary(p, wikiId),
      content: p.body?.content ?? '',
      mimeType: p.body?.mimeType ?? MARKDOWN,
      createdAt: p.createdAt ?? null,
      updatedAt: p.updatedAt ?? null,
      creatorId: p.creator?.member?.organizationMemberId ?? null,
      files: (p.files ?? []).map(file),
      images: (p.images ?? []).map(file)
    }
  }

  async create(wikiId: string, parentPageId: string | null, subject: string, content: string): Promise<{ id: string }> {
    const body: Record<string, unknown> = { subject, body: { mimeType: MARKDOWN, content } }
    if (parentPageId) body.parentPageId = parentPageId
    const { result } = await this.http.json<{ id: string }>('POST', `/wiki/v1/wikis/${enc(wikiId)}/pages`, { body })
    return { id: String(result?.id ?? '') }
  }

  /**
   * 제목과 본문을 따로 수정한다. 전체 수정(PUT .../pages/{id})은 referrers 를 빼면
   * 참조자가 지워진다는 실측 메모가 있어 쓰지 않는다.
   */
  async update(wikiId: string, pageId: string, subject: string, content: string): Promise<null> {
    const base = `/wiki/v1/wikis/${enc(wikiId)}/pages/${enc(pageId)}`
    await this.http.json('PUT', `${base}/title`, { body: { subject } })
    await this.http.json('PUT', `${base}/content`, { body: { body: { mimeType: MARKDOWN, content } } })
    return null
  }

  /** 제목만 고친다 */
  async updateTitle(wikiId: string, pageId: string, subject: string): Promise<void> {
    await this.http.json('PUT', `/wiki/v1/wikis/${enc(wikiId)}/pages/${enc(pageId)}/title`, { body: { subject } })
  }

  /** 본문만 고친다 */
  async updateContent(wikiId: string, pageId: string, content: string): Promise<void> {
    await this.http.json('PUT', `/wiki/v1/wikis/${enc(wikiId)}/pages/${enc(pageId)}/content`, {
      body: { body: { mimeType: MARKDOWN, content } }
    })
  }

  async move(wikiId: string, pageId: string, targetParentPageId: string): Promise<null> {
    await this.http.json('POST', `/wiki/v1/wikis/${enc(wikiId)}/pages/${enc(pageId)}/move`, {
      body: { targetParentPageId }
    })
    return null
  }

  async remove(wikiId: string, pageId: string): Promise<null> {
    await this.http.json('DELETE', `/wiki/v1/wikis/${enc(wikiId)}/pages/${enc(pageId)}`)
    return null
  }

  async comments(wikiId: string, pageId: string): Promise<WikiComment[]> {
    const list = await this.http.get<RawComment[]>(`/wiki/v1/wikis/${enc(wikiId)}/pages/${enc(pageId)}/comments`, {
      page: 0,
      size: 100
    })
    return (list ?? []).map((c) => ({
      id: String(c.id),
      creatorId: c.creator?.member?.organizationMemberId ?? null,
      createdAt: c.createdAt ?? null,
      modifiedAt: c.modifiedAt ?? null,
      content: c.body?.content ?? ''
    }))
  }

  async addComment(wikiId: string, pageId: string, content: string): Promise<null> {
    await this.http.json('POST', `/wiki/v1/wikis/${enc(wikiId)}/pages/${enc(pageId)}/comments`, {
      body: { body: { content } }
    })
    return null
  }

  async updateComment(wikiId: string, pageId: string, commentId: string, content: string): Promise<null> {
    await this.http.json('PUT', `/wiki/v1/wikis/${enc(wikiId)}/pages/${enc(pageId)}/comments/${enc(commentId)}`, {
      body: { body: { content } }
    })
    return null
  }

  async deleteComment(wikiId: string, pageId: string, commentId: string): Promise<null> {
    await this.http.json('DELETE', `/wiki/v1/wikis/${enc(wikiId)}/pages/${enc(pageId)}/comments/${enc(commentId)}`)
    return null
  }

  /**
   * multipart 에서 type 필드를 file 보다 먼저 보내야 한다 (공식 문서).
   * type: general(첨부) | inline_image(본문 이미지). 응답 result 에 id, attachFileId, name 이 온다 (공식 문서 예시).
   */
  async uploadFile(
    wikiId: string,
    pageId: string,
    fileName: string,
    mimeType: string,
    bytes: Buffer,
    type: 'general' | 'inline_image' = 'general'
  ): Promise<{ id: string; attachFileId: string | null; name: string }> {
    const r = await this.http.upload<{ id?: string | number; attachFileId?: string | number; name?: string } | null>(
      `/wiki/v1/wikis/${enc(wikiId)}/pages/${enc(pageId)}/files`,
      () => {
        const form = new FormData()
        form.append('type', type)
        form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), fileName)
        return form
      }
    )
    return {
      id: String(r?.id ?? ''),
      attachFileId: r?.attachFileId !== undefined && r?.attachFileId !== null ? String(r.attachFileId) : null,
      name: r?.name ?? fileName
    }
  }

  /** 본문 이미지 경로 /wikis/{wikiId}/files/{attachFileId} 의 파일 (공식: GET /wiki/v1/wikis/{wikiId}/attachFiles/{attachFileId}) */
  downloadAttachFile(wikiId: string, attachFileId: string): Promise<DownloadedFile> {
    return this.http.download(`/wiki/v1/wikis/${enc(wikiId)}/attachFiles/${enc(attachFileId)}`)
  }

  downloadFile(wikiId: string, pageId: string, fileId: string): Promise<DownloadedFile> {
    return this.http.download(`/wiki/v1/wikis/${enc(wikiId)}/pages/${enc(pageId)}/files/${enc(fileId)}`)
  }
}

function enc(v: string): string {
  return encodeURIComponent(v)
}

/** 본문 이미지 경로가 가리키는 두레이 파일. 두레이 경로가 아니면 null (임의 주소로 토큰을 보내지 않는다). */
export type WikiImageRef = { kind: 'attach'; wikiId: string; attachFileId: string } | { kind: 'pageFile'; fileId: string }

const DOORAY_HOST = /(^|\.)(dooray\.com|dooray\.co\.kr|gov-dooray\.com|gov-dooray\.co\.kr)$/i

export function parseWikiImageSrc(src: string): WikiImageRef | null {
  let path = src.trim()
  if (/^https?:\/\//i.test(path)) {
    let u: URL
    try {
      u = new URL(path)
    } catch {
      return null
    }
    if (u.protocol !== 'https:' || !DOORAY_HOST.test(u.hostname)) return null
    path = u.pathname
  } else if (!path.startsWith('/')) return null
  path = path.split(/[?#]/)[0]
  let m = path.match(/^\/wikis\/([^/]+)\/files\/([^/]+)\/?$/)
  if (m) return { kind: 'attach', wikiId: m[1], attachFileId: m[2] }
  // 공식 형식은 아니지만 웹 화면에서 보이는 경로 (불확실)
  m = path.match(/^\/(?:page-files|files)\/(\d+)\/?$/)
  if (m) return { kind: 'pageFile', fileId: m[1] }
  return null
}
