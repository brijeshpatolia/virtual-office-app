import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/src/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    // Booting PGlite and applying the migrations takes 3-5 s, more on a cold CI runner.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
