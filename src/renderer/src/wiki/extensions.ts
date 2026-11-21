// 블록 편집기 스키마 (React 없이). 편집기와 왕복 테스트가 같은 스키마를 쓴다.
import { Extension, Node, mergeAttributes, type AnyExtension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'

/** 맨 위 블록의 원문 연결 ID. HTML 로 나가지 않고(복사·붙여넣기하면 새 블록), 나눌 때 따라가지 않는다. */
const BLOCK_TYPES = ['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock', 'horizontalRule', 'table']

const BlockId = Extension.create({
  name: 'blockId',
  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: { bid: { default: null, keepOnSplit: false, rendered: false, parseHTML: () => null } }
      },
      {
        types: ['bulletList', 'orderedList', 'taskList'],
        attributes: { tight: { default: true, rendered: false, parseHTML: () => true } }
      },
      {
        types: ['bulletList'],
        attributes: { marker: { default: '-', rendered: false, parseHTML: () => '-' } }
      },
      {
        types: ['orderedList'],
        attributes: { delim: { default: '.', rendered: false, parseHTML: () => '.' } }
      },
      {
        types: ['tableCell', 'tableHeader'],
        attributes: {
          align: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.textAlign || null,
            renderHTML: (a: Record<string, unknown>) => (a.align ? { style: `text-align: ${a.align}` } : {})
          }
        }
      }
    ]
  }
})

/** 편집기로 옮기면 뜻이 바뀌는 마크다운을 원문 그대로 보존하는 블록 */
export const MdRaw = Node.create({
  name: 'mdRaw',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      source: { default: '' },
      bid: { default: null, rendered: false, parseHTML: () => null }
    }
  },
  parseHTML() {
    return [{ tag: 'div[data-md-raw]', getAttrs: (el) => ({ source: (el as HTMLElement).getAttribute('data-source') ?? '' }) }]
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-md-raw': '', 'data-source': node.attrs.source }), node.attrs.source]
  }
})

export function schemaExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      underline: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: { openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: 'noopener noreferrer', target: null } },
      codeBlock: { HTMLAttributes: { spellcheck: 'false' } }
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Image.configure({ inline: true, allowBase64: false }),
    MdRaw,
    BlockId
  ]
}
