const tseslint = require('typescript-eslint');

// Root config for ts-migrate and ts-migrate-server; their lint scripts run
// `eslint .` from the package directory and find this file via ancestor
// lookup. ts-migrate-plugins has its own eslint.config.js.
module.exports = tseslint.config(
  {
    ignores: [
      '**/build/',
      '**/tests/commands/migrate/ast-input/',
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
      // Migration test fixtures carry eslint-disable comments as data.
      reportUnusedDisableDirectives: 'off',
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
  {
    // Command fixtures are test data: unused identifiers and `{}` types are
    // the inputs and expected outputs of the migrations under test.
    files: ['**/tests/commands/*/input/**', '**/tests/commands/*/output/**'],
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    // Flat config only lints extensions matched by a `files` pattern; keep
    // the .jsx rename fixtures covered.
    files: ['**/*.jsx'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
);
