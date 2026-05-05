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
      // anti-pattern. Several of our dialogs use the (legitimate but
      // flagged) "reset form fields when the dialog opens" idiom. The
      // strictly-correct fix is to remount the component on open via a
      // `key` prop or move the state into a child mounted only when
      // open — both worth doing, but neither blocks v0.1.0. Demote to
      // warn until we refactor those callsites.
      // TODO(post-v0.1.0): refactor the flagged Cloud/Relay/Webhook/
      // MessageView dialogs to remount-on-open and re-promote this
      // rule to error.
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
