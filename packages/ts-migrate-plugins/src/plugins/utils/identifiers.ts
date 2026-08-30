import ts from 'typescript';
import { getOrCreate } from '../../utils/maps';

export type KnownDefinitionMap = { [key: string]: { pos: number; end: number } };

/**
 * Recursively finds all identifier nodes within/including a given node
 * Note: this requires parent nodes to be set because it relies on generic parent - child relationships.
 * @param root
 */
export function collectIdentifierNodes(root: ts.Node): ts.Identifier[] {
  const identifiers: ts.Identifier[] = [];
  const visitor = (node: ts.Node) => {
    if (ts.isIdentifier(node)) {
      identifiers.push(node);
    }
    ts.forEachChild(node, visitor);
  };
  visitor(root);
  return identifiers;
}

/**
 * Returns a set of all the identifier names within the given source file
 * @param sourceFile
 */
export function collectIdentifiers(sourceFile: ts.SourceFile): Set<string> {
  const identifiers = collectIdentifierNodes(sourceFile);
  return identifiers.reduce((identifierStrings: Set<string>, identifierNode: ts.Identifier) => {
    identifierStrings.add(identifierNode.text);
    return identifierStrings;
  }, new Set<string>());
}

/**
 * Checks whether an identifier is a property name (`a.b`, `{ b: ... }`) rather
 * than a free reference.
 */
export function isPropertyNamePosition(identifier: ts.Identifier): boolean {
  const { parent } = identifier;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    (ts.isPropertyAssignment(parent) && parent.name === identifier)
  );
}

/**
 * Adds every name a binding introduces to `out`, descending through nested
 * object and array patterns.
 */
export function collectBindingNames(name: ts.BindingName, out: Set<string>): void {
  if (ts.isIdentifier(name)) {
    out.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) {
      collectBindingNames(element.name, out);
    }
  }
}

/**
 * Groups items that each carry a binding name by that name, keeping the order
 * they were given in both across the keys and within each group.
 */
export function groupByName<T extends { name: ts.Identifier }>(
  items: readonly T[],
): Map<string, T[]> {
  const byName = new Map<string, T[]>();
  items.forEach((item) => {
    getOrCreate(byName, item.name.text, (): T[] => []).push(item);
  });
  return byName;
}

/**
 * Finds known imports
 * @param sourceFile
 */
export function findKnownImports(sourceFile: ts.SourceFile): KnownDefinitionMap {
  const importDeclarations = sourceFile.statements.filter(ts.isImportDeclaration);
  const knownImports: KnownDefinitionMap = {};

  importDeclarations.forEach((importDeclaration: ts.ImportDeclaration) => {
    const { importClause } = importDeclaration;
    if (!importClause) {
      return;
    }
    const identifiers = collectIdentifierNodes(importClause);
    identifiers.forEach((identifier: ts.Identifier) => {
      knownImports[identifier.text] = { pos: identifier.pos, end: importClause.end };
    });
  });
  return knownImports;
}

export function findKnownVariables(sourceFile: ts.SourceFile): KnownDefinitionMap {
  const variableStatements = sourceFile.statements.filter(ts.isVariableStatement);
  const knownVariables: KnownDefinitionMap = {};

  variableStatements.forEach((statement: ts.VariableStatement) => {
    const { declarations } = statement.declarationList;
    declarations.forEach((declaration: ts.VariableDeclaration) => {
      const identifiers = collectIdentifierNodes(declaration.name);
      identifiers.forEach((identifier: ts.Identifier) => {
        knownVariables[identifier.text] = { pos: identifier.pos, end: declaration.end };
      });
    });
  });
  return knownVariables;
}

/**
 * Checks whether an identifier's symbol (following shorthand property
 * assignments and aliases) resolves to the given declaration.
 */
export function resolvesToDeclaration(
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
