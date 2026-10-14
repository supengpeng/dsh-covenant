import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/*/tests/**/*.spec.ts',
      'app/tests/**/*.spec.ts',
      'tests/**/*.spec.ts',
    ],
  },
})