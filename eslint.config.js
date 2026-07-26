const tseslint = require('typescript-eslint');

// Root config for ts-migrate and ts-migrate-server; their lint scripts run
// `eslint .` from the package directory and find this file via ancestor
// lookup. ts-migrate-plugins has its own eslint.config.js.
module.exports = tseslint.config(
  {
    ignores: [
      '**/build/',
      // Every checked-in fixture tree lives here. They are inputs and expected
      // outputs of the migrations under test: intentionally broken code,
      // carrying eslint-disable comments as data.
      '**/tests/fixtures/',
      '**/tests/tmp/',
      // Linted by its own eslint.config.js.
      'packages/ts-migrate-plugins/',
      // No lint script; src/input holds intentionally unmigrated code.
      'packages/ts-migrate-example/',
      '.claude/',
    ],
  },
  tseslint.configs.recommended,
  {
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      // This repo's tooling generates and manipulates `any` types by design.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-useless-constructor': 'error',
    },
  },
);
