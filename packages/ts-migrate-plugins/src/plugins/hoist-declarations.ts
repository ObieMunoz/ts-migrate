/* eslint-disable no-bitwise, no-use-before-define, @typescript-eslint/no-use-before-define */
import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';
import { collectIdentifierNodes, resolvesToDeclaration } from './utils/identifiers';

/**
 * Moves a top-level `const`/`let` statement above its first use when the binding
 * is referenced before it is declared. This covers declarations that
 * hoist-arrow-functions cannot rewrite into a hoisting `function` declaration —
 * most commonly an HOC-wrapped component, e.g.
 *
 *   const ConnectedWidget = connect(Widget, ...);
 *
 * whose initializer is a call expression rather than a bare arrow function.
 *
 * Relocation runs only when it is provably safe: a single declarator, and every
 * in-file binding the initializer depends on is already defined above the target
 * position. Anything ambiguous is left untouched.
 */
const hoistDeclarationsPlugin: Plugin = {
  name: 'hoist-declarations',

  run({ fileName, sourceFile, text, getLanguageService }) {
    // Purely syntactic candidate scan first: most files have no top-level
    // const/let candidate at all and skip the program entirely.
    if (findCandidates(sourceFile).length === 0) return undefined;

    const program = getLanguageService().getProgram();
    if (!program) return undefined;

    // Symbols only resolve on the program's own tree.
    const boundSourceFile = program.getSourceFile(fileName) || sourceFile;
    return hoistDeclarations(boundSourceFile, text, program.getTypeChecker());
  },
};

export default hoistDeclarationsPlugin;

type Move = { insertIndex: number; deleteStart: number; deleteEnd: number; text: string };

type Candidate = {
  statement: ts.VariableStatement;
  declaration: ts.VariableDeclaration;
  name: ts.Identifier;
  initializer: ts.Expression;
  statementStart: number;
  // Earliest reference appearing before the declaration, if any.
  earliest?: ts.Identifier;
};

function hoistDeclarations(
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

  findEarliestReferences(sourceFile, byName, checker);

  const moves: Move[] = [];
  candidates.forEach((candidate) => {
    const move = planMove(candidate, sourceFile, sourceText, checker);
    if (move) moves.push(move);
  });

  return updateSourceText(sourceText, toNonConflictingUpdates(moves));
}

/**
 * Only top-level statements are considered, so the enclosing scope is the
 * module: dependencies can only be imports or other top-level declarations,
 * which keeps the safety check simple and correct.
 */
function findCandidates(sourceFile: ts.SourceFile): Candidate[] {
  const candidates: Candidate[] = [];
  sourceFile.statements.forEach((statement) => {
    if (!ts.isVariableStatement(statement)) return;
    if (
      statement.modifiers &&
      statement.modifiers.some((modifier) => modifier.kind !== ts.SyntaxKind.ExportKeyword)
    ) {
      return;
    }

    // `var` is function-scoped and hoists on its own; only const/let can be
    // observed before their declaration line, so restrict to those.
    const { flags } = statement.declarationList;
    if ((flags & (ts.NodeFlags.Const | ts.NodeFlags.Let)) === 0) return;

    const { declarations } = statement.declarationList;
    if (declarations.length !== 1) return;

    const declaration = declarations[0];
    const { name, initializer } = declaration;
    if (!ts.isIdentifier(name)) return;
    if (!initializer) return;

    candidates.push({
      statement,
      declaration,
      name,
      initializer,
      statementStart: statement.getStart(sourceFile),
    });
  });
  return candidates;
}

/**
 * One pass over the file recording, per candidate, the earliest reference that
 * appears before its declaration. Position and ordering checks use token `end`
 * (a stored property; tokens cannot straddle a statement start) and run before
 * symbol resolution, so the checker is only consulted for identifiers that
 * could actually be a use-before-declaration.
 */
function findEarliestReferences(
  sourceFile: ts.SourceFile,
  byName: Map<string, Candidate[]>,
  checker: ts.TypeChecker,
): void {
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) {
      const list = byName.get(node.text);
      if (list) {
        list.forEach((candidate) => {
          if (
            node.end <= candidate.statementStart &&
            (!candidate.earliest || node.end < candidate.earliest.end) &&
            resolvesToDeclaration(node, candidate.declaration, checker)
          ) {
            candidate.earliest = node;
          }
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

function planMove(
  candidate: Candidate,
  sourceFile: ts.SourceFile,
  sourceText: string,
  checker: ts.TypeChecker,
): Move | undefined {
  const { statement, initializer, earliest } = candidate;
  if (!earliest) return undefined;

  // The top-level statement that contains the first use; the declaration moves
  // directly above it.
  const target = topLevelAncestor(earliest, sourceFile);
  if (!target || target === statement) return undefined;

  const targetStart = target.getStart(sourceFile);
  if (!dependenciesDefinedBefore(initializer, statement, targetStart, checker)) return undefined;

  // Move whole lines: the statement plus any comment glued directly above it,
  // through the trailing newline. Inserting those lines at the target's own line
  // start places the declaration directly above its first use, followed by one
  // blank line for separation.
  const deleteStart = gluedLineStart(statement, sourceFile, sourceText);
  const statementLinesEnd = lineEndAfterNewline(statement.end, sourceText);
  const insertIndex = gluedLineStart(target, sourceFile, sourceText);

  // Collapse the blank line the move would otherwise leave behind in the hole.
  let deleteEnd = statementLinesEnd;
  const followingLineEnd = lineEndAfterNewline(deleteEnd, sourceText);
  if (
    deleteEnd < sourceText.length &&
    /^[ \t]*\r?\n$/.test(sourceText.slice(deleteEnd, followingLineEnd))
  ) {
    deleteEnd = followingLineEnd;
  }

  return {
    insertIndex,
    deleteStart,
    deleteEnd,
    text: `${sourceText.slice(deleteStart, statementLinesEnd)}\n`,
  };
}

/** Start of the statement's line, extended over a comment glued directly above. */
function gluedLineStart(node: ts.Node, sourceFile: ts.SourceFile, sourceText: string): number {
  const start = node.getStart(sourceFile);
  let lineStart = start - sourceFile.getLineAndCharacterOfPosition(start).character;

  const comments = ts.getLeadingCommentRanges(sourceText, node.getFullStart()) || [];
  for (let i = comments.length - 1; i >= 0; i -= 1) {
    const comment = comments[i];
    // Absorb the comment only when it sits on its own line directly above, with
    // no blank line between it and the current line start.
    if (!/^[ \t]*\r?\n?[ \t]*$/.test(sourceText.slice(comment.end, lineStart))) break;
    const commentLineStart =
      comment.pos - sourceFile.getLineAndCharacterOfPosition(comment.pos).character;
    if (!/^[ \t]*$/.test(sourceText.slice(commentLineStart, comment.pos))) break;
    lineStart = commentLineStart;
  }
  return lineStart;
}

function lineEndAfterNewline(pos: number, sourceText: string): number {
  const newline = sourceText.indexOf('\n', pos);
  return newline === -1 ? sourceText.length : newline + 1;
}

/**
 * Every binding the initializer references from an outer scope must already be
 * defined above the insertion point, otherwise moving the declaration up would
 * turn one of its own dependencies into a use-before-declaration.
 */
function dependenciesDefinedBefore(
  initializer: ts.Expression,
  statement: ts.VariableStatement,
  targetStart: number,
  checker: ts.TypeChecker,
): boolean {
  const identifiers = collectIdentifierNodes(initializer);

  return identifiers.every((identifier) => {
    // Property names (`a.b`, `{ b: ... }`) are not free variable references.
    if (
      (ts.isPropertyAccessExpression(identifier.parent) && identifier.parent.name === identifier) ||
      (ts.isPropertyAssignment(identifier.parent) && identifier.parent.name === identifier)
    ) {
      return true;
    }

    let symbol = checker.getSymbolAtLocation(identifier);
    if (symbol && symbol.flags & ts.SymbolFlags.Alias) {
      symbol = checker.getAliasedSymbol(symbol);
    }
    const dependency = symbol && symbol.valueDeclaration;
    if (!dependency) return true;

    // Bindings declared inside the initializer itself (arrow params, locals)
    // travel with the statement, so they never get crossed.
    if (dependency.pos >= statement.pos && dependency.end <= statement.end) return true;

    // Dependencies in other files can't be reordered by this move.
    if (dependency.getSourceFile() !== statement.getSourceFile()) return true;

    return dependency.getStart() < targetStart;
  });
}

function topLevelAncestor(node: ts.Node, sourceFile: ts.SourceFile): ts.Statement | undefined {
  let current: ts.Node = node;
  while (current.parent && current.parent !== sourceFile) {
    current = current.parent;
  }
  return current.parent === sourceFile ? (current as ts.Statement) : undefined;
}

function toNonConflictingUpdates(moves: Move[]): SourceTextUpdate[] {
  const updates: SourceTextUpdate[] = [];
  const deletes: Array<[number, number]> = [];
  const inserts: number[] = [];

  const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
    aStart < bEnd && bStart < aEnd;

  moves
    .slice()
    .sort((a, b) => a.deleteStart - b.deleteStart)
    .forEach((move) => {
      const conflict =
        deletes.some(([s, e]) => overlaps(move.deleteStart, move.deleteEnd, s, e)) ||
        deletes.some(([s, e]) => move.insertIndex > s && move.insertIndex < e) ||
        inserts.some((p) => p > move.deleteStart && p < move.deleteEnd) ||
        inserts.includes(move.insertIndex);
      if (conflict) return;

      updates.push({ kind: 'insert', index: move.insertIndex, text: move.text });
      updates.push({
        kind: 'delete',
        index: move.deleteStart,
        length: move.deleteEnd - move.deleteStart,
      });
      deletes.push([move.deleteStart, move.deleteEnd]);
      inserts.push(move.insertIndex);
    });

  return updates;
}
