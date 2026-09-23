import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next'],
  },
  resolve: {
    // Mirror the tsconfig path aliases; '@shared' must precede the broader '@'.
    alias: [
      { find: '@shared', replacement: resolve(root, '../shared') },
      { find: '@', replacement: root },
    ],
  },
})
