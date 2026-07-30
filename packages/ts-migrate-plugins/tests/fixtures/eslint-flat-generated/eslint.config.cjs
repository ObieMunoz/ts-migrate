// Flat config fixture shaped like a project that migrated its source and left
// its lint config alone: one entry matches every file the project builds, and
// nothing routes a declaration file to a parser that reads TypeScript, so a
// generated declaration is rejected at its first declaration keyword. The
// ignored path is the other way a project answers that, and this config has to
// keep answering it once it has.
module.exports = [
  {
    ignores: ['types/ignored.d.ts'],
  },
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
