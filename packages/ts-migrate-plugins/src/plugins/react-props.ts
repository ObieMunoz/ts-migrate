import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import {
  isReactClassComponent,
  getReactComponentHeritageType,
  isReactSfcFunctionDeclaration,
  isReactSfcArrowFunction,
  isReactForwardRefName,
  isSfcFunctionExpression,
  unwrapReactMemo,
  replaceHeritageTypeArguments,
} from './utils/react';
import isNotNull from '../utils/isNotNull';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';
import getTypeFromPropTypesObjectLiteral, {
  createInferPropsTypeNode,
  createPropsTypeNameGetter,
  getImportedEntityName,
  unpackInitializer,
} from './utils/react-props';
import { elementTypesByTag } from './utils/intrinsic-elements';
import { intrinsicTagOfJsxAttribute } from './utils/jsx-tag-names';
import { hasParameterParentheses } from './utils/arrow';
import { getTextPreservingWhitespace } from './utils/text';
import { isStatic } from './utils/modifiers';
import { updateImports, DefaultImport, NamedImport } from './utils/imports';
import {
  AnyAliasOptions,
  AnyFunctionAliasOptions,
  Properties,
  anyAliasProperty,
  anyFunctionAliasProperty,
  createValidate,
} from '../utils/validateOptions';

type Options = {
  shouldUpdateAirbnbImports?: boolean;
  shouldKeepPropTypes?: boolean;
} & AnyAliasOptions &
  AnyFunctionAliasOptions;

const optionProperties: Properties = {
  ...anyAliasProperty,
  ...anyFunctionAliasProperty,
  shouldUpdateAirbnbImports: { type: 'boolean' },
  shouldKeepPropTypes: { type: 'boolean' },
};

export type PropTypesIdentifierMap = { [property: string]: string };

const reactPropsPlugin: Plugin<Options> = {
  name: 'react-props',

  run({ fileName, sourceFile, options }) {
    if (!fileName.endsWith('.tsx')) return undefined;

    const updates: SourceTextUpdate[] = [];
    const getPropsTypeName = createPropsTypeNameGetter(sourceFile);

    const propTypeIdentifiers: PropTypesIdentifierMap = {};
    const importedIdentifiers = new Set<string>();

    for (const node of sourceFile.statements) {
      // Scan for prop type imports and build a map
      // Assumes import statements are higher up in the file than react components
      if (ts.isImportDeclaration(node)) {
        const { importClause } = node;
        if (importClause) {
          if (importClause.name) {
            importedIdentifiers.add(importClause.name.text);
          }
          if (importClause.namedBindings) {
            if (ts.isNamespaceImport(importClause.namedBindings)) {
              importedIdentifiers.add(importClause.namedBindings.name.text);
            } else {
              importClause.namedBindings.elements.forEach((specifier) => {
                importedIdentifiers.add(specifier.name.text);
              });
            }
          }
        }

        if (/prop-types/.test(node.moduleSpecifier.getText())) {
          const importBindings = node.importClause?.namedBindings;
          if (importBindings && ts.isNamedImports(importBindings)) {
            importBindings.elements.forEach((specifier) => {
              if (!specifier.propertyName) {
                propTypeIdentifiers[specifier.name.getText()] = specifier.name.getText();
              } else {
                propTypeIdentifiers[specifier.name.getText()] = specifier.propertyName.getText();
              }
            });
          }
        }
      }

      if (isReactNode(node)) {
        const componentName = getComponentName(node);
        const propsTypeName = getPropsTypeName(componentName);
        updates.push(
          ...updatePropTypes(
            node,
            propsTypeName,
            sourceFile,
            propTypeIdentifiers,
            importedIdentifiers,
            options,
          ),
        );
      }
    }

    const updatedSourceText = updateSourceText(sourceFile.text, updates);
    const updatedSourceFile = ts.createSourceFile(
      fileName,
      updatedSourceText,
      sourceFile.languageVersion,
    );
    const importUpdates = updateImports(
      updatedSourceFile,
      [
        { namedImport: 'InferProps', moduleSpecifier: 'prop-types' },
        ...spreadReplacements.map((cur) => cur.typeImport),
      ],
      options.shouldKeepPropTypes
        ? []
        : [
            { moduleSpecifier: 'prop-types' },
            ...(options.shouldUpdateAirbnbImports
              ? [...importReplacements, ...spreadReplacements.map((cur) => cur.spreadImport)]
              : []),
          ],
    );
    return updateSourceText(updatedSourceText, importUpdates);
  },

  validate: createValidate(optionProperties),
};

export default reactPropsPlugin;

type SpreadReplacement = {
  spreadId: string;
  spreadImport: DefaultImport | NamedImport;
  typeRef: ts.TypeReferenceNode;
  typeImport: DefaultImport | NamedImport;
};

// airbnb related imports
const importReplacements = [{ moduleSpecifier: 'airbnb-prop-types' }];
const spreadReplacements: SpreadReplacement[] = [
  {
    spreadId: 'withStylesPropTypes',
    spreadImport: {
      namedImport: 'withStylesPropTypes',
      moduleSpecifier: ':dls-themes/withStyles',
    },
    typeRef: ts.factory.createTypeReferenceNode('WithStylesProps', undefined),
    typeImport: {
      namedImport: 'WithStylesProps',
      moduleSpecifier: ':dls-themes/withStyles',
    },
  },
  {
    spreadId: 'withBreakpointPropTypes',
    spreadImport: {
      namedImport: 'withBreakpointPropTypes',
      moduleSpecifier: ':dls-core/components/breakpoints/withBreakpoint',
    },
    typeRef: ts.factory.createTypeReferenceNode('WithBreakpointProps', undefined),
    typeImport: {
      namedImport: 'WithBreakpointProps',
      moduleSpecifier: ':dls-core/components/breakpoints/withBreakpoint',
    },
  },
  {
    spreadId: 'withRouterPropTypes',
    spreadImport: {
      defaultImport: 'withRouterPropTypes',
      moduleSpecifier: ':routing/shapes/RR4PropTypes',
    },
    typeRef: ts.factory.createTypeReferenceNode('RouteConfigComponentProps', undefined),
    typeImport: {
      namedImport: 'RouteConfigComponentProps',
      moduleSpecifier: 'react-router-config',
    },
  },
];

type ReactNode = ts.ClassDeclaration | ts.FunctionDeclaration | ts.VariableStatement;
type ReactSfcNode = ts.FunctionDeclaration | ts.VariableStatement;

function isReactNode(node: ts.Node): node is ReactNode {
  return (
    (ts.isClassDeclaration(node) && isReactClassComponent(node)) ||
    (ts.isFunctionDeclaration(node) && isReactSfcFunctionDeclaration(node)) ||
    (ts.isVariableStatement(node) && isReactSfcArrowFunction(node))
  );
}

function isReactSfcNode(node: ReactNode): node is ReactSfcNode {
  return ts.isFunctionDeclaration(node) || ts.isVariableStatement(node);
}

function updatePropTypes(
  node: ReactNode,
  propsTypeName: string,
  sourceFile: ts.SourceFile,
  propTypeIdentifiers: PropTypesIdentifierMap,
  importedIdentifiers: Set<string>,
  options: Options,
): SourceTextUpdate[] {
  return isReactSfcNode(node)
    ? updateSfcPropTypes(
        node,
        propsTypeName,
        sourceFile,
        propTypeIdentifiers,
        importedIdentifiers,
        options,
      )
    : updateClassPropTypes(node, propsTypeName, sourceFile, importedIdentifiers, options);
}

// Returns undefined when there are no propTypes to convert, which is what tells
// the callers to leave the component alone.
function propsTypeAliasUpdates(
  node: ReactNode,
  propTypesNode: ts.PropertyDeclaration | ts.ExpressionStatement | undefined,
  propsTypeName: string,
  sourceFile: ts.SourceFile,
  propTypeIdentifiers: PropTypesIdentifierMap,
  importedIdentifiers: Set<string>,
  options: Options,
  implicitChildren: boolean,
): SourceTextUpdate[] | undefined {
  const objectLiteral = findPropTypesObjectLiteral(propTypesNode, sourceFile);
  if (objectLiteral) {
    return updateObjectLiteral(
      node,
      objectLiteral,
      propsTypeName,
      sourceFile,
      propTypeIdentifiers,
      importedIdentifiers,
      options,
      implicitChildren,
    );
  }

  const importedPropTypes = findImportedPropTypes(propTypesNode, importedIdentifiers);
  return importedPropTypes
    ? [insertInferPropsTypeAlias(node, importedPropTypes, propsTypeName, sourceFile)]
    : undefined;
}

function updateSfcPropTypes(
  node: ReactSfcNode,
  propsTypeName: string,
  sourceFile: ts.SourceFile,
  propTypeIdentifiers: PropTypesIdentifierMap,
  importedIdentifiers: Set<string>,
  options: Options,
): SourceTextUpdate[] {
  const propsParam = getPropsParam(node);
  if (!propsParam || propsParam.type) return [];

  const updates = propsTypeAliasUpdates(
    node,
    findSfcPropTypesNode(node, sourceFile),
    propsTypeName,
    sourceFile,
    propTypeIdentifiers,
    importedIdentifiers,
    options,
    false,
  );
  if (!updates) return [];

  const printer = ts.createPrinter();
  const forwardRefComponent = getReactForwardRefFuncExpression(node);
  if (forwardRefComponent) {
    const { expression } = forwardRefComponent;
    const index = expression.getStart(sourceFile);
    const refTypeName = getForwardRefElementType(forwardRefComponent) || options.anyAlias || 'any';
    updates.push({
      kind: 'replace',
      index,
      length: expression.end - index,
      text: printer.printNode(
        ts.EmitHint.Unspecified,
        ts.factory.updateExpressionWithTypeArguments(forwardRefComponent as any, expression, [
          ts.factory.createTypeReferenceNode(refTypeName, undefined),
          ts.factory.createTypeReferenceNode(propsTypeName, undefined),
        ]),
        sourceFile,
      ),
    });
  } else {
    let updateText = printer.printNode(
      ts.EmitHint.Unspecified,
      ts.factory.updateParameterDeclaration(
        propsParam,
        propsParam.modifiers,
        propsParam.dotDotDotToken,
        propsParam.name,
        propsParam.questionToken,
        ts.factory.createTypeReferenceNode(propsTypeName, undefined),
        propsParam.initializer,
      ),
      sourceFile,
    );

    const signature = propsParam.parent;
    if (
      ts.isArrowFunction(signature) &&
      signature.parameters.length === 1 &&
      !hasParameterParentheses(signature, sourceFile)
    ) {
      // Special case: when an arrow function has a single parameter and no parentheses,
      // add parentheses.
      updateText = `(${updateText})`;
    }

    updates.push({
      kind: 'replace',
      index: propsParam.pos,
      length: propsParam.end - propsParam.pos,
      text: updateText,
    });
  }

  if (!options.shouldKeepPropTypes) {
    updates.push(...deleteSfcPropTypes(node, sourceFile));
  }

  return updates;
}

function updateClassPropTypes(
  node: ts.ClassDeclaration,
  propsTypeName: string,
  sourceFile: ts.SourceFile,
  importedIdentifiers: Set<string>,
  options: Options,
): SourceTextUpdate[] {
  const heritageType = getReactComponentHeritageType(node)!;
  const [propsType, stateType] = heritageType.typeArguments || [];
  if (propsType && !isEmptyPropsType(propsType)) return [];

  const updates = propsTypeAliasUpdates(
    node,
    findClassPropTypesNode(node, sourceFile),
    propsTypeName,
    sourceFile,
    {},
    importedIdentifiers,
    options,
    true,
  );
  if (!updates) return [];

  updates.push(
    replaceHeritageTypeArguments(
      heritageType,
      [ts.factory.createTypeReferenceNode(propsTypeName, undefined), stateType].filter(isNotNull),
      ts.createPrinter(),
      sourceFile,
    ),
  );

  if (!options.shouldKeepPropTypes) {
    updates.push(...deleteClassPropTypes(node, sourceFile));
  }

  return updates;
}

// Matches the placeholders used for prop-less components: `object`, `{}`,
// and `Record<string, never>`.
function isEmptyPropsType(node: ts.Node) {
  if (node.kind === ts.SyntaxKind.ObjectKeyword) {
    return true;
  }
  if (ts.isTypeLiteralNode(node) && node.members.length === 0) {
    return true;
  }
  return (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    node.typeName.text === 'Record' &&
    node.typeArguments != null &&
    node.typeArguments.length === 2 &&
    node.typeArguments[0].kind === ts.SyntaxKind.StringKeyword &&
    node.typeArguments[1].kind === ts.SyntaxKind.NeverKeyword
  );
}

function updateObjectLiteral(
  node: ReactNode,
  objectLiteral: ts.ObjectLiteralExpression,
  propsTypeName: string,
  sourceFile: ts.SourceFile,
  propTypeIdentifiers: PropTypesIdentifierMap,
  importedIdentifiers: Set<string>,
  options: Options,
  implicitChildren: boolean,
) {
  const updates: SourceTextUpdate[] = [];
  const printer = ts.createPrinter();

  const propsTypeNode = getTypeFromPropTypesObjectLiteral(objectLiteral, sourceFile, {
    anyAlias: options.anyAlias,
    anyFunctionAlias: options.anyFunctionAlias,
    implicitChildren,
    spreadReplacements,
    propTypeIdentifiers,
    importedIdentifiers,
  });
  let propsTypeAlias = ts.factory.createTypeAliasDeclaration(
    undefined,
    propsTypeName,
    undefined,
    propsTypeNode,
  );
  propsTypeAlias = ts.moveSyntheticComments(propsTypeAlias, propsTypeNode);

  const varStatement = getParentVariableStatement(objectLiteral, sourceFile);
  if (varStatement && !options.shouldKeepPropTypes) {
    updates.push({
      kind: 'replace',
      index: varStatement.pos,
      length: varStatement.end - varStatement.pos,
      text: getTextPreservingWhitespace(varStatement, propsTypeAlias, sourceFile),
    });
  } else {
    updates.push({
      kind: 'insert',
      index: node.pos,
      text: `\n\n${printer.printNode(ts.EmitHint.Unspecified, propsTypeAlias, sourceFile)}`,
    });
  }

  return updates;
}

function getComponentName(node: ReactNode) {
  if (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)) {
    return node.name && node.name.text;
  }

  if (ts.isVariableStatement(node)) {
    const declaration = node.declarationList.declarations[0];
    return declaration && declaration.name && ts.isIdentifier(declaration.name)
      ? declaration.name.text
      : undefined;
  }

  return undefined;
}

function getPropsParam(node: ReactSfcNode) {
  if (ts.isFunctionDeclaration(node)) {
    return node.parameters[0];
  }

  if (ts.isVariableStatement(node)) {
    const forwardRefComponent = getReactForwardRefFuncExpression(node);
    const forwardRefArgument = forwardRefComponent && forwardRefComponent.arguments[0];
    const forwardRefProps =
      forwardRefArgument &&
      ts.isFunctionLike(forwardRefArgument) &&
      forwardRefArgument.parameters[0];
    const funcExpression = getSfcFuncExpression(node);
    return forwardRefProps || (funcExpression && funcExpression.parameters[0]);
  }

  return undefined;
}

function getComponentInitializer(node: ReactNode) {
  if (!ts.isVariableStatement(node)) return undefined;

  const initializer = node.declarationList.declarations[0]?.initializer;
  return initializer && unwrapReactMemo(initializer);
}

function getSfcFuncExpression(node: ReactNode) {
  const initializer = getComponentInitializer(node);
  return initializer && isSfcFunctionExpression(initializer) ? initializer : undefined;
}

function getReactForwardRefFuncExpression(node: ReactNode) {
  const initializer = getComponentInitializer(node);
  return initializer && ts.isCallExpression(initializer) && isReactForwardRefName(initializer)
    ? initializer
    : undefined;
}

function isUseImperativeHandleCall(node: ts.CallExpression) {
  const { expression } = node;
  if (ts.isIdentifier(expression)) {
    return expression.text === 'useImperativeHandle';
  }
  return ts.isPropertyAccessExpression(expression)
    ? expression.name.text === 'useImperativeHandle'
    : false;
}

function isRefAttribute(node: ts.Node, refName: string): node is ts.JsxAttribute {
  if (!ts.isJsxAttribute(node) || !ts.isIdentifier(node.name) || node.name.text !== 'ref') {
    return false;
  }
  const { initializer } = node;
  return (
    initializer != null &&
    ts.isJsxExpression(initializer) &&
    initializer.expression != null &&
    ts.isIdentifier(initializer.expression) &&
    initializer.expression.text === refName
  );
}

function isNamePosition(identifier: ts.Identifier) {
  const { parent } = identifier;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === identifier) ||
    (ts.isJsxAttribute(parent) && parent.name === identifier) ||
    (ts.isPropertyAssignment(parent) && parent.name === identifier) ||
    (ts.isBindingElement(parent) && parent.propertyName === identifier)
  );
}

// Recovers the ref element type syntactically: the ref has to reach exactly one
// kind of intrinsic tag and be used nowhere else, otherwise the caller writes any.
function getForwardRefElementType(forwardRefCall: ts.CallExpression): string | undefined {
  const [component] = forwardRefCall.arguments;
  if (!component || !isSfcFunctionExpression(component)) {
    return undefined;
  }

  const refParam = component.parameters[1];
  if (!refParam || !ts.isIdentifier(refParam.name)) {
    return undefined;
  }
  const refName = refParam.name.text;

  let tag: string | undefined;
  let unresolved = false;

  const visit = (node: ts.Node): void => {
    if (unresolved) return;

    if (ts.isCallExpression(node) && isUseImperativeHandleCall(node)) {
      unresolved = true;
      return;
    }

    if (isRefAttribute(node, refName)) {
      const attachmentTag = intrinsicTagOfJsxAttribute(node);
      if (attachmentTag === undefined || (tag !== undefined && tag !== attachmentTag)) {
        unresolved = true;
      } else {
        tag = attachmentTag;
      }
      return;
    }

    if (ts.isIdentifier(node) && node.text === refName && !isNamePosition(node)) {
      unresolved = true;
      return;
    }

    ts.forEachChild(node, visit);
  };
  visit(component.body);

  return unresolved || tag === undefined ? undefined : elementTypesByTag[tag];
}

function getParentVariableStatement(
  objectLiteral: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
): ts.VariableStatement | undefined {
  let cur: ts.Node = objectLiteral;
  while (cur !== sourceFile) {
    if (ts.isVariableStatement(cur)) {
      return cur;
    }
    cur = cur.parent;
  }

  return undefined;
}

function deleteClassPropTypes(classDeclaration: ts.ClassDeclaration, sourceFile: ts.SourceFile) {
  const updates: SourceTextUpdate[] = [];

  for (const member of classDeclaration.members) {
    if (isPropTypesStatic(member)) {
      updates.push({
        kind: 'delete',
        index: member.pos,
        length: member.end - member.pos,
      });
    }
  }

  const className = classDeclaration.name && classDeclaration.name.text;
  if (className) {
    updates.push(...deletePropTypesStatements(className, sourceFile));
  }

  return updates;
}

function deleteSfcPropTypes(node: ReactSfcNode, sourceFile: ts.SourceFile) {
  const componentName = getComponentName(node);
  return componentName ? deletePropTypesStatements(componentName, sourceFile) : [];
}

function deletePropTypesStatements(componentName: string, sourceFile: ts.SourceFile) {
  const updates: SourceTextUpdate[] = [];

  for (const statement of sourceFile.statements) {
    if (isPropTypesStatement(statement, componentName)) {
      updates.push({
        kind: 'delete',
        index: statement.pos,
        length: statement.end - statement.pos,
      });
    }
  }

  return updates;
}

function isPropTypesStatic(member: ts.ClassElement): member is ts.PropertyDeclaration {
  return (
    ts.isPropertyDeclaration(member) &&
    isStatic(member) &&
    ts.isIdentifier(member.name) &&
    member.name.text === 'propTypes' &&
    member.initializer != null
  );
}

function isPropTypesStatement(
  statement: ts.Statement,
  componentName: string,
): statement is ts.ExpressionStatement {
  return (
    ts.isExpressionStatement(statement) &&
    ts.isBinaryExpression(statement.expression) &&
    ts.isPropertyAccessExpression(statement.expression.left) &&
    ts.isIdentifier(statement.expression.left.expression) &&
    statement.expression.left.expression.text === componentName &&
    ts.isIdentifier(statement.expression.left.name) &&
    statement.expression.left.name.text === 'propTypes'
  );
}

function findPropTypesStatement(
  componentName: string | undefined,
  sourceFile: ts.SourceFile,
): ts.ExpressionStatement | undefined {
  if (!componentName) return undefined;

  for (const statement of sourceFile.statements) {
    if (isPropTypesStatement(statement, componentName)) {
      return statement;
    }
  }

  return undefined;
}

function findClassPropTypesNode(
  classDeclaration: ts.ClassDeclaration,
  sourceFile: ts.SourceFile,
): ts.PropertyDeclaration | ts.ExpressionStatement | undefined {
  for (const member of classDeclaration.members) {
    if (isPropTypesStatic(member)) {
      return member;
    }
  }

  return findPropTypesStatement(classDeclaration.name && classDeclaration.name.text, sourceFile);
}

function findSfcPropTypesNode(node: ReactSfcNode, sourceFile: ts.SourceFile) {
  return findPropTypesStatement(getComponentName(node), sourceFile);
}

function findPropTypesObjectLiteral(
  node: ts.PropertyDeclaration | ts.ExpressionStatement | undefined,
  sourceFile: ts.SourceFile,
): ts.ObjectLiteralExpression | undefined {
  if (!node) return undefined;

  let expression: ts.Expression | undefined;
  if (ts.isPropertyDeclaration(node) && node.initializer != null) {
    expression = node.initializer;
  } else if (ts.isExpressionStatement(node) && ts.isBinaryExpression(node.expression)) {
    expression = node.expression.right;
  }

  return unpackInitializer(expression, sourceFile);
}

function findImportedPropTypes(
  propTypesNode: ts.PropertyDeclaration | ts.ExpressionStatement | undefined,
  importedIdentifiers: Set<string>,
): ts.EntityName | undefined {
  if (!propTypesNode) return undefined;

  let expression: ts.Expression | undefined;
  if (ts.isPropertyDeclaration(propTypesNode) && propTypesNode.initializer != null) {
    expression = propTypesNode.initializer;
  } else if (
    ts.isExpressionStatement(propTypesNode) &&
    ts.isBinaryExpression(propTypesNode.expression)
  ) {
    expression = propTypesNode.expression.right;
  }
  if (!expression) return undefined;

  if (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === 'forbidExtraProps' &&
    expression.arguments.length === 1
  ) {
    [expression] = expression.arguments;
  }

  return getImportedEntityName(expression, importedIdentifiers);
}

function insertInferPropsTypeAlias(
  node: ReactNode,
  propTypesEntityName: ts.EntityName,
  propsTypeName: string,
  sourceFile: ts.SourceFile,
): SourceTextUpdate {
  const printer = ts.createPrinter();
  const propsTypeAlias = ts.factory.createTypeAliasDeclaration(
    undefined,
    propsTypeName,
    undefined,
    createInferPropsTypeNode(propTypesEntityName),
  );
  return {
    kind: 'insert',
    index: node.pos,
    text: `\n\n${printer.printNode(ts.EmitHint.Unspecified, propsTypeAlias, sourceFile)}`,
  };
}
