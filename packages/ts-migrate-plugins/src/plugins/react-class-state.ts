import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import {
  isReactClassComponent,
  getReactComponentHeritageType,
  getNumComponentsInSourceFile,
} from './utils/react';
import { collectIdentifiers } from './utils/identifiers';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';
import { AnyAliasOptions, validateAnyAliasOptions } from '../utils/validateOptions';

type Options = AnyAliasOptions;

// `undefined` is the absence of evidence, `any` is evidence that the member
// holds anything, such as a null initializer or two conflicting writes.
type DerivedType =
  | { kind: 'any' }
  | { kind: 'keyword'; keyword: ts.KeywordTypeSyntaxKind }
  | { kind: 'array'; element: DerivedType | undefined };

type StateMember = {
  type: DerivedType | undefined;
  numInitializers: number;
};

type StateEvidence = {
  usesState: boolean;
  members: Map<string, StateMember>;
  numInitializers: number;
  unknownMembers: boolean;
};

const identifierNamePattern = /^[A-Za-z_$][\w$]*$/;

const reactClassStatePlugin: Plugin<Options> = {
  name: 'react-class-state',

  async run({ fileName, sourceFile, options }) {
    if (!fileName.endsWith('.tsx')) return undefined;

    const updates: SourceTextUpdate[] = [];
    const printer = ts.createPrinter();

    const reactClassDeclarations = sourceFile.statements
      .filter(ts.isClassDeclaration)
      .filter(isReactClassComponent);
    if (reactClassDeclarations.length === 0) return undefined;

    const numComponentsInFile = getNumComponentsInSourceFile(sourceFile);
    const usedIdentifiers = collectIdentifiers(sourceFile);

    reactClassDeclarations.forEach((classDeclaration) => {
      const componentName = (classDeclaration.name && classDeclaration.name.text) || 'Component';
      const heritageType = getReactComponentHeritageType(classDeclaration)!;
      const heritageTypeArgs = heritageType.typeArguments || [];
      const propsType = heritageTypeArgs[0];
      const stateType = heritageTypeArgs[1];
      if (stateType) return;

      const evidence = collectStateEvidence(classDeclaration);
      if (!evidence.usesState) return;

      const getStateTypeName = () => {
        let name = '';
        if (propsType && ts.isTypeReferenceNode(propsType) && ts.isIdentifier(propsType.typeName)) {
          name = propsType.typeName.text.replace('Props', 'State');
        } else if (numComponentsInFile > 1) {
          name = `${componentName}State`;
        } else {
          name = 'State';
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

      const stateTypeName = getStateTypeName();
      const createAnyType = (): ts.TypeNode =>
        options.anyAlias != null
          ? ts.factory.createTypeReferenceNode(options.anyAlias, undefined)
          : ts.factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);
      const stateTypeNode = createStateTypeNode(evidence, createAnyType);
      const newStateType = ts.factory.createTypeAliasDeclaration(
        undefined,
        stateTypeName,
        undefined,
        stateTypeNode,
      );

      // The type a `state = {...}` property infers on its own shadows the state
      // type parameter at every this.state read.
      const stateProperty = classDeclaration.members.find(isStateProperty);
      if (stateProperty && !stateProperty.type && ts.isTypeLiteralNode(stateTypeNode)) {
        updates.push({
          kind: 'insert',
          index: (stateProperty.exclamationToken || stateProperty.name).end,
          text: `: ${stateTypeName}`,
        });
      }

      updates.push({
        kind: 'insert',
        index: classDeclaration.pos,
        text: `\n\n${printer.printNode(ts.EmitHint.Unspecified, newStateType, sourceFile)}`,
      });

      updates.push({
        kind: 'replace',
        index: heritageType.pos,
        length: heritageType.end - heritageType.pos,
        text: ` ${printer.printNode(
          ts.EmitHint.Unspecified,
          ts.factory.updateExpressionWithTypeArguments(heritageType, heritageType.expression, [
            // `object` rather than `{}` (no-empty-object-type) or `Record<string, never>`,
            // whose index signature types unknown prop accesses as `never` instead of erroring.
            propsType || ts.factory.createKeywordTypeNode(ts.SyntaxKind.ObjectKeyword),
            ts.factory.createTypeReferenceNode(stateTypeName, undefined),
          ]),
          sourceFile,
        )}`,
      });
    });

    return updateSourceText(sourceFile.text, updates);
  },

  validate: validateAnyAliasOptions,
};

export default reactClassStatePlugin;

function collectStateEvidence(classDeclaration: ts.ClassDeclaration): StateEvidence {
  const evidence: StateEvidence = {
    usesState: false,
    members: new Map(),
    numInitializers: 0,
    unknownMembers: false,
  };

  const getMember = (name: string): StateMember => {
    let member = evidence.members.get(name);
    if (!member) {
      member = { type: undefined, numInitializers: 0 };
      evidence.members.set(name, member);
    }
    return member;
  };

  const readObjectLiteral = (objectLiteral: ts.ObjectLiteralExpression, isInitializer: boolean) => {
    objectLiteral.properties.forEach((property) => {
      if (ts.isSpreadAssignment(property)) {
        // `{ ...this.state }` contributes no members of its own, any other spread hides them.
        if (!isThisState(property.expression)) {
          evidence.unknownMembers = true;
        }
        return;
      }

      const name = getPropertyName(property.name);
      if (name === undefined) {
        evidence.unknownMembers = true;
        return;
      }

      const type = ts.isPropertyAssignment(property) ? deriveType(property.initializer) : undefined;
      const member = getMember(name);
      member.type = mergeTypes(member.type, type);
      if (isInitializer) {
        member.numInitializers += 1;
      }
    });
  };

  const readStateInitializer = (expression: ts.Expression) => {
    if (!ts.isObjectLiteralExpression(expression)) {
      evidence.unknownMembers = true;
      return;
    }

    evidence.numInitializers += 1;
    readObjectLiteral(expression, true);
  };

  const readBindingPattern = (pattern: ts.ObjectBindingPattern) => {
    pattern.elements.forEach((element) => {
      if (element.dotDotDotToken) return;

      let name: string | undefined;
      if (element.propertyName) {
        name = getPropertyName(element.propertyName);
      } else if (ts.isIdentifier(element.name)) {
        name = element.name.text;
      }

      if (name === undefined) {
        evidence.unknownMembers = true;
        return;
      }

      getMember(name);
    });
  };

  const readUpdaterResult = (expression: ts.Expression) => {
    const result = ts.isParenthesizedExpression(expression) ? expression.expression : expression;
    if (ts.isObjectLiteralExpression(result)) {
      readObjectLiteral(result, false);
      return;
    }

    // An updater returning null leaves the state alone.
    if (result.kind !== ts.SyntaxKind.NullKeyword) {
      evidence.unknownMembers = true;
    }
  };

  const readUpdater = (updater: ts.ArrowFunction | ts.FunctionExpression) => {
    const [parameter] = updater.parameters;
    if (parameter && ts.isObjectBindingPattern(parameter.name)) {
      readBindingPattern(parameter.name);
    } else if (parameter && ts.isIdentifier(parameter.name)) {
      const parameterName = parameter.name.text;
      const visitRead = (node: ts.Node) => {
        if (
          ts.isPropertyAccessExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === parameterName
        ) {
          getMember(node.name.text);
        }
        ts.forEachChild(node, visitRead);
      };
      visitRead(updater.body);
    }

    if (ts.isBlock(updater.body)) {
      forEachReturnedExpression(updater.body, readUpdaterResult);
    } else {
      readUpdaterResult(updater.body);
    }
  };

  const readSetStateArgument = (argument: ts.Expression) => {
    if (ts.isObjectLiteralExpression(argument)) {
      readObjectLiteral(argument, false);
      return;
    }

    if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) {
      readUpdater(argument);
      return;
    }

    evidence.unknownMembers = true;
  };

  const visit = (node: ts.Node) => {
    if (isThisState(node)) {
      evidence.usesState = true;
    } else if (ts.isPropertyAccessExpression(node) && isThisState(node.expression)) {
      getMember(node.name.text);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      isThisState(node.left)
    ) {
      readStateInitializer(node.right);
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      isThisState(node.initializer) &&
      ts.isObjectBindingPattern(node.name)
    ) {
      readBindingPattern(node.name);
    } else if (isThisSetStateCall(node)) {
      evidence.usesState = true;
      if (node.arguments.length > 0) {
        readSetStateArgument(node.arguments[0]);
      }
    }

    ts.forEachChild(node, visit);
  };

  classDeclaration.members.forEach((member) => {
    if (isStateProperty(member) && member.initializer) {
      readStateInitializer(member.initializer);
    }
    ts.forEachChild(member, visit);
  });

  return evidence;
}

function createStateTypeNode(
  evidence: StateEvidence,
  createAnyType: () => ts.TypeNode,
): ts.TypeNode {
  if (evidence.unknownMembers || evidence.members.size === 0) {
    return createAnyType();
  }

  const createTypeNode = (type: DerivedType | undefined): ts.TypeNode => {
    if (type === undefined || type.kind === 'any') {
      return createAnyType();
    }
    return type.kind === 'array'
      ? ts.factory.createArrayTypeNode(createTypeNode(type.element))
      : ts.factory.createKeywordTypeNode(type.keyword);
  };

  return ts.factory.createTypeLiteralNode(
    Array.from(evidence.members, ([name, member]) =>
      ts.factory.createPropertySignature(
        undefined,
        identifierNamePattern.test(name)
          ? ts.factory.createIdentifier(name)
          : ts.factory.createStringLiteral(name),
        // Members an initializer does not set are undefined until setState writes them.
        evidence.numInitializers > 0 && member.numInitializers < evidence.numInitializers
          ? ts.factory.createToken(ts.SyntaxKind.QuestionToken)
          : undefined,
        createTypeNode(member.type),
      ),
    ),
  );
}

function deriveType(expression: ts.Expression): DerivedType | undefined {
  if (ts.isParenthesizedExpression(expression)) {
    return deriveType(expression.expression);
  }

  switch (expression.kind) {
    case ts.SyntaxKind.TrueKeyword:
    case ts.SyntaxKind.FalseKeyword:
      return { kind: 'keyword', keyword: ts.SyntaxKind.BooleanKeyword };
    case ts.SyntaxKind.NumericLiteral:
      return { kind: 'keyword', keyword: ts.SyntaxKind.NumberKeyword };
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
    case ts.SyntaxKind.TemplateExpression:
      return { kind: 'keyword', keyword: ts.SyntaxKind.StringKeyword };
    case ts.SyntaxKind.NullKeyword:
      return { kind: 'any' };
    default:
      break;
  }

  if (ts.isIdentifier(expression) && expression.text === 'undefined') {
    return { kind: 'any' };
  }

  if (
    ts.isPrefixUnaryExpression(expression) &&
    (expression.operator === ts.SyntaxKind.MinusToken ||
      expression.operator === ts.SyntaxKind.PlusToken) &&
    ts.isNumericLiteral(expression.operand)
  ) {
    return { kind: 'keyword', keyword: ts.SyntaxKind.NumberKeyword };
  }

  if (ts.isArrayLiteralExpression(expression)) {
    const elements =
      expression.elements.length > 0 && !expression.elements.some(ts.isSpreadElement)
        ? expression.elements.map(deriveType)
        : [undefined];
    return { kind: 'array', element: elements.reduce(mergeTypes) };
  }

  return undefined;
}

function mergeTypes(
  a: DerivedType | undefined,
  b: DerivedType | undefined,
): DerivedType | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;

  if (a.kind === 'array' && b.kind === 'array') {
    return { kind: 'array', element: mergeTypes(a.element, b.element) };
  }

  if (a.kind === 'keyword' && b.kind === 'keyword' && a.keyword === b.keyword) {
    return a;
  }

  return { kind: 'any' };
}

function forEachReturnedExpression(body: ts.Block, callback: (node: ts.Expression) => void) {
  const visit = (node: ts.Node) => {
    if (ts.isFunctionLike(node)) return;

    if (ts.isReturnStatement(node)) {
      if (node.expression) {
        callback(node.expression);
      }
      return;
    }

    ts.forEachChild(node, visit);
  };

  ts.forEachChild(body, visit);
}

function getPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }

  if (
    ts.isComputedPropertyName(name) &&
    (ts.isStringLiteral(name.expression) || ts.isNumericLiteral(name.expression))
  ) {
    return name.expression.text;
  }

  return undefined;
}

function isStateProperty(member: ts.ClassElement): member is ts.PropertyDeclaration {
  return (
    ts.isPropertyDeclaration(member) &&
    ts.isIdentifier(member.name) &&
    member.name.text === 'state' &&
    !member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)
  );
}

function isThisState(node: ts.Node): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ThisKeyword &&
    node.name.text === 'state'
  );
}

function isThisSetStateCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.expression.kind === ts.SyntaxKind.ThisKeyword &&
    node.expression.name.text === 'setState'
  );
}
