import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'src-tauri/target', 'src-tauri/gen', 'node_modules'] },

  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // A password manager has no business using a non-cryptographic RNG. The
      // generator must go through `crypto.getRandomValues`; this rule makes a
      // slip a build failure rather than a silent weakness.
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'Math.random is not cryptographically secure. Use crypto.getRandomValues (see src/crypto/random.ts).',
        },
      ],
    },
  },

  // The vault, crypto and sync layers must stay platform-agnostic. Reaching for
  // a Tauri API here would quietly break the Android build and make these
  // modules untestable under Node, so it is an error rather than a convention.
  {
    files: ['src/vault/**/*.ts', 'src/crypto/**/*.ts', 'src/sync/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@tauri-apps/*', '@/platform/tauri/*'],
              message:
                'The vault, crypto and sync layers must not depend on the platform. Depend on an interface from src/platform/ports.ts and let the caller inject the implementation.',
            },
          ],
        },
      ],

      // Secrets pass through these modules. Nothing here logs, including inside
      // error handlers — an error object built from a decrypted value would
      // otherwise end up in a devtools console or a crash report.
      'no-console': 'error',
    },
  },

  {
    files: ['tests/**/*.ts', '*.config.ts', '*.config.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
