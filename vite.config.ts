import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type ServerOptions as ProxyOptions } from 'vite'

// Em desenvolvimento, /go2rtc vai para um go2rtc local (porta 1984) e /api para o server/config-api.py (porta 8787).
// Defina GO2RTC_URL para apontar a outro host, ex.: GO2RTC_URL=http://videowall.blizzard.net:1984 npm run dev
const go2rtcTarget = process.env.GO2RTC_URL ?? 'http://127.0.0.1:1984'

const configApiTarget = process.env.CONFIG_API_URL ?? 'http://127.0.0.1:8787'

const proxy: ProxyOptions['proxy'] = {
  '/api': { target: configApiTarget, changeOrigin: true },
  '/go2rtc': {
    target: go2rtcTarget,
    changeOrigin: true,
    ws: true,
    rewrite: (path) => path.replace(/^\/go2rtc/, ''),
    // O go2rtc recusa o WebSocket quando Origin e Host divergem (sempre, atrás de um proxy).
    // Com changeOrigin o Host vira o do go2rtc e rewriteWsOrigin faz o Origin acompanhar.
    // O nginx do container resolve o mesmo problema removendo o Origin.
    rewriteWsOrigin: true,
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: true, proxy },
  preview: { host: true, proxy },
})
