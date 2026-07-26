const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: ['build/', 'tests/fixtures/'],
  },
  tseslint.configs.recommended,
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      // This package's plugins generate `any` types by design.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Writes go through updatable-log; `important` prints regardless of quiet.
    files: ['src/**/*.ts'],
    rules: {
      'no-console': 'error',
    },
  },
);
