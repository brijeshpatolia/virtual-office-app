import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The office server (apps/server). In dev the browser talks only to this origin: /api goes to the server and
// /colyseus (HTTP matchmaking and the WebSocket) goes to it without the prefix. The e2e run sets OFFICE_SERVER_URL
// to its own server.
const OFFICE_SERVER = process.env.OFFICE_SERVER_URL ?? 'http://127.0.0.1:2567'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 8000,
    strictPort: true,
    proxy: {
      // xfwd: X-Forwarded-For carries the browser's address, which Better Auth's rate limits key on.
      '/api': { target: OFFICE_SERVER, xfwd: true },
      '/colyseus': { target: OFFICE_SERVER, ws: true, rewrite: (path) => path.replace(/^\/colyseus/, '') },
    },
  },
  preview: { port: 8000 },
  build: {
    outDir: 'dist',
    // Phaser is about 1.4 MB minified, so its own chunk is still above Vite's 500 kB default.
    chunkSizeWarningLimit: 1600,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'phaser', test: /[\\/]node_modules[\\/]phaser[\\/]/ }],
        },
      },
    },
  },
})
