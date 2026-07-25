import ts from 'typescript';
import { fileNoticeReporter, Plugin, PluginFileNotice } from '@obiemunoz/ts-migrate-server';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';
import { createValidate, Properties } from '../utils/validateOptions';
import { hasDefaultExport, isEsmSourceFile } from '../utils/moduleFormat';

/**
 * Rewrites the CommonJS module syntax a renamed file still carries into
 * TypeScript module syntax, so the checker can see across file boundaries.
 * Left alone, `require()` types as `any` once `@types/node` is installed and
 * every import boundary in the project collapses to `any`.
 *
 * The default output is the interop pair that compiles under any
 * `esModuleInterop` setting and emits the same CommonJS it replaced:
 *
 * - `const x = require('m')` -> `import x = require('m')`
 * - `require('m')` -> `import 'm'`
 * - `module.exports = <expression>` -> `export = <expression>`
 *
 * Two shapes get named exports instead, because `export = <expression>` cannot
 * be reached by a named import (TS2497) and named requires are how the rest of
 * the project reads them:
 *
 * - `const { a, b } = require('m')` -> `import { a, b } from 'm'`
 * - `module.exports = { a, b }` and `exports.a = ...` -> `export const`/
 *   `export { }`, when every key is statically known and free in the file
 *
 * Named exports add the non-enumerable `__esModule` marker to the emitted
 * module. `Object.keys(require('./m'))` is unchanged; a consumer that
 * default-imports the whole module object through Babel-style interop sees
 * `undefined` where it used to see the exports object.
 *
 * ESM output (`import x from 'm'`, `export default`) is used when the file is
 * already ESM, by its `.mts` extension, by module syntax it already contains,
 * or by its package's `"type": "module"`. The `esm` option overrides the
 * detection.
 *
 * Only top level statements convert. A require inside a function or a branch,
 * an assignment to `exports` the file also reads, and a file that mixes
 * `module.exports = x` with `exports.foo = y` are all left for ts-ignore.
 */
type Options = {
  esm?: boolean;
};

const optionProperties: Properties = {
  esm: { type: 'boolean' },
};

const convertCommonjsPlugin: Plugin<Options> = {
  name: 'convert-commonjs',

  run(params) {
    const { fileName, sourceFile, text, options } = params;
    if (sourceFile.isDeclarationFile) return text;

    const report = fileNoticeReporter(params, '[convert-commonjs]');
    const esm = options.esm ?? isEsmSourceFile(fileName, sourceFile);
    const scope: Scope = {
      sourceFile,
      text,
      esm,
      eol: text.includes('\r\n') ? '\r\n' : '\n',
      names: collectTopLevelNames(sourceFile),
      assigned: collectAssignedNames(sourceFile),
    };

    const updates = [...convertRequires(scope), ...convertExports(scope, report)];
    return updateSourceText(text, updates);
  },

  validate: createValidate(optionProperties),
};

export default convertCommonjsPlugin;

/** How a top level name is bound, which decides whether it can be re-exported. */
type BindingKind = 'stable' | 'mutable';

type Scope = {
  sourceFile: ts.SourceFile;
  text: string;
  esm: boolean;
  eol: string;
  names: Map<string, BindingKind>;
  assigned: Set<string>;
};

function convertRequires(scope: Scope): SourceTextUpdate[] {
  const { sourceFile } = scope;
  // A file with its own `require` binding is not talking about the CommonJS one.
  if (scope.names.has('require')) return [];

  const updates: SourceTextUpdate[] = [];
  sourceFile.statements.forEach((statement) => {
    if (hasModifiers(statement)) return;

    if (ts.isExpressionStatement(statement)) {
      const specifier = requireSpecifier(statement.expression, scope);
      if (specifier) updates.push(replaceStatement(scope, statement, [`import ${specifier};`]));
      return;
    }

    if (!ts.isVariableStatement(statement)) return;
    const { declarations, flags } = statement.declarationList;
    if (flags & ts.NodeFlags.Using) return;
    // `import` bindings cannot be reassigned, so a `let`/`var` that the file
    // writes to has to stay a variable.
    if (!(flags & ts.NodeFlags.Const) && !declaredNamesAreStable(declarations, scope)) return;

    const lines = declarations.map((declaration) => requireImportLine(declaration, scope));
    if (lines.length === 0 || lines.some((line) => line === undefined)) return;
    updates.push(replaceStatement(scope, statement, lines as string[]));
  });
  return updates;
}

/** The raw quoted specifier of a `require('m')` call, or undefined. */
function requireSpecifier(node: ts.Expression, scope: Scope): string | undefined {
  if (!ts.isCallExpression(node)) return undefined;
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'require') return undefined;
  const [argument] = node.arguments;
  if (node.arguments.length !== 1 || !argument || !ts.isStringLiteralLike(argument)) return undefined;
  return textOf(scope, argument);
}

function requireImportLine(
  declaration: ts.VariableDeclaration,
  scope: Scope,
): string | undefined {
  if (!declaration.initializer) return undefined;
  const specifier = requireSpecifier(declaration.initializer, scope);
  if (!specifier) return undefined;

  const { name } = declaration;
  if (ts.isIdentifier(name)) {
    return scope.esm
      ? `import ${name.text} from ${specifier};`
      : `import ${name.text} = require(${specifier});`;
  }

  if (!ts.isObjectBindingPattern(name) || name.elements.length === 0) return undefined;
  const bindings = name.elements.map((element) => {
    if (element.dotDotDotToken || element.initializer) return undefined;
    if (!ts.isIdentifier(element.name)) return undefined;
    if (!element.propertyName) return element.name.text;
    const property = propertyName(element.propertyName);
    return property && `${property} as ${element.name.text}`;
  });
  if (bindings.some((binding) => binding === undefined)) return undefined;
  return `import { ${bindings.join(', ')} } from ${specifier};`;
}

function declaredNamesAreStable(
  declarations: ts.NodeArray<ts.VariableDeclaration>,
  scope: Scope,
): boolean {
  const isStable = (name: ts.BindingName): boolean => {
    if (ts.isIdentifier(name)) return !scope.assigned.has(name.text);
    return name.elements.every((element) => !ts.isBindingElement(element) || isStable(element.name));
  };
  return declarations.every((declaration) => isStable(declaration.name));
}

/** A top level `module.exports = x` or `exports.foo = x` assignment. */
type ExportAssignment = {
  statement: ts.ExpressionStatement;
  value: ts.Expression;
  /** Undefined for a whole-module assignment. */
  name?: string;
};

function convertExports(
  scope: Scope,
  report: (notice: PluginFileNotice) => void,
): SourceTextUpdate[] {
  const { sourceFile } = scope;
  if (scope.names.has('exports') || scope.names.has('module')) return [];

  const recognized = new Set<ts.Node>();
  const whole: ExportAssignment[] = [];
  const named: ExportAssignment[] = [];

  sourceFile.statements.forEach((statement) => {
    if (!ts.isExpressionStatement(statement)) return;
    const expression = statement.expression;
    if (!ts.isBinaryExpression(expression)) return;
    if (expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return;

    const { left, right } = expression;
    if (isModuleExports(left)) {
      whole.push({ statement, value: right });
      recognized.add(left);
      return;
    }
    if (!ts.isPropertyAccessExpression(left) || !ts.isIdentifier(left.name)) return;
    const target = left.expression;
    if (isExportsIdentifier(target)) {
      named.push({ statement, value: right, name: left.name.text });
      recognized.add(target);
    } else if (isModuleExports(target)) {
      named.push({ statement, value: right, name: left.name.text });
      recognized.add(target);
    }
  });

  if (whole.length === 0 && named.length === 0) return [];

  const blocked = blockingReason(scope, recognized, whole, named);
  if (blocked) {
    report({ reason: blocked, hint: 'Its exports are left as they are.', recovered: true });
    return [];
  }

  const updates =
    whole.length === 1
      ? wholeExportUpdates(scope, whole[0])
      : namedExportUpdates(scope, named);
  if (!updates) {
    report({
      reason: 'an export name is already declared in the file',
      hint: 'Its exports are left as they are.',
      recovered: true,
    });
    return [];
  }
  return updates;
}

function blockingReason(
  scope: Scope,
  recognized: Set<ts.Node>,
  whole: ExportAssignment[],
  named: ExportAssignment[],
): string | undefined {
  if (whole.length > 0 && named.length > 0) {
    return 'the file assigns both module.exports and exports.<name>';
  }
  if (whole.length > 1) return 'the file assigns module.exports more than once';

  const unrecognized = findUnrecognizedExportsReference(scope.sourceFile, recognized);
  if (unrecognized) return unrecognized;

  if (whole.length === 0) {
    const names = named.map((assignment) => assignment.name as string);
    if (new Set(names).size !== names.length) {
      return 'the file assigns the same export name more than once';
    }
    if (names.some((name) => !bindableName(name))) {
      return 'an export name cannot be declared as written';
    }
  }
  if (scope.esm && whole.length === 1 && hasDefaultExport(scope.sourceFile)) {
    return 'the file already has a default export';
  }
  return undefined;
}

/**
 * Any `exports` or `module.exports` reference outside the assignments above:
 * a read, a nested assignment, or an assignment through an element access.
 */
function findUnrecognizedExportsReference(
  sourceFile: ts.SourceFile,
  recognized: Set<ts.Node>,
): string | undefined {
  let reason: string | undefined;
  const visit = (node: ts.Node, parent: ts.Node) => {
    if (reason) return;
    if (isModuleExports(node) && !recognized.has(node)) {
      reason = 'module.exports is used outside a top level assignment';
      return;
    }
    if (
      isExportsIdentifier(node) &&
      !recognized.has(node) &&
      !isNamePosition(node, parent) &&
      !isModuleExports(parent)
    ) {
      reason = 'exports is used outside a top level assignment';
      return;
    }
    ts.forEachChild(node, (child) => visit(child, node));
  };
  ts.forEachChild(sourceFile, (child) => visit(child, sourceFile));
  return reason;
}

function wholeExportUpdates(scope: Scope, assignment: ExportAssignment): SourceTextUpdate[] {
  const { statement, value } = assignment;

  if (ts.isObjectLiteralExpression(value) && value.properties.length > 0) {
    const lines = objectLiteralExportLines(scope, value);
    if (lines) return [replaceStatement(scope, statement, lines)];
  }

  const exportKeyword = scope.esm ? 'export default' : 'export =';
  // A named function or class expression prints unchanged as a declaration,
  // which gives the export a type name the rest of the project can use.
  if (
    (ts.isFunctionExpression(value) || ts.isClassExpression(value)) &&
    value.name &&
    !scope.names.has(value.name.text)
  ) {
    return [
      replaceStatement(scope, statement, [
        textOf(scope, value),
        `${exportKeyword} ${value.name.text};`,
      ]),
    ];
  }

  return [replaceStatement(scope, statement, [`${exportKeyword} ${textOf(scope, value)};`])];
}

function namedExportUpdates(
  scope: Scope,
  assignments: ExportAssignment[],
): SourceTextUpdate[] | undefined {
  const updates: SourceTextUpdate[] = [];
  for (const assignment of assignments) {
    const name = assignment.name as string;
    const line = namedExportLine(scope, name, assignment.value);
    if (!line) return undefined;
    updates.push(replaceStatement(scope, assignment.statement, [line]));
  }
  return updates;
}

function objectLiteralExportLines(
  scope: Scope,
  value: ts.ObjectLiteralExpression,
): string[] | undefined {
  const seen = new Set<string>();
  const lines: string[] = [];
  const reexports: string[] = [];

  for (const property of value.properties) {
    let name: string | undefined;
    let initializer: ts.Expression | undefined;

    if (ts.isShorthandPropertyAssignment(property) && !property.objectAssignmentInitializer) {
      name = property.name.text;
      initializer = property.name;
    } else if (ts.isPropertyAssignment(property)) {
      name = propertyName(property.name);
      initializer = property.initializer;
    }
    if (!name || !initializer || seen.has(name)) return undefined;
    seen.add(name);

    const reexport = reexportSpecifier(scope, name, initializer);
    if (reexport) {
      reexports.push(reexport);
    } else if (!scope.names.has(name)) {
      lines.push(`export const ${name} = ${textOf(scope, initializer)};`);
    } else {
      return undefined;
    }
  }

  if (reexports.length > 0) lines.push(`export { ${reexports.join(', ')} };`);
  return lines;
}

function namedExportLine(
  scope: Scope,
  name: string,
  value: ts.Expression,
): string | undefined {
  const reexport = reexportSpecifier(scope, name, value);
  if (reexport) return `export { ${reexport} };`;
  if (scope.names.has(name)) return undefined;
  return `export const ${name} = ${textOf(scope, value)};`;
}

/**
 * `export { local as name }` for a value that is already a stable top level
 * binding. Re-exporting keeps one binding where a second `const` would either
 * collide or, for `exports.foo = foo`, refer to itself.
 */
function reexportSpecifier(
  scope: Scope,
  name: string,
  value: ts.Expression,
): string | undefined {
  if (!ts.isIdentifier(value)) return undefined;
  if (scope.names.get(value.text) !== 'stable') return undefined;
  return value.text === name ? name : `${value.text} as ${name}`;
}

function collectTopLevelNames(sourceFile: ts.SourceFile): Map<string, BindingKind> {
  const names = new Map<string, BindingKind>();
  const addBindingName = (name: ts.BindingName, kind: BindingKind) => {
    if (ts.isIdentifier(name)) {
      names.set(name.text, kind);
      return;
    }
    name.elements.forEach((element) => {
      if (ts.isBindingElement(element)) addBindingName(element.name, kind);
    });
  };

  sourceFile.statements.forEach((statement) => {
    if (ts.isVariableStatement(statement)) {
      const kind = statement.declarationList.flags & ts.NodeFlags.Const ? 'stable' : 'mutable';
      statement.declarationList.declarations.forEach((declaration) =>
        addBindingName(declaration.name, kind),
      );
    } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.name) names.set(statement.name.text, 'stable');
    } else if (
      ts.isImportEqualsDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isModuleDeclaration(statement)
    ) {
      if (ts.isIdentifier(statement.name)) names.set(statement.name.text, 'stable');
    } else if (ts.isImportDeclaration(statement) && statement.importClause) {
      const { name, namedBindings } = statement.importClause;
      if (name) names.set(name.text, 'stable');
      if (namedBindings && ts.isNamespaceImport(namedBindings)) {
        names.set(namedBindings.name.text, 'stable');
      } else if (namedBindings) {
        namedBindings.elements.forEach((element) => names.set(element.name.text, 'stable'));
      }
    }
  });
  return names;
}

function collectAssignedNames(sourceFile: ts.SourceFile): Set<string> {
  const assigned = new Set<string>();
  const addTarget = (target: ts.Node) => {
    if (ts.isIdentifier(target)) {
      assigned.add(target.text);
    } else if (ts.isObjectLiteralExpression(target)) {
      target.properties.forEach((property) => {
        if (ts.isShorthandPropertyAssignment(property)) assigned.add(property.name.text);
        else if (ts.isPropertyAssignment(property)) addTarget(property.initializer);
        else if (ts.isSpreadAssignment(property)) addTarget(property.expression);
      });
    } else if (ts.isArrayLiteralExpression(target)) {
      target.elements.forEach((element) =>
        addTarget(ts.isSpreadElement(element) ? element.expression : element),
      );
    } else if (ts.isBinaryExpression(target) && isAssignmentOperator(target)) {
      addTarget(target.left);
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isBinaryExpression(node) && isAssignmentOperator(node)) {
      addTarget(node.left);
    } else if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken)
    ) {
      addTarget(node.operand);
    } else if (
      (ts.isForInStatement(node) || ts.isForOfStatement(node)) &&
      !ts.isVariableDeclarationList(node.initializer)
    ) {
      addTarget(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return assigned;
}

function isAssignmentOperator(node: ts.BinaryExpression): boolean {
  return (
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  );
}

function isModuleExports(node: ts.Node): node is ts.PropertyAccessExpression {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'module' &&
    ts.isIdentifier(node.name) &&
    node.name.text === 'exports'
  );
}

function isExportsIdentifier(node: ts.Node): node is ts.Identifier {
  return ts.isIdentifier(node) && node.text === 'exports';
}

/** Whether the identifier names a member rather than referring to a binding. */
function isNamePosition(node: ts.Identifier, parent: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(parent)) return parent.name === node;
  if (ts.isQualifiedName(parent)) return parent.right === node;
  if (ts.isBindingElement(parent)) return parent.propertyName === node;
  if (
    ts.isPropertyAssignment(parent) ||
    ts.isPropertySignature(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isMethodSignature(parent) ||
    ts.isEnumMember(parent)
  ) {
    return parent.name === node;
  }
  return false;
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return bindableName(name.text);
  return undefined;
}

// Words a property can be named but a declaration cannot be bound to.
const reservedWords = new Set(
  `await break case catch class const continue debugger default delete do else enum export
   extends false finally for function if implements import in instanceof interface let new null
   package private protected public return static super switch this throw true try typeof var
   void while with yield`.split(/\s+/),
);

/** The name if it can be declared as written, or undefined. */
function bindableName(text: string): string | undefined {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text)) return undefined;
  return reservedWords.has(text) ? undefined : text;
}

function hasModifiers(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) && (ts.getModifiers(statement)?.length ?? 0) > 0
  );
}

function textOf(scope: Scope, node: ts.Node): string {
  return scope.text.slice(node.getStart(scope.sourceFile), node.getEnd());
}

function replaceStatement(
  scope: Scope,
  statement: ts.Statement,
  lines: string[],
): SourceTextUpdate {
  const index = statement.getStart(scope.sourceFile);
  const lineStart = scope.text.lastIndexOf('\n', index - 1) + 1;
  const prefix = scope.text.slice(lineStart, index);
  const indent = /^[ \t]*$/.test(prefix) ? prefix : '';
  return {
    kind: 'replace',
    index,
    length: statement.getEnd() - index,
    text: lines.join(`${scope.eol}${indent}`),
  };
}
