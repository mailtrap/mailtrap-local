import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Go backend on :3550 in dev. Override with VITE_API_TARGET.
const apiTarget = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:3550'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '127.0.0.1',
    port: 3540,
    proxy: {
      '/api': apiTarget,
      '/cable': { target: apiTarget.replace(/^http/, 'ws'), ws: true },
    },
  },
})
