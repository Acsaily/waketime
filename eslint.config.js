// ESLint flat config (ESLint 10). New rules start in observation mode:
// they are reported as warnings so `npm run lint` documents the gap without
// blocking migration. Promote the actionable rules to "error" once the
// affected code has been migrated and cleaned up.
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'android/**',
      '.toolchain/**',
      '.superpowers/**',
      '.claude/**',
      'out/**',
      'tools/**',
      'docs/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'blob-report/**',
      'tests/tooling/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Observation mode — see file header.
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'warn',
      'no-empty': 'warn',
      'no-constant-condition': 'warn',
      'no-useless-escape': 'warn',
      'no-undef': 'off',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    rules: {
      // JS tooling files are covered by core ESLint rules, not TS rules.
      '@typescript-eslint/no-unused-vars': 'off',
      'no-unused-vars': 'warn',
      'no-empty': 'warn',
    },
  },
);
