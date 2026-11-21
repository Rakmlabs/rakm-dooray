export function formatTime(iso: string | null | number): string {
  if (iso === null || iso === '') return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const time = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return time
  const sameYear = d.getFullYear() === now.getFullYear()
  const date = d.toLocaleDateString('ko-KR', sameYear ? { month: 'short', day: 'numeric' } : undefined)
  return `${date} ${time}`
}

export function formatDay(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })
}

export function formatSize(n: number | null): string {
  if (n === null || n === undefined) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
