// 글자 파일 보기: txt, md(렌더링), csv(표), json(정리+강조), 코드(문법 강조·줄 번호).
import { useMemo, useState, type ReactNode } from 'react'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import diff from 'highlight.js/lib/languages/diff'
import dockerfile from 'highlight.js/lib/languages/dockerfile'
import go from 'highlight.js/lib/languages/go'
import groovy from 'highlight.js/lib/languages/groovy'
import ini from 'highlight.js/lib/languages/ini'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import kotlin from 'highlight.js/lib/languages/kotlin'
import php from 'highlight.js/lib/languages/php'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import rust from 'highlight.js/lib/languages/rust'
import scss from 'highlight.js/lib/languages/scss'
import sql from 'highlight.js/lib/languages/sql'
import swift from 'highlight.js/lib/languages/swift'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { CODE_LANG, extOf } from '@shared/types-files'
import { renderMarkdown } from '../../../lib/markdown'
import { decodeText, type FileItem } from '../model'
import { parseCsv } from '../parsers'
import { Loading, useParsed } from './common'
import { SheetTable } from './SheetTable'

const LANGS = { bash, c, cpp, csharp, css, diff, dockerfile, go, groovy, ini, java, javascript, json, kotlin, php, python, ruby, rust, scss, sql, swift, typescript, xml, yaml }
for (const [name, lang] of Object.entries(LANGS)) hljs.registerLanguage(name, lang)

/** 너무 큰 글자 파일은 앞부분만 (화면이 멈추지 않게) */
const MAX_CHARS = 2_000_000
const HIGHLIGHT_MAX = 300_000

const readText = async (buf: ArrayBuffer) => decodeText(buf)

export default function TextView({ f, fallback }: { f: FileItem; fallback: (reason: string) => ReactNode }) {
  const { data, error } = useParsed(f, readText)
  const [raw, setRaw] = useState(false)
  if (error) return <>{fallback(`파일을 열지 못했습니다: ${error}`)}</>
  if (data === null) return <Loading />
  const cut = data.length > MAX_CHARS
  const text = cut ? data.slice(0, MAX_CHARS) : data
  const canToggle = f.kind === 'markdown' || f.kind === 'csv' || f.kind === 'json'
  return (
    <div className="tv">
      {(canToggle || cut) && (
        <div className="tv-bar">
          {cut && <span className="muted small">파일이 커서 앞부분만 보여줍니다.</span>}
          <span className="grow" />
          {canToggle && (
            <div className="seg" role="group" aria-label="보기 방식">
              <button className={!raw ? 'on' : ''} onClick={() => setRaw(false)}>
                보기
              </button>
              <button className={raw ? 'on' : ''} onClick={() => setRaw(true)}>
                원문
              </button>
            </div>
          )}
        </div>
      )}
      <TextBody f={f} text={text} raw={raw} />
    </div>
  )
}

function TextBody({ f, text, raw }: { f: FileItem; text: string; raw: boolean }) {
  if (!raw && f.kind === 'markdown') {
    return (
      <div className="tv-scroll">
        <article className="md tv-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text, { breaks: false }) }} />
      </div>
    )
  }
  if (!raw && f.kind === 'csv') {
    const rows = parseCsv(text, extOf(f.name) === 'tsv' ? '\t' : undefined)
    return <SheetTable rows={rows} header />
  }
  if (f.kind === 'json' && !raw) {
    let pretty = text
    try {
      pretty = JSON.stringify(JSON.parse(text), null, 2)
    } catch {
      /* 형식이 깨졌으면 원문 그대로 */
    }
    return <Code text={pretty} lang="json" />
  }
  if (f.kind === 'code' || f.kind === 'json') return <Code text={text} lang={CODE_LANG[extOf(f.name)] ?? (f.kind === 'json' ? 'json' : undefined)} />
  return <Code text={text} />
}

function Code({ text, lang }: { text: string; lang?: string }) {
  const html = useMemo(() => {
    if (!lang || text.length > HIGHLIGHT_MAX || !hljs.getLanguage(lang)) return null
    try {
      return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value
    } catch {
      return null
    }
  }, [text, lang])
  const lines = useMemo(() => text.split('\n').length, [text])
  return (
    <div className="tv-scroll">
      <div className={`tv-code ${lang ? 'hl' : 'plain'}`}>
        <pre className="tv-lines" aria-hidden>
          {Array.from({ length: lines }, (_, i) => i + 1).join('\n')}
        </pre>
        {/* hljs 결과는 원문을 이스케이프한 span 만 만든다 */}
        {html !== null ? <pre className="tv-src" dangerouslySetInnerHTML={{ __html: html }} /> : <pre className="tv-src">{text}</pre>}
      </div>
    </div>
  )
}
