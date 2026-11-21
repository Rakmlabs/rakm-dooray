import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    // 설정 화면의 "현재 버전" 표시용 (자동 업데이트는 넣지 않는다)
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    plugins: [react()]
  }
})
