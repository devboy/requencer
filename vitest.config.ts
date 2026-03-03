import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    exclude: ['.worktrees/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov', 'json-summary'],
      exclude: [
        '**/*.bench.ts',
        '**/*.test.ts',
        '**/*.config.ts',
        'node_modules/**',
        'dist/**',
      ],
    },
  },
})
