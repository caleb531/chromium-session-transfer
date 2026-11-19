import js from '@eslint/js';
import ts from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-plugin-prettier/recommended';
import globals from 'globals';

// Check the extension, Svelte UI, and native helper with the same rules
export default ts.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs['flat/recommended'],
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, chrome: 'readonly' },
    },
  },
  {
    files: ['**/*.svelte'],
    languageOptions: { parserOptions: { parser: ts.parser } },
  },
  prettier,
);
