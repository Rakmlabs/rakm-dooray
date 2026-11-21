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

  async page(wikiId: string, pageId: string): Promise<WikiPage> {
    const p = await this.http.get<RawPage>(`/wiki/v1/wikis/${enc(wikiId)}/pages/${enc(pageId)}`)
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

  /** multipart 에서 type 필드를 file 보다 먼저 보내야 한다 (실측 메모). */
  async uploadFile(wikiId: string, pageId: string, fileName: string, mimeType: string, bytes: Buffer): Promise<void> {
    await this.http.upload(`/wiki/v1/wikis/${enc(wikiId)}/pages/${enc(pageId)}/files`, () => {
      const form = new FormData()
      form.append('type', 'general')
      form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), fileName)
      return form
    })
  }

  downloadFile(wikiId: string, pageId: string, fileId: string): Promise<DownloadedFile> {
    return this.http.download(`/wiki/v1/wikis/${enc(wikiId)}/pages/${enc(pageId)}/files/${enc(fileId)}`)
  }
}

function enc(v: string): string {
  return encodeURIComponent(v)
}
