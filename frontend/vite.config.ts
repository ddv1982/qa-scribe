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
    // Bound JSDOM contention on developer desktops and shared CI hosts.
    maxWorkers: 2,
    // The slowest test takes about two seconds on an idle machine, but shared CI
    // hosts have stalled single tests past ten. This ceiling only catches hangs;
    // assertion failures still surface through waitFor's own one-second limit.
    testTimeout: 30_000,
    setupFiles: ['./src/test/dialogPolyfill.ts']
  }
})
