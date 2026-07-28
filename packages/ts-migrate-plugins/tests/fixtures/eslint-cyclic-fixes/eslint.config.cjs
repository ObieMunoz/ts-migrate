// Flat config fixture whose rules fix each other's fixes forever.
const cyclic = require('./cyclic-rules.cjs');

module.exports = [
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
    },
    plugins: { cyclic },
    rules: {
      'cyclic/const-to-let': 'error',
      'cyclic/let-to-var': 'error',
      'cyclic/var-to-const': 'error',
    },
  },
];
