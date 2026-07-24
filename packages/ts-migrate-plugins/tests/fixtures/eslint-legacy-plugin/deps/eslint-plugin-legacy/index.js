// Stands in for any plugin written against the ESLint 8 rule context.
// context.getScope() was removed in ESLint 9, so this rule throws for every
// file it visits when a newer engine runs it.
module.exports = {
  rules: {
    'uses-old-api': {
      meta: { type: 'problem', schema: [] },
      create: (context) => ({
        Program: () => {
          context.getScope();
        },
      }),
    },
  },
};
