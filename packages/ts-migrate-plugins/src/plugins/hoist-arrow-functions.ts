/* eslint-disable no-bitwise, no-use-before-define, @typescript-eslint/no-use-before-define */
import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';

/**
 * Converts arrow functions that are referenced before their declaration into
 * function declarations, which hoist. Arrow functions that are only used after
 * their declaration are left alone.
 */
const hoistArrowFunctionsPlugin: Plugin = {
  name: 'hoist-arrow-functions',

  run({ fileName, sourceFile, text, getLanguageService }) {
    // Purely syntactic candidate scan first: most files have no convertible
    // arrow function at all and skip the program entirely.
    if (findCandidates(sourceFile).length === 0) return text;

    const program = getLanguageService().getProgram();
    if (!program) return undefined;

    // Symbols only resolve on the program's own tree.
    const boundSourceFile = program.getSourceFile(fileName) || sourceFile;
    return hoistArrowFunctions(boundSourceFile, text, program.getTypeChecker());
  },
};

export default hoistArrowFunctionsPlugin;

type Candidate = {
  statement: ts.VariableStatement;
  name: ts.Identifier;
  declaration: ts.VariableDeclaration;
  arrow: ts.ArrowFunction;
  statementStart: number;
  // Set for a `var` in a nested block: it is function-scoped, but the
  // converted function declaration would be block-scoped, so references
  // outside the block disqualify the candidate.
  block?: ts.Block;
  usedBefore?: boolean;
  escapesBlock?: boolean;
};

function hoistArrowFunctions(
  sourceFile: ts.SourceFile,
  sourceText: string,
  checker: ts.TypeChecker,
): string {
  const candidates = findCandidates(sourceFile);
  if (candidates.length === 0) return sourceText;

  const byName = new Map<string, Candidate[]>();
  candidates.forEach((candidate) => {
    const list = byName.get(candidate.name.text);
    if (list) {
      list.push(candidate);
    } else {
      byName.set(candidate.name.text, [candidate]);
    }
  });

  findReferences(sourceFile, byName, checker);

  const updates: SourceTextUpdate[] = [];
  candidates.forEach((candidate) => {
    if (!candidate.usedBefore || candidate.escapesBlock) return;
    updates.push({
      kind: 'replace',
      index: candidate.statementStart,
      length: candidate.statement.end - candidate.statementStart,
      text: toFunctionDeclarationText(candidate.statement, candidate, sourceFile, sourceText),
    });
  });

  return updateSourceText(sourceText, updates);
}

function findCandidates(sourceFile: ts.SourceFile): Candidate[] {
  const candidates: Candidate[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node)) {
      const candidate = getCandidate(node, sourceFile);
      if (candidate) candidates.push(candidate);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return candidates;
}

function getCandidate(
  statement: ts.VariableStatement,
  sourceFile: ts.SourceFile,
): Candidate | undefined {
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

  const isVar = (statement.declarationList.flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) === 0;
  return {
    statement,
    name: declaration.name,
    declaration,
    arrow,
    statementStart: statement.getStart(sourceFile),
    block: isVar && ts.isBlock(statement.parent) ? statement.parent : undefined,
  };
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

/**
 * One pass over the file recording, per candidate, whether it is referenced
 * before its declaration and, for a nested `var`, whether any reference
 * escapes the enclosing block. Position checks use token `end` (a stored
 * property; tokens cannot straddle a statement start) and run before symbol
 * resolution, so the checker is only consulted for identifiers that could
 * still change the outcome.
 */
function findReferences(
  sourceFile: ts.SourceFile,
  byName: Map<string, Candidate[]>,
  checker: ts.TypeChecker,
): void {
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) {
      const list = byName.get(node.text);
      if (list) {
        list.forEach((candidate) => {
          if (node === candidate.name || candidate.escapesBlock) return;
          const before = !candidate.usedBefore && node.end <= candidate.statementStart;
          const escapes =
            candidate.block != null &&
            (node.pos < candidate.block.pos || node.end > candidate.block.end);
          if ((before || escapes) && resolvesToDeclaration(node, candidate.declaration, checker)) {
            if (before) candidate.usedBefore = true;
            if (escapes) candidate.escapesBlock = true;
          }
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
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
