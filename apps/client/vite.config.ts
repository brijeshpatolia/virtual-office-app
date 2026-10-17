import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: { port: 8000 },
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
