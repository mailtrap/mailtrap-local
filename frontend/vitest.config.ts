/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Vitest config — separate from `vite.config.ts` because the prod build
 * doesn't need Tailwind in the test pipeline (DOM assertions don't care
 * about computed classes), and pulling the Tailwind plugin into the test
 * harness would slow startup.
 *
 * Tests live alongside the code under test as `*.test.ts` / `*.test.tsx`.
 * See `src/test/setup.ts` for the @testing-library/jest-dom matchers.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/main.tsx',
        'src/lib/prism-langs.ts',
        'src/lib/prism-setup.ts',
      ],
    },
  },
})
