import ts from 'typescript';
import { fileNoticeReporter, Plugin, PluginFileNotice } from '@obiemunoz/ts-migrate-server';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';
import createFollowUpMarkers, { FollowUpMarkers } from '../utils/followUpMarker';
import { createValidate, Properties } from '../utils/validateOptions';
import { hasDefaultExport, isEsmSourceFile } from '../utils/moduleFormat';
import {
  collectIdentifiers,
  isAssignmentOperatorKind,
  isIdentifierName,
} from './utils/identifiers';

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
 * A file that calls its own `exports.foo()` from inside a function reads the
 * binding the conversion leaves behind instead, which is what TypeScript's own
 * emit does. That read is a plain call, so a function reaching sibling exports
 * through `this` has to stay as it is; the conversion is skipped when the name
 * is also declared somewhere inside the file.
 *
 * Only top level statements convert. A require inside a function or a branch,
 * a read of `exports` as a whole, and a file that mixes `module.exports = x`
 * with `exports.foo = y` are all left for ts-ignore.
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
    if (!text.includes('require') && !text.includes('module') && !text.includes('exports')) {
      return text;
    }

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

/** The literal argument of a `require('m')` call, or undefined. */
function requireArgument(node: ts.Expression): ts.StringLiteralLike | undefined {
  if (!ts.isCallExpression(node) || node.arguments.length !== 1) return undefined;
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'require') return undefined;
  const [argument] = node.arguments;
  return argument && ts.isStringLiteralLike(argument) ? argument : undefined;
}

/** The raw quoted specifier of a `require('m')` call, or undefined. */
function requireSpecifier(node: ts.Expression, scope: Scope): string | undefined {
  const argument = requireArgument(node);
  return argument && textOf(scope, argument);
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
  return declarations.every((declaration) =>
    bindingNames(declaration.name).every((name) => !scope.assigned.has(name)),
  );
}

/** Every name a binding introduces, flattening any destructuring pattern. */
function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isBindingElement(element) ? bindingNames(element.name) : [],
  );
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
    if (isExportsIdentifier(target) || isModuleExports(target)) {
      named.push({ statement, value: right, name: left.name.text });
      recognized.add(left);
      recognized.add(target);
    }
  });

  if (whole.length === 0 && named.length === 0) return [];

  // The first assignment: the decision is about the file's exports as a whole,
  // and that is where someone reading it would start.
  const leave = leaveExports.bind(null, createFollowUpMarkers(sourceFile), report, [
    ...whole,
    ...named,
  ][0].statement);

  const structural = structuralBlockingReason(scope, whole, named);
  if (structural) return leave(structural);

  const plan =
    whole.length === 1
      ? { updates: wholeExportUpdates(scope, whole[0]), locals: new Map<string, string>() }
      : namedExportPlan(scope, named);
  if (!plan) return leave('an export name is already declared in the file');

  const references = scanExportsReferences(sourceFile, recognized, plan.locals);
  if (references.reason) return leave(references.reason);

  const nested = collectNestedBindingNames(sourceFile);
  const shadowed = references.reads.some((read) => nested.has(plan.locals.get(read.name.text)!));
  if (shadowed) {
    return leave('an exported name is also declared inside the file');
  }

  return [
    ...plan.updates,
    ...references.reads.map((read) => ({
      kind: 'replace' as const,
      index: read.getStart(sourceFile),
      length: read.getEnd() - read.getStart(sourceFile),
      text: plan.locals.get(read.name.text) as string,
    })),
  ];
}

function leaveExports(
  markers: FollowUpMarkers,
  report: (notice: PluginFileNotice) => void,
  site: ts.ExpressionStatement,
  reason: string,
): SourceTextUpdate[] {
  const hint = 'Rewrite these as ES module exports by hand; they are left as they are.';
  const { update, marked } = markers.add(site, { hint, reason });
  report({ reason, hint, recovered: true, marked });
  return update ? [update] : [];
}

function structuralBlockingReason(
  scope: Scope,
  whole: ExportAssignment[],
  named: ExportAssignment[],
): string | undefined {
  if (whole.length > 0 && named.length > 0) {
    return 'the file assigns both module.exports and exports.<name>';
  }
  if (whole.length > 1) return 'the file assigns module.exports more than once';

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
 * Walks the `exports` and `module.exports` references the assignments above did
 * not account for. A read of a name the file itself exports is answered by the
 * binding the conversion leaves behind, the way TypeScript's own emit reads a
 * module's exports. Anything else, a read of `exports` as a whole or an
 * assignment the conversion did not see, leaves the file as it is.
 */
function scanExportsReferences(
  sourceFile: ts.SourceFile,
  recognized: Set<ts.Node>,
  locals: Map<string, string>,
): { reason?: string; reads: ts.PropertyAccessExpression[] } {
  const reads: ts.PropertyAccessExpression[] = [];
  let reason: string | undefined;

  const visit = (node: ts.Node, parent: ts.Node, inFunction: boolean) => {
    if (reason) return;
    if (
      ts.isPropertyAccessExpression(node) &&
      !recognized.has(node) &&
      ts.isIdentifier(node.name) &&
      locals.has(node.name.text) &&
      (isExportsIdentifier(node.expression) || isModuleExports(node.expression))
    ) {
      // A top level read runs before the binding it would become exists.
      if (!inFunction) {
        reason = 'an export is read at the top level of the file';
        return;
      }
      reads.push(node);
      return;
    }
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
    const nested = inFunction || ts.isFunctionLike(node);
    ts.forEachChild(node, (child) => visit(child, node, nested));
  };

  ts.forEachChild(sourceFile, (child) => visit(child, sourceFile, false));
  return { reason, reads };
}

function wholeExportUpdates(scope: Scope, assignment: ExportAssignment): SourceTextUpdate[] {
  const { statement, value } = assignment;

  if (ts.isObjectLiteralExpression(value) && value.properties.length > 0) {
    const lines = objectLiteralExportLines(scope, value);
    if (lines) return [replaceStatement(scope, statement, lines)];
  }

  const exportKeyword = scope.esm ? 'export default' : 'export =';
  // Re-exporting a module wholesale: naming it keeps the specifier an import,
  // where `export = require('m')` would leave a bare require behind.
  const required = requireArgument(value);
  if (required) {
    const alias = moduleAlias(required.text, scope);
    if (alias) {
      const specifier = textOf(scope, required);
      return [
        replaceStatement(scope, statement, [
          scope.esm
            ? `import ${alias} from ${specifier};`
            : `import ${alias} = require(${specifier});`,
          `${exportKeyword} ${alias};`,
        ]),
      ];
    }
  }

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

/**
 * One statement per `exports.<name>` assignment, plus the binding each export
 * name is readable through afterwards.
 */
function namedExportPlan(
  scope: Scope,
  assignments: ExportAssignment[],
): { updates: SourceTextUpdate[]; locals: Map<string, string> } | undefined {
  const updates: SourceTextUpdate[] = [];
  const locals = new Map<string, string>();
  for (const assignment of assignments) {
    const name = assignment.name as string;
    const { value } = assignment;
    const reexport = reexportSpecifier(scope, name, value);
    if (reexport) {
      updates.push(replaceStatement(scope, assignment.statement, [`export { ${reexport} };`]));
      locals.set(name, (value as ts.Identifier).text);
    } else if (scope.names.has(name)) {
      return undefined;
    } else {
      // Only the assignment target is replaced, so a sibling export read
      // inside the value stays a separate, non-overlapping update.
      const index = assignment.statement.getStart(scope.sourceFile);
      updates.push({
        kind: 'replace',
        index,
        length: value.getStart(scope.sourceFile) - index,
        text: `export const ${name} = `,
      });
      locals.set(name, name);
    }
  }
  return { updates, locals };
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

  sourceFile.statements.forEach((statement) => {
    if (ts.isVariableStatement(statement)) {
      const kind = statement.declarationList.flags & ts.NodeFlags.Const ? 'stable' : 'mutable';
      statement.declarationList.declarations.forEach((declaration) =>
        bindingNames(declaration.name).forEach((name) => names.set(name, kind)),
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

/** Every name bound somewhere other than by a top level statement. */
function collectNestedBindingNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const topLevel = new Set<ts.Node>();
  sourceFile.statements.forEach((statement) => {
    if (ts.isVariableStatement(statement)) {
      statement.declarationList.declarations.forEach((declaration) =>
        topLevel.add(declaration.name),
      );
    } else if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name
    ) {
      topLevel.add(statement.name);
    }
  });

  const add = (name: ts.BindingName) => {
    if (topLevel.has(name)) return;
    bindingNames(name).forEach((text) => names.add(text));
  };

  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) {
      add(node.name);
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      add(node.variableDeclaration.name);
    } else if (
      (ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isClassDeclaration(node) ||
        ts.isClassExpression(node)) &&
      node.name &&
      !topLevel.has(node.name)
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
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
  return isAssignmentOperatorKind(node.operatorToken.kind);
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
  if (!isIdentifierName(text)) return undefined;
  return reservedWords.has(text) ? undefined : text;
}

/** A name for a module specifier that the file does not already use. */
function moduleAlias(specifier: string, scope: Scope): string | undefined {
  const segment = specifier
    .replace(/\.[cm]?[jt]sx?$/, '')
    .split('/')
    .filter(Boolean)
    .pop();
  if (!segment) return undefined;
  const camelCased = segment.replace(/[^A-Za-z0-9_$]+(.)?/g, (_match, next: string | undefined) =>
    next ? next.toUpperCase() : '',
  );
  const name = bindableName(camelCased);
  return name && !collectIdentifiers(scope.sourceFile).has(name) ? name : undefined;
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
