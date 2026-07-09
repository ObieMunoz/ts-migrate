/* eslint-disable no-bitwise, no-use-before-define, @typescript-eslint/no-use-before-define */
import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';
import { collectIdentifierNodes } from './utils/identifiers';

/**
 * Converts arrow functions that are referenced before their declaration into
 * function declarations, which hoist. Arrow functions that are only used after
 * their declaration are left alone.
 */
const hoistArrowFunctionsPlugin: Plugin = {
  name: 'hoist-arrow-functions',

  run({ fileName, sourceFile, text, getLanguageService }) {
    const program = getLanguageService().getProgram();
    if (!program) return undefined;

    // Symbols only resolve on the program's own tree.
    const boundSourceFile = program.getSourceFile(fileName) || sourceFile;
    return hoistArrowFunctions(boundSourceFile, text, program.getTypeChecker());
  },
};

export default hoistArrowFunctionsPlugin;

function hoistArrowFunctions(
  sourceFile: ts.SourceFile,
  sourceText: string,
  checker: ts.TypeChecker,
): string {
  const updates: SourceTextUpdate[] = [];
  const allIdentifiers = collectIdentifierNodes(sourceFile);

  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node)) {
      const candidate = getCandidate(node);
      if (candidate && isUsedBeforeDefined(node, candidate.declaration, allIdentifiers, checker)) {
        const index = node.getStart(sourceFile);
        updates.push({
          kind: 'replace',
          index,
          length: node.end - index,
          text: toFunctionDeclarationText(node, candidate, sourceFile, sourceText),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return updateSourceText(sourceText, updates);
}

type Candidate = {
  name: ts.Identifier;
  declaration: ts.VariableDeclaration;
  arrow: ts.ArrowFunction;
};

function getCandidate(statement: ts.VariableStatement): Candidate | undefined {
  if (!ts.isSourceFile(statement.parent) && !ts.isBlock(statement.parent)) return undefined;
  if (
    statement.modifiers &&
    statement.modifiers.some((modifier) => modifier.kind !== ts.SyntaxKind.ExportKeyword)
  ) {
    return undefined;
  }

  const { declarations } = statement.declarationList;
  if (declarations.length !== 1) return undefined;

  const declaration = declarations[0];
  if (!ts.isIdentifier(declaration.name)) return undefined;
  // A variable type annotation has no equivalent on a function declaration.
  if (declaration.type) return undefined;
  if (!declaration.initializer || !ts.isArrowFunction(declaration.initializer)) return undefined;

  const arrow = declaration.initializer;
  if (
    arrow.modifiers &&
    arrow.modifiers.some((modifier) => modifier.kind !== ts.SyntaxKind.AsyncKeyword)
  ) {
    return undefined;
  }
  if (!hasOwnBindings(arrow)) return undefined;

  return { name: declaration.name, declaration, arrow };
}

/**
 * A plain function rebinds `this`, `arguments`, `super`, and `new.target`, so
 * an arrow capturing any of those from the enclosing scope cannot be converted.
 */
function hasOwnBindings(arrow: ts.ArrowFunction): boolean {
  let safe = true;
  const visit = (node: ts.Node) => {
    if (!safe) return;
    if (
      node.kind === ts.SyntaxKind.ThisKeyword ||
      node.kind === ts.SyntaxKind.SuperKeyword ||
      (ts.isIdentifier(node) && node.text === 'arguments') ||
      (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.NewKeyword)
    ) {
      safe = false;
      return;
    }
    // Nested non-arrow functions and classes rebind these themselves.
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isClassLike(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isAccessor(node)
    ) {
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(arrow, visit);
  return safe;
}

function isUsedBeforeDefined(
  statement: ts.VariableStatement,
  declaration: ts.VariableDeclaration,
  allIdentifiers: ts.Identifier[],
  checker: ts.TypeChecker,
): boolean {
  const name = declaration.name as ts.Identifier;
  const references = allIdentifiers.filter(
    (identifier) =>
      identifier !== name &&
      identifier.text === name.text &&
      resolvesToDeclaration(identifier, declaration, checker),
  );

  const statementStart = statement.getStart();
  if (!references.some((reference) => reference.getStart() < statementStart)) {
    return false;
  }

  // A `var` in a nested block is function-scoped, but the converted function
  // declaration would be block-scoped, so references outside the block break.
  const isVar = (statement.declarationList.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) === 0;
  if (isVar && !ts.isSourceFile(statement.parent)) {
    const block = statement.parent;
    return references.every(
      (reference) => reference.pos >= block.pos && reference.end <= block.end,
    );
  }

  return true;
}

function resolvesToDeclaration(
  identifier: ts.Identifier,
  declaration: ts.VariableDeclaration,
  checker: ts.TypeChecker,
): boolean {
  let symbol = ts.isShorthandPropertyAssignment(identifier.parent)
    ? checker.getShorthandAssignmentValueSymbol(identifier.parent)
    : checker.getSymbolAtLocation(identifier);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
    symbol = checker.getAliasedSymbol(symbol);
  }
  return symbol != null && symbol.valueDeclaration === declaration;
}

function toFunctionDeclarationText(
  statement: ts.VariableStatement,
  { name, arrow }: Candidate,
  sourceFile: ts.SourceFile,
  sourceText: string,
): string {
  const isExport =
    statement.modifiers != null &&
    statement.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  const isAsync =
    arrow.modifiers != null &&
    arrow.modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword);

  const lastModifier =
    arrow.modifiers && arrow.modifiers.length > 0
      ? arrow.modifiers[arrow.modifiers.length - 1]
      : undefined;
  const signatureStart = lastModifier ? lastModifier.end : arrow.getStart(sourceFile);
  const signatureEnd = arrow.equalsGreaterThanToken.getStart(sourceFile);
  let signature = sourceText.slice(signatureStart, signatureEnd).trim();
  if (!signature.startsWith('(') && !signature.startsWith('<')) {
    signature = `(${signature})`;
  }

  let bodyText: string;
  if (ts.isBlock(arrow.body)) {
    bodyText = sourceText.slice(arrow.body.getStart(sourceFile), arrow.body.end);
  } else {
    const statementStart = statement.getStart(sourceFile);
    const lineStart =
      statementStart - sourceFile.getLineAndCharacterOfPosition(statementStart).character;
    const lineIndent = sourceText.slice(lineStart, statementStart);
    const indent = /^[ \t]*$/.test(lineIndent) ? lineIndent : '';
    const expression = sourceText.slice(arrow.body.getStart(sourceFile), arrow.body.end);
    bodyText = `{\n${indent}  return ${expression};\n${indent}}`;
  }

  return `${isExport ? 'export ' : ''}${isAsync ? 'async ' : ''}function ${
    name.text
  }${signature} ${bodyText}`;
}
