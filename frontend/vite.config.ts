import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    strictPort: true,
    port: 5173
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/dialogPolyfill.ts']
  }
})
