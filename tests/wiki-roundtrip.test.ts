// @vitest-environment happy-dom
// 위키 마크다운 ↔ 블록 편집기 왕복 테스트.
// 기준: 고치지 않은 문서를 편집기로 읽고 다시 쓰면 바이트 단위로 같다.
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { Marked } from 'marked'
import { buildDoc, serializeBlock, serializeDoc, type PMNode } from '../src/renderer/src/wiki/markdown-model'
import { schemaExtensions } from '../src/renderer/src/wiki/extensions'

const FIXTURES: Record<string, string> = {
  empty: '',
  onlyNewline: '\n',
  korean: '# 알파 프로젝트\n\n3월 릴리스를 목표로 하는 알파 프로젝트 위키입니다.\n여러 줄 문단의 두 번째 줄.\n',
  headings: '# 제목 1\n## 제목 2\n### 제목 3\n\n제목 아래 문단\n\nSetext 제목\n===\n\n#### 4단계 #\n',
  emphasis: '**굵게** *기울임* _밑줄기울임_ ~~취소~~ `코드` ***굵은기울임*** **굵게 [링크](https://a.com) 안쪽**\n',
  escapes: '별표 \\* 밑줄 \\_ 백슬래시 \\\\ 괄호 \\[x\\] 백틱 \\` snake_case_name 1\\. 숫자\n\n\\# 제목 아님\n',
  links: '[링크](https://example.com "제목") <https://auto.link> https://bare.link 그리고 [상대](/wiki/abc) 메일 <mailto:a@b.c>\n',
  images: '![그림](/wikis/123/files/456)\n\n문단 안 ![작은 그림](https://example.com/a.png "t") 이미지\n',
  bullets: '- 하나\n- 둘\n  - 둘-가\n  - 둘-나\n    1. 번호 안\n    2. 번호 둘\n- 셋\n',
  starBullets: '* 별 목록\n* 둘째\n\n+ 더하기 목록\n',
  ordered: '1. 첫째\n2. 둘째\n   - 섞인 글머리\n   - 하나 더\n3. 셋째\n\n5) 다섯부터\n6) 여섯\n',
  looseList: '- 느슨한 목록\n\n- 항목 사이 빈 줄\n\n  두 번째 문단\n',
  tasks: '- [x] 요구사항 정리\n- [ ] 릴리스 체크리스트 확정\n  - [ ] 하위 할 일\n- [ ] QA 일정 공유\n',
  mixedTasks: '- [x] 할 일\n- 그냥 항목\n',
  table: '| 항목 | 담당 | 기한 |\n|---|---|---|\n| 릴리스 범위 | 김공동 | 3/3 |\n| QA 계획 | **박개발** | `3/8` |\n',
  alignedTable: '| 왼쪽 | 가운데 | 오른쪽 |\n|:-----|:------:|------:|\n| a | b | c |\n',
  pipeInTable: '| 식 | 뜻 |\n|---|---|\n| `a\\|b` | 또는 |\n',
  code: '```js\nconst release = new Date(\'2026-03-15\')\n```\n\n~~~\n물결 펜스\n~~~\n\n    들여쓴 코드\n\n````md\n```\n안쪽 펜스\n```\n````\n',
  quote: '> 질문은 창업팀 대화방 `[알파]` 스레드로.\n> 둘째 줄\n>\n> > 중첩 인용\n',
  hr: '위\n\n---\n\n***\n\n___\n\n아래\n',
  toc: '${toc}\n\n# 첫 장\n\n본문\n',
  htmlBlock: '<div align="center">\n  <b>가운데</b>\n</div>\n\n문단\n',
  inlineHtml: '줄<br>바꿈 <span style="color:red">빨강</span>\n',
  entities: 'a &amp; b &lt;태그&gt; &#44;\n',
  hardBreaks: '두 칸 공백  \n다음 줄\\\n백슬래시 줄바꿈\n',
  blankLines: '\n\n\n첫 문단\n\n\n\n둘째 문단\n\n\n',
  noTrailingNewline: '# 끝 줄바꿈 없음\n\n마지막',
  trailingSpaces: '문단 끝 공백   \n\n다음  \n',
  refLinks: '[참조][1] 링크\n\n[1]: https://example.com\n',
  attachmentImage: '아래는 첨부 이미지\n\n![image.png](/wikis/3000000000000000001/files/3000000000000000002)\n\n![](/page-files/123)\n',
  mention: '[@김공동](dooray://1234/members/5678 "member") 님 확인 부탁\n',
  tabs: '-\t탭 목록\n\n\t탭 코드\n',
  dooray: '${toc}\n\n# 알파\n\n| 항목 | 값 |\n| --- | --- |\n| 버전 | 1.0 |\n\n<!-- 주석 -->\n\n- [ ] 할 일\n- [x] 끝\n\n```\n코드\n```\n'
}

const editors: Editor[] = []
afterEach(() => {
  while (editors.length) editors.pop()!.destroy()
})

function loadInEditor(doc: PMNode): Editor {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const editor = new Editor({ element: el, extensions: schemaExtensions(), content: doc })
  editors.push(editor)
  return editor
}

const marked = new Marked({ gfm: true, breaks: false })
const html = (s: string) => (marked.parse(s, { async: false }) as string).replace(/>\n+/g, '>').replace(/\n+</g, '<').trim()

describe('고치지 않은 문서는 바이트 단위로 같다', () => {
  for (const [name, src] of Object.entries(FIXTURES)) {
    it(`${name}: 모델 왕복`, () => {
      const built = buildDoc(src)
      expect(built.fatal).toBeNull()
      expect(serializeDoc(built.doc, built.map)).toBe(src)
    })
    it(`${name}: 실제 편집기(Tiptap)에 넣었다 빼도 같다`, () => {
      const built = buildDoc(src)
      const editor = loadInEditor(built.doc)
      expect(serializeDoc(editor.getJSON() as PMNode, built.map)).toBe(src)
    })
  }
})

describe('편집기 블록 / 원문 블록 구분', () => {
  const kinds = (src: string) => (buildDoc(src).doc.content ?? []).map((n) => n.type)
  it('일반 문법은 편집기 블록이 된다', () => {
    expect(kinds(FIXTURES.korean)).toEqual(['heading', 'paragraph'])
    expect(kinds(FIXTURES.table)).toEqual(['table'])
    expect(kinds(FIXTURES.alignedTable)).toEqual(['table'])
    expect(kinds(FIXTURES.tasks)).toEqual(['taskList'])
    expect(kinds(FIXTURES.bullets)).toEqual(['bulletList'])
    expect(kinds(FIXTURES.ordered)).toEqual(['orderedList', 'orderedList'])
    expect(kinds(FIXTURES.code)).toEqual(['codeBlock', 'codeBlock', 'codeBlock', 'codeBlock'])
    expect(kinds(FIXTURES.quote)).toEqual(['blockquote'])
    expect(kinds(FIXTURES.hr)).toEqual(['paragraph', 'horizontalRule', 'horizontalRule', 'horizontalRule', 'paragraph'])
    expect(kinds(FIXTURES.emphasis)).toEqual(['paragraph'])
    expect(kinds(FIXTURES.escapes)).toEqual(['paragraph', 'paragraph'])
    expect(kinds(FIXTURES.links)).toEqual(['paragraph'])
    expect(kinds(FIXTURES.images)).toEqual(['paragraph', 'paragraph'])
    expect(kinds(FIXTURES.attachmentImage)).toEqual(['paragraph', 'paragraph', 'paragraph'])
    expect(kinds(FIXTURES.hardBreaks)).toEqual(['paragraph'])
    expect(kinds(FIXTURES.pipeInTable)).toEqual(['table'])
  })
  it('두레이 매크로·HTML·엔티티·섞인 체크리스트·링크 정의는 원문 블록으로 보존한다', () => {
    expect(kinds(FIXTURES.toc)).toEqual(['mdRaw', 'heading', 'paragraph'])
    expect(kinds(FIXTURES.htmlBlock)).toEqual(['mdRaw', 'paragraph'])
    expect(kinds(FIXTURES.inlineHtml)).toEqual(['mdRaw'])
    expect(kinds(FIXTURES.entities)).toEqual(['mdRaw'])
    expect(kinds(FIXTURES.mixedTasks)).toEqual(['mdRaw'])
    expect(kinds(FIXTURES.refLinks)).toEqual(['mdRaw', 'mdRaw'])
    expect(kinds(FIXTURES.dooray)).toEqual(['mdRaw', 'heading', 'table', 'mdRaw', 'taskList', 'codeBlock'])
  })
  it('CRLF 문서는 블록 편집을 막는다', () => {
    expect(buildDoc('a\r\nb\r\n').fatal).toMatch(/CRLF/)
  })
})

/** 문서 JSON 에서 n번째 맨 위 블록을 바꾼 복사본 */
function replaceTop(doc: PMNode, index: number, node: PMNode): PMNode {
  const content = [...(doc.content ?? [])]
  content[index] = { ...node, attrs: { ...(node.attrs ?? {}), bid: content[index].attrs?.bid ?? null } }
  return { ...doc, content }
}

describe('한 블록만 고치면 나머지는 원문 그대로', () => {
  it('문단 하나를 고쳐도 다른 블록(이상한 원문 포함)은 바이트 그대로', () => {
    const src = '${toc}\n\n# 제목  \n\n첫 문단 *별* _밑줄_ 강조\n\n* 별 목록\n* 둘째\n\n|a|b|\n|-|-|\n|1|2|\n\n고칠 문단\n\n<div>html</div>\n\n끝 문단\n'
    const built = buildDoc(src)
    const idx = (built.doc.content ?? []).findIndex((n) => JSON.stringify(n).includes('고칠 문단'))
    const doc = replaceTop(built.doc, idx, { type: 'paragraph', content: [{ type: 'text', text: '고친 문단 ' }, { type: 'text', text: '굵게', marks: [{ type: 'bold' }] }] })
    const out = serializeDoc(doc, built.map)
    expect(out).toBe(src.replace('고칠 문단', '고친 문단 **굵게**'))
  })

  it('목록 항목 하나를 고치면 그 목록만 다시 쓰고 의미는 같다', () => {
    const src = '문단\n\n* 별 목록\n* 둘째\n  * 셋째\n\n끝\n'
    const built = buildDoc(src)
    const editor = loadInEditor(built.doc)
    // 둘째 → 둘째(수정)
    let pos = -1
    editor.state.doc.descendants((n, p) => {
      if (n.isText && n.text === '둘째') pos = p + n.nodeSize
    })
    editor.chain().insertContentAt(pos, '(수정)').run()
    const out = serializeDoc(editor.getJSON() as PMNode, built.map)
    expect(out).toBe('문단\n\n* 별 목록\n* 둘째(수정)\n  * 셋째\n\n끝\n')
  })

  it('표 칸 하나를 고쳐도 다른 블록은 그대로', () => {
    const src = '# 회의\n\n| 항목 | 담당 |\n|---|---|\n| 범위 | 김 |\n\n메모\n'
    const built = buildDoc(src)
    const editor = loadInEditor(built.doc)
    let pos = -1
    editor.state.doc.descendants((n, p) => {
      if (n.isText && n.text === '김') pos = p + n.nodeSize
    })
    editor.chain().insertContentAt(pos, '공동').run()
    const out = serializeDoc(editor.getJSON() as PMNode, built.map)
    expect(out).toBe('# 회의\n\n| 항목 | 담당 |\n| --- | --- |\n| 범위 | 김공동 |\n\n메모\n')
  })

  it('새 블록을 끝에 추가하면 빈 줄로 띄우고, 원문 끝 공백은 유지', () => {
    const src = '첫 문단\n'
    const built = buildDoc(src)
    const doc: PMNode = { ...built.doc, content: [...(built.doc.content ?? []), { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '새 제목' }] }] }
    expect(serializeDoc(doc, built.map)).toBe('첫 문단\n\n## 새 제목\n')
  })

  it('블록 순서를 바꾸면 원문 블록 내용은 그대로 옮겨진다', () => {
    const src = '# A\n문단 a\n\n<b>html</b>\n\n끝'
    const built = buildDoc(src)
    const [h, p, raw, end] = built.doc.content!
    const out = serializeDoc({ type: 'doc', content: [raw, h, p, end] }, built.map)
    expect(out).toBe('<b>html</b>\n\n# A\n문단 a\n\n끝')
  })

  it('빈 문단(편집기가 끝에 붙이는 것)은 내보내지 않는다', () => {
    const src = '문단\n'
    const built = buildDoc(src)
    const doc: PMNode = { ...built.doc, content: [...built.doc.content!, { type: 'paragraph' }, { type: 'paragraph' }] }
    expect(serializeDoc(doc, built.map)).toBe(src)
  })

  it('고쳤다가 되돌리면 원문과 같다', () => {
    const src = '_밑줄 기울임_ 문단\n\n* 별\n'
    const built = buildDoc(src)
    const editor = loadInEditor(built.doc)
    editor.chain().insertContentAt(1, 'X').run()
    expect(serializeDoc(editor.getJSON() as PMNode, built.map)).not.toBe(src)
    editor.chain().undo().run()
    expect(serializeDoc(editor.getJSON() as PMNode, built.map)).toBe(src)
  })
})

describe('새로 쓴 마크다운은 뜻이 같다', () => {
  const p = (...content: PMNode[]): PMNode => ({ type: 'paragraph', content })
  const t = (text: string, ...marks: string[]): PMNode => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) })

  it('특수 문자를 이스케이프한다', () => {
    const s = serializeBlock(p(t('# 해시 *별* _밑줄_ [괄호] `틱` <태그> 1. 숫자 ~물결~ snake_case \\')))
    expect(s).toBe('\\# 해시 \\*별\\* \\_밑줄\\_ \\[괄호\\] \\`틱\\` \\<태그> 1. 숫자 \\~물결\\~ snake_case \\\\')
    expect(html(s)).toBe('<p># 해시 *별* _밑줄_ [괄호] `틱` &lt;태그&gt; 1. 숫자 ~물결~ snake_case \\</p>')
  })
  it('줄 머리의 목록·인용 기호를 이스케이프한다', () => {
    for (const line of ['- 하이픈', '+ 더하기', '1. 번호', '> 인용', '---', '===', '## 제목']) {
      const s = serializeBlock(p(t(line)))
      expect(html(s)).toBe(`<p>${line.replace('>', '&gt;')}</p>`)
    }
  })
  it('서식 앞뒤 공백을 서식 밖으로 뺀다', () => {
    expect(serializeBlock(p(t('a'), t(' 굵게 ', 'bold'), t('b')))).toBe('a **굵게** b')
  })
  it('겹친 서식과 링크', () => {
    const link = { type: 'link', attrs: { href: 'https://x.com', title: null } }
    const s = serializeBlock(p({ type: 'text', text: '굵은 ', marks: [{ type: 'bold' }] }, { type: 'text', text: '링크', marks: [{ type: 'bold' }, link] }, { type: 'text', text: ' 끝', marks: [{ type: 'bold' }] }))
    expect(s).toBe('**굵은 [링크](https://x.com) 끝**')
    expect(serializeBlock(p({ type: 'text', text: 'https://x.com', marks: [link] }))).toBe('https://x.com')
  })
  it('코드 안 백틱', () => {
    expect(serializeBlock(p(t('a`b', 'code')))).toBe('``a`b``')
    expect(serializeBlock({ type: 'codeBlock', attrs: { language: 'md' }, content: [t('```\nx\n```')] })).toBe('````md\n```\nx\n```\n````')
  })
  it('표는 GFM 표로', () => {
    const cell = (type: string, text: string): PMNode => ({ type, attrs: { align: null }, content: [p(t(text))] })
    const s = serializeBlock({
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('tableHeader', '가'), cell('tableHeader', '나|다')] },
        { type: 'tableRow', content: [cell('tableCell', '1'), cell('tableCell', '2')] }
      ]
    })
    expect(s).toBe('| 가 | 나\\|다 |\n| --- | --- |\n| 1 | 2 |')
    expect(html(s)).toContain('<th>나|다</th>')
  })
  it('편집기에서 만든 체크리스트·중첩 목록', () => {
    const editor = loadInEditor({ type: 'doc', content: [{ type: 'paragraph' }] })
    editor.commands.setContent('<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>끝</p></li><li data-type="taskItem" data-checked="false"><p>남음</p><ol><li><p>하위</p></li></ol></li></ul>')
    const md = serializeDoc(editor.getJSON() as PMNode, { prefix: '', tail: '\n', blocks: new Map() })
    expect(md).toBe('- [x] 끝\n- [ ] 남음\n  1. 하위\n')
  })
})
