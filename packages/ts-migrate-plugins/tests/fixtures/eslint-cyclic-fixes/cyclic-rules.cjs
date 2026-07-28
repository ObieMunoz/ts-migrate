// Three rules whose fixes cycle a declaration's keyword const -> let -> var ->
// const, standing in for any config whose autofixes undo one another. The
// cycle is three long on purpose: ESLint's own circular-fix detection compares
// a fix round against the one before it, so it catches a two-step cycle but
// not this one.
function swapKeyword(from, to) {
  return {
    meta: { type: 'problem', fixable: 'code', schema: [] },
    create: (context) => ({
      VariableDeclaration: (node) => {
        if (node.kind !== from) return;
        context.report({
          node,
          message: `use ${to}`,
          fix: (fixer) => fixer.replaceTextRange([node.range[0], node.range[0] + from.length], to),
        });
      },
    }),
  };
}

module.exports = {
  rules: {
    'const-to-let': swapKeyword('const', 'let'),
    'let-to-var': swapKeyword('let', 'var'),
    'var-to-const': swapKeyword('var', 'const'),
  },
};
