import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@tiptap') || id.includes('prosemirror')) return 'editor'
          if (id.includes('lucide-react')) return 'icons'
          return 'vendor'
        }
      }
    }
  },
  server: {
    strictPort: true,
    port: 5173
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/dialogPolyfill.ts']
  }
})
