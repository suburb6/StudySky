import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '.svelte-kit/**',
      'build/**',
      'build-worker/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'static/ocr-runtime/**'
    ]
  },
  ...tseslint.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte']
      }
    },
    rules: {
      'svelte/no-navigation-without-resolve': 'off',
      'svelte/require-each-key': 'off'
    }
  },
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  },
  prettier
);
