import ts from 'typescript';
import { SourceTextUpdate } from '../../utils/updateSourceText';

function isReactClassComponentName(name: string): boolean {
  return name === 'Component' || name === 'PureComponent';
}

export function isReactClassComponent(classDeclaration: ts.ClassDeclaration): boolean {
  const heritageType = getReactComponentHeritageType(classDeclaration);

  if (heritageType) {
    if (
      ts.isPropertyAccessExpression(heritageType.expression) &&
      ts.isIdentifier(heritageType.expression.expression) &&
      heritageType.expression.expression.text === 'React' &&
      isReactClassComponentName(heritageType.expression.name.text)
    ) {
      return true;
    }

    if (
      ts.isIdentifier(heritageType.expression) &&
      isReactClassComponentName(heritageType.expression.text)
    ) {
      return true;
    }
  }

  return false;
}

export function isThisPropsAccess(node: ts.Node): node is ts.PropertyAccessExpression {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ThisKeyword &&
    node.name.text === 'props'
  );
}

export function isReactSfcFunctionDeclaration(
  functionDeclaration: ts.FunctionDeclaration,
): boolean {
  return (
    functionDeclaration.name != null &&
    /^[A-Z]\w*$/.test(functionDeclaration.name.text) &&
    functionDeclaration.parameters.length <= 2
  );
}

export type ReactSfcFunctionExpression = ts.ArrowFunction | ts.FunctionExpression;

export function isSfcFunctionExpression(
  expression: ts.Expression,
): expression is ReactSfcFunctionExpression {
  return (
    (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) &&
    expression.parameters.length <= 2
  );
}

export function isReactSfcArrowFunction(variableStatement: ts.VariableStatement): boolean {
  const { declarations } = variableStatement.declarationList;
  if (declarations.length !== 1) {
    return false;
  }

  const [declaration] = declarations;
  if (
    !ts.isIdentifier(declaration.name) ||
    !/^[A-Z]\w*$/.test(declaration.name.text) ||
    declaration.initializer == null
  ) {
    return false;
  }

  const initializer = unwrapReactMemo(declaration.initializer);
  if (ts.isCallExpression(initializer) && isReactForwardRefName(initializer)) {
    return true;
  }

  return isSfcFunctionExpression(initializer);
}

export function isReactForwardRefName(initializer: ts.CallExpression) {
  const { expression } = initializer;

  if (ts.isIdentifier(expression)) {
    return /forwardRef/gi.test(expression.escapedText.toString());
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return /forwardRef/gi.test(expression.name?.escapedText.toString());
  }

  return false;
}

export function isReactMemoName(initializer: ts.CallExpression) {
  const { expression } = initializer;

  if (ts.isIdentifier(expression)) {
    return expression.text === 'memo';
  }

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text === 'memo';
  }

  return false;
}

// memo(forwardRef(fn)) and memo(fn) describe the same component as their
// argument, so detection looks through any number of memo calls.
export function unwrapReactMemo(expression: ts.Expression): ts.Expression {
  if (
    ts.isCallExpression(expression) &&
    isReactMemoName(expression) &&
    expression.arguments.length > 0
  ) {
    return unwrapReactMemo(expression.arguments[0]);
  }

  return expression;
}

export function getReactComponentHeritageType(
  classDeclaration: ts.ClassDeclaration,
): ts.ExpressionWithTypeArguments | undefined {
  if (
    classDeclaration.heritageClauses &&
    classDeclaration.heritageClauses.length === 1 &&
    classDeclaration.heritageClauses[0].types.length === 1 &&
    ts.isExpressionWithTypeArguments(classDeclaration.heritageClauses[0].types[0])
  ) {
    return classDeclaration.heritageClauses[0].types[0];
  }

  return undefined;
}

export function replaceHeritageTypeArguments(
  heritageType: ts.ExpressionWithTypeArguments,
  typeArgs: readonly ts.TypeNode[],
  printer: ts.Printer,
  sourceFile: ts.SourceFile,
): SourceTextUpdate {
  return {
    kind: 'replace',
    index: heritageType.pos,
    length: heritageType.end - heritageType.pos,
    text: ` ${printer.printNode(
      ts.EmitHint.Unspecified,
      ts.factory.updateExpressionWithTypeArguments(heritageType, heritageType.expression, typeArgs),
      sourceFile,
    )}`,
  };
}

export function getNumComponentsInSourceFile(sourceFile: ts.SourceFile): number {
  const reactClassDeclarations = sourceFile.statements
    .filter(ts.isClassDeclaration)
    .filter(isReactClassComponent);

  const reactSfcFunctionDeclarations = sourceFile.statements
    .filter(ts.isFunctionDeclaration)
    .filter(isReactSfcFunctionDeclaration);

  const reactSfcArrowFunctions = sourceFile.statements
    .filter(ts.isVariableStatement)
    .filter(isReactSfcArrowFunction);

  return (
    reactClassDeclarations.length +
    reactSfcFunctionDeclarations.length +
    reactSfcArrowFunctions.length
  );
}
