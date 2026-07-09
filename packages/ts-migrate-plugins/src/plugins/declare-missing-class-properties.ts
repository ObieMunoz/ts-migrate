import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import { isDiagnosticWithLinePosition } from '../utils/type-guards';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';
import { AnyAliasOptions, validateAnyAliasOptions } from '../utils/validateOptions';

type Options = AnyAliasOptions;

const declareMissingClassPropertiesPlugin: Plugin<Options> = {
  name: 'declare-missing-class-properties',

  run({ fileName, sourceFile, getLanguageService, options }) {
    const diagnostics = getLanguageService()
      .getSemanticDiagnostics(fileName)
      .filter(isDiagnosticWithLinePosition)
      .filter((diagnostic) => diagnostic.code === 2339 || diagnostic.code === 2551);

    const anyType = options.anyAlias ?? 'any';
    const toAdd = new Map<ts.ClassLikeDeclaration, Set<string>>();

    diagnostics.forEach((diagnostic) => {
      const node = findNodeAtSpan(sourceFile, diagnostic);
      if (!node || !ts.isIdentifier(node)) return;
      const access = node.parent;
      if (
        !ts.isPropertyAccessExpression(access) ||
        access.name !== node ||
        access.expression.kind !== ts.SyntaxKind.ThisKeyword
      ) {
        return;
      }

      const classDeclaration = findEnclosingClass(access);
      if (classDeclaration) {
        let propertyNames = toAdd.get(classDeclaration);
        if (!propertyNames) {
          propertyNames = new Set();
          toAdd.set(classDeclaration, propertyNames);
        }
        propertyNames.add(node.text);
      }
    });

    const updates: SourceTextUpdate[] = [];
    toAdd.forEach((propertyNameSet, classDeclaration) => {
      const propertyNames = Array.from(propertyNameSet)
        .filter((propertyName) => {
          const existingProperty = classDeclaration.members.find(
            (member) =>
              ts.isPropertyDeclaration(member) &&
              ts.isIdentifier(member.name) &&
              member.name.text === propertyName,
          );
          return existingProperty == null;
        })
        .sort();
      if (propertyNames.length === 0) return;

      // Declarations go after the last static property, so instance properties
      // don't separate the statics from each other.
      let anchor: ts.ClassElement | undefined;
      classDeclaration.members.forEach((member) => {
        if (
          ts.isPropertyDeclaration(member) &&
          member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)
        ) {
          anchor = member;
        }
      });

      const index = anchor != null ? anchor.end : getOpenBraceEnd(classDeclaration, sourceFile);
      const indent = getMemberIndentation(classDeclaration, anchor, sourceFile);
      const text = propertyNames
        .map((propertyName) => `\n${indent}${propertyName}: ${anyType};`)
        .join('');
      updates.push({ kind: 'insert', index, text });
    });

    return updateSourceText(sourceFile.text, updates);
  },

  validate: validateAnyAliasOptions,
};

export default declareMissingClassPropertiesPlugin;

/** The innermost node whose span matches the diagnostic exactly. */
function findNodeAtSpan(
  sourceFile: ts.SourceFile,
  diagnostic: ts.DiagnosticWithLocation,
): ts.Node | undefined {
  const end = diagnostic.start + diagnostic.length;
  let result: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (node.getStart(sourceFile) > diagnostic.start || node.end < end) return;
    if (node.getStart(sourceFile) === diagnostic.start && node.end === end) {
      result = node;
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return result;
}

function findEnclosingClass(node: ts.Node): ts.ClassLikeDeclaration | undefined {
  let cur: ts.Node | undefined = node;
  while (cur && !ts.isSourceFile(cur)) {
    if (ts.isClassLike(cur)) {
      return cur;
    }

    // These rebind `this`, so the member expression does not refer to the
    // enclosing class instance.
    if (ts.isFunctionDeclaration(cur) || ts.isFunctionExpression(cur)) {
      return undefined;
    }
    if (
      (ts.isMethodDeclaration(cur) || ts.isAccessor(cur)) &&
      ts.isObjectLiteralExpression(cur.parent)
    ) {
      return undefined;
    }

    cur = cur.parent;
  }

  return undefined;
}

function getOpenBraceEnd(
  classDeclaration: ts.ClassLikeDeclaration,
  sourceFile: ts.SourceFile,
): number {
  const openBrace = classDeclaration
    .getChildren(sourceFile)
    .find((child) => child.kind === ts.SyntaxKind.OpenBraceToken);
  return openBrace != null ? openBrace.end : classDeclaration.members.pos;
}

function getMemberIndentation(
  classDeclaration: ts.ClassLikeDeclaration,
  anchor: ts.ClassElement | undefined,
  sourceFile: ts.SourceFile,
): string {
  const reference = anchor ?? classDeclaration.members[0];
  if (reference != null) {
    return getLineIndentation(reference, sourceFile);
  }
  return `${getLineIndentation(classDeclaration, sourceFile)}  `;
}

function getLineIndentation(node: ts.Node, sourceFile: ts.SourceFile): string {
  const start = node.getStart(sourceFile);
  const { line } = sourceFile.getLineAndCharacterOfPosition(start);
  const lineStart = sourceFile.getPositionOfLineAndCharacter(line, 0);
  const match = /^[ \t]*/.exec(sourceFile.text.slice(lineStart, start));
  return match ? match[0] : '';
}
