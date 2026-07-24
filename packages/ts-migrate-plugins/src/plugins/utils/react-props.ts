import ts from 'typescript';
import { getNumComponentsInSourceFile } from './react';
import { collectIdentifiers } from './identifiers';
import { PropTypesIdentifierMap } from '../react-props';

export type PropsTypeNode = ts.TypeLiteralNode | ts.IntersectionTypeNode;

type Params = {
  anyAlias?: string;
  anyFunctionAlias?: string;
  implicitChildren?: boolean;
  spreadReplacements: { spreadId: string; typeRef: ts.TypeReferenceNode }[];
  propTypeIdentifiers?: PropTypesIdentifierMap;
  importedIdentifiers?: Set<string>;
};

function getEntityName(
  expression: ts.Expression,
  isAllowedRoot?: (name: string) => boolean,
): ts.EntityName | undefined {
  if (ts.isIdentifier(expression)) {
    return !isAllowedRoot || isAllowedRoot(expression.text)
      ? ts.factory.createIdentifier(expression.text)
      : undefined;
  }
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)) {
    const qualifier = getEntityName(expression.expression, isAllowedRoot);
    return qualifier && ts.factory.createQualifiedName(qualifier, expression.name.text);
  }
  return undefined;
}

// Imported propTypes objects can't be converted structurally, but their type
// can be derived from the value with InferProps<typeof x>.
export function getImportedEntityName(
  expression: ts.Expression,
  importedIdentifiers: Set<string>,
): ts.EntityName | undefined {
  return getEntityName(expression, (name) => importedIdentifiers.has(name));
}

export function createInferPropsTypeNode(entityName: ts.EntityName): ts.TypeReferenceNode {
  return ts.factory.createTypeReferenceNode('InferProps', [
    ts.factory.createTypeQueryNode(entityName),
  ]);
}

export function unpackInitializer(
  initializer: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
): ts.ObjectLiteralExpression | undefined {
  if (!initializer) {
    return undefined;
  }

  if (ts.isObjectLiteralExpression(initializer)) {
    return initializer;
  }

  if (
    ts.isCallExpression(initializer) &&
    ts.isIdentifier(initializer.expression) &&
    initializer.expression.text === 'forbidExtraProps' &&
    initializer.arguments.length === 1
  ) {
    const arg = initializer.arguments[0];
    if (ts.isObjectLiteralExpression(arg)) {
      return arg;
    }
  }

  if (ts.isIdentifier(initializer)) {
    for (const statement of sourceFile.statements) {
      if (
        ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.length === 1
      ) {
        const declaration = statement.declarationList.declarations[0];
        if (
          ts.isVariableDeclaration(declaration) &&
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === initializer.text
        ) {
          return unpackInitializer(declaration.initializer, sourceFile);
        }
      }
    }
  }

  return undefined;
}

export default function getTypeFromPropTypesObjectLiteral(
  objectLiteral: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
  params: Params,
) {
  const members: ts.PropertySignature[] = [];
  const intersectionTypes: ts.TypeReferenceNode[] = [];
  const unhandledProperties: ts.ObjectLiteralElementLike[] = [];
  const comments: string[] = [];

  for (const property of objectLiteral.properties) {
    let handled = false;
    if (ts.isPropertyAssignment(property)) {
      if (params.implicitChildren && property.name.getText(sourceFile) === 'children') {
        handled = true;
      } else {
        const prop = convertPropertyAssignment(property, sourceFile, params);
        if (prop) {
          members.push(prop);
          handled = true;
        }
      }
    } else if (ts.isSpreadAssignment(property)) {
      const spreadId = ts.isIdentifier(property.expression) ? property.expression.text : undefined;
      const replacement = spreadId
        ? params.spreadReplacements.find((cur) => cur.spreadId === spreadId)
        : undefined;
      if (replacement) {
        intersectionTypes.push(replacement.typeRef);
        handled = true;
      } else if (params.importedIdentifiers) {
        const entityName = getImportedEntityName(property.expression, params.importedIdentifiers);
        if (entityName) {
          intersectionTypes.push(createInferPropsTypeNode(entityName));
          handled = true;
        }
      }
    }

    if (!handled) {
      unhandledProperties.push(property);
      comments.push(property.getText(sourceFile));
    }
  }

  let node: ts.TypeLiteralNode | ts.IntersectionTypeNode =
    ts.factory.createTypeLiteralNode(members);
  if (intersectionTypes.length > 0) {
    node = ts.factory.createIntersectionTypeNode([node, ...intersectionTypes]);
  }
  if (comments.length > 0) {
    node = ts.addSyntheticLeadingComment(
      node,
      ts.SyntaxKind.MultiLineCommentTrivia,
      `
(ts-migrate) TODO: Migrate the remaining prop types
${comments.join('\n')}
`,
      true,
    );
  }

  return node;
}

function convertPropertyAssignment(
  propertyAssignment: ts.PropertyAssignment,
  sourceFile: ts.SourceFile,
  params: Params,
) {
  const name = propertyAssignment.name.getText(sourceFile);
  const { initializer } = propertyAssignment;

  let typeExpression: ts.Expression;
  let isRequired: boolean;
  if (
    ts.isPropertyAccessExpression(initializer) &&
    /\.isRequired/.test(initializer.getText(sourceFile))
  ) {
    typeExpression = initializer.expression;
    isRequired = true;
  } else {
    typeExpression = initializer;
    isRequired = false;
  }

  const typeNode = getTypeFromPropTypeExpression(typeExpression, sourceFile, params);

  let propertySignature = ts.factory.createPropertySignature(
    undefined,
    name,
    isRequired ? undefined : ts.factory.createToken(ts.SyntaxKind.QuestionToken),
    typeNode,
  );
  propertySignature = ts.moveSyntheticComments(propertySignature, typeNode);
  return propertySignature;
}

function getLiteralTypeNode(element: ts.Expression): ts.TypeNode | undefined {
  if (
    ts.isStringLiteral(element) ||
    ts.isNumericLiteral(element) ||
    element.kind === ts.SyntaxKind.TrueKeyword ||
    element.kind === ts.SyntaxKind.FalseKeyword ||
    element.kind === ts.SyntaxKind.NullKeyword
  ) {
    return ts.factory.createLiteralTypeNode(element as ts.LiteralTypeNode['literal']);
  }
  if (
    ts.isPrefixUnaryExpression(element) &&
    element.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(element.operand)
  ) {
    return ts.factory.createLiteralTypeNode(element);
  }
  if (ts.isIdentifier(element) && element.text === 'undefined') {
    return ts.factory.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword);
  }
  return undefined;
}

// oneOf(Object.values(x)) and oneOf(Object.keys(x)) enumerate an object whose
// members are only known at the value level, so the type comes from typeof x.
function getEnumObjectTypeNode(argument: ts.Expression): ts.TypeNode | undefined {
  if (
    !ts.isCallExpression(argument) ||
    argument.arguments.length !== 1 ||
    !ts.isPropertyAccessExpression(argument.expression) ||
    !ts.isIdentifier(argument.expression.expression) ||
    argument.expression.expression.text !== 'Object'
  ) {
    return undefined;
  }

  const typeQuery = () => {
    const entityName = getEntityName(argument.arguments[0]);
    return entityName && ts.factory.createTypeQueryNode(entityName);
  };
  const keyOf = () => {
    const query = typeQuery();
    return query && ts.factory.createTypeOperatorNode(ts.SyntaxKind.KeyOfKeyword, query);
  };

  const method = argument.expression.name.text;
  if (method === 'keys') {
    return keyOf();
  }
  if (method === 'values') {
    const objectType = typeQuery();
    const indexType = keyOf();
    return objectType && indexType
      ? ts.factory.createIndexedAccessTypeNode(objectType, indexType)
      : undefined;
  }
  return undefined;
}

function getTypeFromPropTypeExpression(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  params: Params,
): ts.TypeNode {
  const { anyAlias, anyFunctionAlias } = params;

  let text = node.getText(sourceFile).replace(/React\.PropTypes\./, '');
  const isDestructuredProptypeImport =
    params.propTypeIdentifiers && ts.isIdentifier(node) && params.propTypeIdentifiers[text];

  let result = null;
  if (ts.isPropertyAccessExpression(node) || isDestructuredProptypeImport) {
    if (isDestructuredProptypeImport && params.propTypeIdentifiers) {
      text = params.propTypeIdentifiers[text];
    }
    /**
     * PropTypes.array,
     * PropTypes.bool,
     * PropTypes.func,
     * PropTypes.number,
     * PropTypes.object,
     * PropTypes.string,
     * PropTypes.symbol, (ignore)
     * PropTypes.node,
     * PropTypes.element,
     * PropTypes.elementType,
     * PropTypes.any,
     */
    if (/string/.test(text)) {
      result = ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword);
    } else if (/any/.test(text)) {
      if (anyAlias) {
        result = ts.factory.createTypeReferenceNode(anyAlias, undefined);
      } else {
        result = ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);
      }
    } else if (/array/.test(text)) {
      if (anyAlias) {
        result = ts.factory.createArrayTypeNode(
          ts.factory.createTypeReferenceNode(anyAlias, undefined),
        );
      } else {
        result = ts.factory.createArrayTypeNode(
          ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
        );
      }
    } else if (/bool/.test(text)) {
      result = ts.factory.createKeywordTypeNode(ts.SyntaxKind.BooleanKeyword);
    } else if (/number/.test(text)) {
      result = ts.factory.createKeywordTypeNode(ts.SyntaxKind.NumberKeyword);
    } else if (/object/.test(text)) {
      if (anyAlias) {
        result = ts.factory.createTypeReferenceNode(anyAlias, undefined);
      } else {
        result = ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);
      }
    } else if (/node/.test(text)) {
      result = ts.factory.createTypeReferenceNode('React.ReactNode', undefined);
    } else if (/elementType/.test(text)) {
      result = ts.factory.createTypeReferenceNode('React.ElementType', undefined);
    } else if (/element/.test(text)) {
      result = ts.factory.createTypeReferenceNode('React.ReactElement', undefined);
    } else if (/func/.test(text)) {
      if (anyFunctionAlias) {
        result = ts.factory.createTypeReferenceNode(anyFunctionAlias, undefined);
      } else if (anyAlias) {
        result = ts.factory.createFunctionTypeNode(
          undefined,
          [
            ts.factory.createParameterDeclaration(
              undefined,
              ts.factory.createToken(ts.SyntaxKind.DotDotDotToken),
              'args',
              undefined,
              ts.factory.createArrayTypeNode(
                ts.factory.createTypeReferenceNode(anyAlias, undefined),
              ),
              undefined,
            ),
          ],
          ts.factory.createTypeReferenceNode(anyAlias, undefined),
        );
      } else {
        result = ts.factory.createFunctionTypeNode(
          undefined,
          [
            ts.factory.createParameterDeclaration(
              undefined,
              ts.factory.createToken(ts.SyntaxKind.DotDotDotToken),
              'args',
              undefined,
              ts.factory.createArrayTypeNode(
                ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
              ),
              undefined,
            ),
          ],
          ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
        );
      }
    }
  } else if (ts.isCallExpression(node)) {
    /**
     * PropTypes.instanceOf(),
     * PropTypes.oneOf(), // literal members, or Object.values(x) / Object.keys(x)
     * PropTypes.oneOfType(),
     * PropTypes.arrayOf(),
     * PropTypes.objectOf(),
     * PropTypes.shape(),
     * PropTypes.exact(),
     */
    const expressionText = node.expression.getText(sourceFile);
    if (/instanceOf$/.test(expressionText)) {
      const argument = node.arguments[0];
      const entityName = argument && getEntityName(argument);
      if (entityName) {
        result = ts.factory.createTypeReferenceNode(entityName, undefined);
      }
    } else if (/oneOf$/.test(expressionText)) {
      const argument = node.arguments[0];
      if (argument && ts.isArrayLiteralExpression(argument)) {
        const literals = argument.elements.map(getLiteralTypeNode);
        if (literals.length > 0 && literals.every((literal) => literal !== undefined)) {
          result = ts.factory.createUnionTypeNode(literals as ts.TypeNode[]);
        }
      } else if (argument) {
        result = getEnumObjectTypeNode(argument);
      }
    } else if (/oneOfType$/.test(expressionText)) {
      const argument = node.arguments[0];
      if (ts.isArrayLiteralExpression(argument)) {
        const children: ts.Node[] = [];
        result = ts.factory.createUnionTypeNode(
          argument.elements.map((elm) => {
            const child = getTypeFromPropTypeExpression(elm, sourceFile, params);
            children.push(child);
            return child;
          }),
        );
        for (const child of children) {
          result = ts.moveSyntheticComments(result, child);
        }
      }
    } else if (/arrayOf$/.test(expressionText)) {
      const argument = node.arguments[0];
      if (argument) {
        const child = getTypeFromPropTypeExpression(argument, sourceFile, params);
        result = ts.factory.createArrayTypeNode(child);
        result = ts.moveSyntheticComments(result, child);
      }
    } else if (/objectOf$/.test(expressionText)) {
      const argument = node.arguments[0];
      if (argument) {
        const child = getTypeFromPropTypeExpression(argument, sourceFile, params);
        result = ts.factory.createTypeLiteralNode([
          ts.factory.createIndexSignature(
            undefined,
            [
              ts.factory.createParameterDeclaration(
                undefined,
                undefined,
                'key',
                undefined,
                ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
              ),
            ],
            child,
          ),
        ]);
        result = ts.moveSyntheticComments(result, child);
      }
    } else if (/(shape|exact)$/.test(expressionText)) {
      const argument = node.arguments[0];
      if (argument && ts.isObjectLiteralExpression(argument)) {
        return getTypeFromPropTypesObjectLiteral(argument, sourceFile, params);
      }
    }
  } else if (ts.isIdentifier(node) && node.text === 'textlike') {
    result = ts.factory.createUnionTypeNode([
      ts.factory.createKeywordTypeNode(ts.SyntaxKind.StringKeyword),
      ts.factory.createTypeReferenceNode('React.ReactNode', undefined),
    ]);
  } else if (ts.isIdentifier(node)) {
    result = ts.factory.createTypeReferenceNode(node.text, undefined);
  }

  /**
   * customProp,
   * anything others
   */
  if (!result) {
    if (anyAlias) {
      result = ts.factory.createTypeReferenceNode(anyAlias, undefined);
    } else {
      result = ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);
    }

    // Add comment about what the original proptype was.
    result = ts.addSyntheticTrailingComment(
      result,
      ts.SyntaxKind.SingleLineCommentTrivia,
      ` TODO: ${text
        .split('\n')
        .map((line) => line.trim())
        .join(' ')}`,
      true,
    );
  }

  return result;
}

export function createPropsTypeNameGetter(sourceFile: ts.SourceFile) {
  const numComponentsInFile = getNumComponentsInSourceFile(sourceFile);
  const usedIdentifiers = collectIdentifiers(sourceFile);

  const getPropsTypeName = (componentName: string | undefined) => {
    let name = '';
    if (componentName && numComponentsInFile > 1) {
      name = `${componentName}Props`;
    } else {
      name = 'Props';
    }

    if (!usedIdentifiers.has(name)) {
      return name;
    }

    // Ensure name is unused.
    let i = 1;
    while (usedIdentifiers.has(name + i)) {
      i += 1;
    }
    return name + i;
  };

  return getPropsTypeName;
}
