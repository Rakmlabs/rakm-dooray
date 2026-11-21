// Word(docx) 보기: docx-preview 로 이 컴퓨터 안에서 그린다.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { renderAsync } from 'docx-preview'
import { fetchBytes, type FileItem } from '../model'
import { Loading } from './common'

export default function DocxView({ f, fallback }: { f: FileItem; fallback: (reason: string) => ReactNode }) {
  const body = useRef<HTMLDivElement>(null)
  const styles = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<'loading' | 'ok' | string>('loading')

  useEffect(() => {
    const ac = new AbortController()
    setState('loading')
    ;(async () => {
      try {
        const buf = await fetchBytes(f, ac.signal)
        if (ac.signal.aborted || !body.current) return
        body.current.innerHTML = ''
        await renderAsync(buf, body.current, styles.current ?? undefined, {
          className: 'docx',
          inWrapper: true,
          breakPages: true,
          ignoreFonts: true, // 내장 글꼴은 쓰지 않는다 (CSP font-src 를 넓히지 않기 위해)
          ignoreLastRenderedPageBreak: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          experimental: false,
          useBase64URL: false
        })
        // 글머리표가 Symbol/Wingdings 글꼴의 사설 영역 문자(U+F0B7 등)라 글꼴 없이 네모로 보인다 → 일반 기호로
        styles.current?.querySelectorAll('style').forEach((st) => {
          st.textContent = (st.textContent ?? '').replace(/[\uf06e\uf076\uf0a7\uf0a8\uf0b7\uf0d8\uf0fc]/g, (c) =>
            c === '\uf0a7' || c === '\uf0a8' || c === '\uf06e' ? '▪' : '•'
          )
        })
        // 문서 안 링크는 외부 브라우저로 (main 의 창 열기 처리기가 http(s) 만 연다)
        body.current.querySelectorAll('a[href]').forEach((a) => {
          a.setAttribute('target', '_blank')
          a.setAttribute('rel', 'noopener noreferrer')
        })
        if (!ac.signal.aborted) setState('ok')
      } catch (e) {
        if (!ac.signal.aborted) setState(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => ac.abort()
  }, [f])

  const failed = state !== 'loading' && state !== 'ok'
  return (
    <div className="dv">
      {state === 'loading' && <Loading />}
      {failed && fallback(`문서를 열지 못했습니다: ${state}`)}
      <div ref={styles} />
      <div ref={body} className="dv-scroll" hidden={state !== 'ok'} />
    </div>
  )
}
