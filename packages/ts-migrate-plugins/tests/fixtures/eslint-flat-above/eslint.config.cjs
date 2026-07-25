// Flat config fixture (core rules only) for the eslint-fix plugin test.
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
