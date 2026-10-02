import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules/**', '.next/**']
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src')
    }
  }
})
