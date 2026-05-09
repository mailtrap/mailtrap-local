/**
 * Loaded by Vitest before each test file. Pulls in @testing-library's
 * DOM matchers (toBeInTheDocument, toHaveClass, etc.) and resets the
 * jsdom document between tests so leftover ports / fragments from one
 * test can't bleed into the next.
 */
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
