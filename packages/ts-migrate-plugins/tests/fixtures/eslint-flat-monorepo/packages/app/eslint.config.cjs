// Flat config fixture that sits under the migration root rather than at the
// working directory, as it does for `ts-migrate migrate packages/app` run
// from a repository root.
module.exports = [
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
    },
    rules: {
      semi: ['error', 'always'],
      'eol-last': ['error', 'always'],
    },
  },
];
