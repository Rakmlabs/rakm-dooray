import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    // 시험용 패키징 빌드에서만 값이 들어간다 (src/main/buildFlags.ts, scripts/test-build.mjs)
    define: { __RAKM_TEST_BUILD__: JSON.stringify(process.env.RAKM_TEST_BUILD ?? '') }
  },
  preload: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  renderer: {
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [react()]
  }
})
