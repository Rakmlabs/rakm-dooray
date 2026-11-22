// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from '../src/renderer/src/lib/markdown'

describe('코드 블록 표시', () => {
  it('복사 버튼과 언어 표시', () => {
    const html = renderMarkdown('```ts\nconst a: number = 1\n```')
    expect(html).toContain('class="code-copy"')
    expect(html).toContain('data-lang="ts"')
    expect(html).toContain('hljs-keyword')
    expect(renderMarkdown('`x`')).toContain('<code>x</code>')
  })
})
