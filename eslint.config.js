// Flat ESLint config. Run with `npm run lint`.
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/**'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      'no-console': 'off', // the server logs to stdout by design
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['engine/**/*.js', 'server/**/*.js', 'scripts/**/*.js', 'test/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
];
