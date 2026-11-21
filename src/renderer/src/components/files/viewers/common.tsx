// 뷰어 공용 작은 조각
import { useEffect, useState } from 'react'
import { fetchBytes, type FileItem } from '../model'

export function Loading({ label = '불러오는 중…' }: { label?: string }) {
  return (
    <div className="fv-center">
      <div className="fspin" aria-hidden />
      <span className="muted">{label}</span>
    </div>
  )
}

/** 파일 바이트를 읽어 parse 로 바꾼다. 결과·오류·로딩 상태를 돌려준다. */
export function useParsed<T>(f: FileItem, parse: (buf: ArrayBuffer) => Promise<T>): { data: T | null; error: string | null } {
  const [state, setState] = useState<{ data: T | null; error: string | null }>({ data: null, error: null })
  useEffect(() => {
    const ac = new AbortController()
    setState({ data: null, error: null })
    fetchBytes(f, ac.signal)
      .then(parse)
      .then((data) => !ac.signal.aborted && setState({ data, error: null }))
      .catch((e: unknown) => !ac.signal.aborted && setState({ data: null, error: e instanceof Error ? e.message : String(e) }))
    return () => ac.abort()
    // parse 는 모듈 수준 함수만 넘긴다 (의존성에 넣지 않는다)
  }, [f])
  return state
}

/** Blob 그림 (주소는 화면에서 사라질 때 해제) */
export function BlobImage({ blob, alt = '' }: { blob: Blob; alt?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url ? <img src={url} alt={alt} /> : null
}
