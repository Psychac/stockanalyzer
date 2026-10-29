import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { breezeHelper } from './vite/breezeHelper'

export default defineConfig(({ command, mode }) => {
// Read app/.env too (process.env alone does not see it).
const origin = loadEnv(mode, process.cwd(), '').MARKET_DATA_ORIGIN?.trim()
if (command === 'serve' && mode !== 'test' && !origin) console.warn('[stock-analyzer] MARKET_DATA_ORIGIN is not set, so dev and preview have no market data or sign-in backend. Set it in app/.env to a deployment you trust (see .env.example).')
// Local development has no api/data functions, so market data and sign-in come from a deployment you name. There is no default:
// a default would send every clone of this repo to someone else's server.
const proxy = origin ? Object.fromEntries(['/api/data', '/api/auth'].map(p => [p, { target: origin, changeOrigin: true }])) : {}
return {
  base: './',
  plugins: [
    react(),
    breezeHelper(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // API calls (the Breeze relay) must always reach the network, never the app shell.
      workbox: { navigateFallbackDenylist: [/^\/api\//] },
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Stock Analyzer',
        short_name: 'StockAnalyzer',
        description: 'Local-first stock research and trade planning for Indian equities',
        theme_color: '#0b0f17',
        background_color: '#0b0f17',
        display: 'standalone',
        start_url: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: { proxy },
  preview: { proxy },
  test: { include: ['src/**/*.test.ts', 'api/**/*.test.ts'] },
}
})
