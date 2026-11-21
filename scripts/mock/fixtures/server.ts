import { createServer } from 'node:http'

// 간단한 상태 확인 서버
interface Health {
  ok: boolean
  uptime: number
}

const started = Date.now()

export function health(): Health {
  return { ok: true, uptime: Math.round((Date.now() - started) / 1000) }
}

createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify(health()))
  }
  res.writeHead(404).end('not found')
}).listen(3000)
