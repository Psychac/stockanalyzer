import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { breezeHelper } from './vite/breezeHelper'

export default defineConfig({
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
  test: { include: ['src/**/*.test.ts', 'api/**/*.test.ts'] },
})
