import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Recognise `_`-prefixed locals/args as intentionally unused.
      // Without this, destructuring throwaway tuple members (e.g.
      // `const { key: _k, ...rest }`) trips no-unused-vars.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // react-hooks v7+ flags every setState inside a useEffect as an
      // anti-pattern. Most of the flag-able callsites in this repo
      // were the "reset form fields when the dialog opens" idiom —
      // those are refactored to mount-on-open via a child <Body>
      // component (Cloud / Relay / Webhook). The remaining warnings
      // are legitimate uses we don't plan to refactor:
      //
      //   - useXxxConnection.tsx: provider on mount triggers a
      //     `refresh()` that calls setState inside the effect.
      //   - Sidebar: auto-mark-as-read on activeId change, search
      //     debounce reset.
      //   - MessageView: per-message state reset on route :id change.
      //   - RelayConnectDialog: SMTP probe debounce.
      //
      // Each is a textbook case of the pattern (debouncer or
      // sync-with-prop-change). We accept the rule warning rather
      // than do an awkward refactor. Stays at `warn` so new
      // accidental introductions are still flagged.
      'react-hooks/set-state-in-effect': 'warn',

      // The `useXxxConnection.tsx` files deliberately colocate the
      // Provider component with its consumer hook (`useCloudConnection`,
      // `useRelayConnection`, `useWebhookConnection`). The Vite Fast
      // Refresh plugin prefers each file export only components for
      // reliable HMR; we trade a marginal HMR loss for the tighter
      // colocation. Demote to warn.
      'react-refresh/only-export-components': 'warn',
    },
  },
])
