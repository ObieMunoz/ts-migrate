/**
 * Finding the type node a component's props are declared by, from either end:
 * a JSX tag that renders it, or the declaration itself. The walk goes through
 * re-exports, `connect(...)`-style wrappers and `as` casts, so the annotation a
 * pass edits is the one the checker reads at the call site.
 */
import ts from 'typescript';

export function isMigratableFile(file: ts.SourceFile): boolean {
  return !file.isDeclarationFile && !file.fileName.includes('/node_modules/');
}

export function aliasedSymbol(
  symbol: ts.Symbol | undefined,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  let current = symbol;
  while (current && current.flags & ts.SymbolFlags.Alias) {
    const next = checker.getAliasedSymbol(current);
    if (!next || next === current) return current;
    current = next;
  }
  return current;
}

/**
 * A type an added member would say nothing about: `any` and `unknown` accept
 * the member already, a union would have to gain it in every member, and an
 * index signature answers for every name.
 */
export function isClosedType(checker: ts.TypeChecker, type: ts.Type): boolean {
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false;
  if (type.isUnion()) return false;
  return (
    !checker.getIndexInfoOfType(type, ts.IndexKind.String) &&
    !checker.getIndexInfoOfType(type, ts.IndexKind.Number)
  );
}

export function propsAnnotationOfTag(
  tagName: ts.JsxTagNameExpression,
  checker: ts.TypeChecker,
): ts.TypeNode | undefined {
  const symbol = aliasedSymbol(checker.getSymbolAtLocation(tagName), checker);
  const declaration = symbol?.declarations?.[0];
  return declaration && propsAnnotationOf(declaration, checker);
}

export function propsAnnotationOf(
  node: ts.Node,
  checker: ts.TypeChecker,
  seen: Set<ts.Node> = new Set(),
): ts.TypeNode | undefined {
  if (seen.has(node)) return undefined;
  seen.add(node);
  if (!isMigratableFile(node.getSourceFile())) return undefined;

  if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    return propsAnnotationOfFunction(node);
  }
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    const argument = componentTypeArgument(node);
    return argument && !isAny(argument) ? argument : undefined;
  }
  if (ts.isExportAssignment(node)) {
    return propsAnnotationOf(node.expression, checker, seen);
  }
  if (ts.isVariableDeclaration(node)) {
    if (!node.initializer) return undefined;
    return node.type
      ? typeArgumentAnnotation(node.type)
      : propsAnnotationOf(node.initializer, checker, seen);
  }
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
    return propsAnnotationOf(node.expression, checker, seen);
  }
  if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
    const symbol = aliasedSymbol(checker.getSymbolAtLocation(node), checker);
    const declaration = symbol?.declarations?.[0];
    return declaration && propsAnnotationOf(declaration, checker, seen);
  }
  if (ts.isCallExpression(node)) {
    const component = node.arguments.find(isComponentShaped);
    return component && propsAnnotationOf(component, checker, seen);
  }
  return undefined;
}

/**
 * The props of a function component, from its parameter or, where the
 * annotation sits on the variable it is assigned to as `React.FC<Props>` does,
 * from that annotation's first type argument. Taking the type argument keeps
 * the edit on the props rather than on the component type.
 */
export function propsAnnotationOfFunction(node: ts.SignatureDeclaration): ts.TypeNode | undefined {
  const parameter = node.parameters[0];
  if (!parameter) return undefined;
  if (parameter.type) return isAny(parameter.type) ? undefined : parameter.type;
  const declaration = node.parent;
  return ts.isVariableDeclaration(declaration) && declaration.type
    ? typeArgumentAnnotation(declaration.type)
    : undefined;
}

function typeArgumentAnnotation(type: ts.TypeNode): ts.TypeNode | undefined {
  if (!ts.isTypeReferenceNode(type)) return undefined;
  const argument = type.typeArguments?.[0];
  return argument && !isAny(argument) ? argument : undefined;
}

function isComponentShaped(argument: ts.Expression): boolean {
  return (
    ts.isIdentifier(argument) ||
    ts.isPropertyAccessExpression(argument) ||
    ts.isArrowFunction(argument) ||
    ts.isFunctionExpression(argument) ||
    ts.isClassExpression(argument)
  );
}

function isAny(typeNode: ts.TypeNode): boolean {
  return typeNode.kind === ts.SyntaxKind.AnyKeyword;
}

function componentTypeArgument(node: ts.ClassLikeDeclaration): ts.TypeNode | undefined {
  const heritage = node.heritageClauses?.find(
    (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
  );
  return heritage?.types[0]?.typeArguments?.[0];
}
