// TypeScript flat config fixture (core rules only) for the eslint-fix plugin
// test. ESLint needs jiti to read this file at all.
type Rules = Record<string, unknown>;

const rules: Rules = {
  semi: ['error', 'always'],
  'eol-last': ['error', 'always'],
};

export default [
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
    },
    rules,
  },
];
