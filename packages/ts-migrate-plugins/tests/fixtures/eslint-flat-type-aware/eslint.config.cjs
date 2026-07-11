// Flat config fixture whose parserOptions request type-aware linting; the
// eslint-fix plugin must keep such configs in-process instead of multiplying
// TypeScript programs across its worker pool. (espree ignores the option, so
// the core rules still fix.)
module.exports = [
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      semi: ['error', 'always'],
      'eol-last': ['error', 'always'],
    },
  },
];
