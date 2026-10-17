import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig(
  globalIgnores(['**/dist/', '**/node_modules/', '**/coverage/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['apps/client/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['*.{js,ts}', 'apps/*/*.{js,ts}', 'packages/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
)
