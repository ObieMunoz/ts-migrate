import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import {
  isReactClassComponent,
  getReactComponentHeritageType,
  getNumComponentsInSourceFile,
  replaceHeritageTypeArguments,
} from './utils/react';
import { collectIdentifiers, isIdentifierName } from './utils/identifiers';
import { uniqueTypeName } from './utils/react-props';
import { isStatic } from './utils/modifiers';
import { anyTypeNode } from './utils/anyTypes';
import { updateImports, NamedImport } from './utils/imports';
import { collectImportSpecs } from './utils/importSpecs';
import { buildTypeNode, typeStrDegradesToAny, widenTypes } from './utils/typeStrings';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';
import { AnyAliasOptions, validateAnyAliasOptions } from '../utils/validateOptions';
import { getOrCreate } from '../utils/maps';

type Options = AnyAliasOptions;

// `undefined` is the absence of evidence, `any` is evidence that the member
// holds anything, such as a null initializer or two conflicting writes.
type DerivedType =
  | { kind: 'any' }
  | { kind: 'keyword'; keyword: ts.KeywordTypeSyntaxKind }
  | { kind: 'array'; element: DerivedType | undefined }
  // What the checker answered where the syntax alone said nothing, carried as
  // text plus the types it came from so the names it uses can be imported.
  | { kind: 'resolved'; typeStr: string; tsTypes: ts.Type[] };

type StateMember = {
  type: DerivedType | undefined;
  numInitializers: number;
  // Written outside any initializer by a statement that provably runs, so the
  // member is set whatever the initializers do or do not say.
  alwaysSet: boolean;
};

type StateEvidence = {
  usesState: boolean;
  members: Map<string, StateMember>;
  numInitializers: number;
  unknownMembers: boolean;
};

const reactClassStatePlugin: Plugin<Options> = {
  name: 'react-class-state',

  async run({ fileName, sourceFile, options, getLanguageService }) {
    if (!fileName.endsWith('.tsx')) return undefined;

    const { anyAlias } = options;
    const updates: SourceTextUpdate[] = [];
    const neededImports: NamedImport[] = [];
    const printer = ts.createPrinter();

    const reactClassDeclarations = sourceFile.statements
      .filter(ts.isClassDeclaration)
      .filter(isReactClassComponent);
    if (reactClassDeclarations.length === 0) return undefined;

    // Asked only where the syntax says nothing. A harness that hands the plugin
    // no program is the case the derivation below was written for, so the
    // answer without one is the answer this plugin has always given.
    const checker = getLanguageService?.().getProgram?.()?.getTypeChecker();

    const numComponentsInFile = getNumComponentsInSourceFile(sourceFile);
    const usedIdentifiers = collectIdentifiers(sourceFile);

    reactClassDeclarations.forEach((classDeclaration) => {
      const componentName = (classDeclaration.name && classDeclaration.name.text) || 'Component';
      const heritageType = getReactComponentHeritageType(classDeclaration)!;
      const heritageTypeArgs = heritageType.typeArguments || [];
      const propsType = heritageTypeArgs[0];
      const stateType = heritageTypeArgs[1];
      if (stateType) return;

      const evidence = collectStateEvidence(classDeclaration, checker, anyAlias);
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

        return uniqueTypeName(name, usedIdentifiers);
      };

      const stateTypeName = getStateTypeName();
      const stateTypeNode = createStateTypeNode(evidence, anyAlias);
      if (checker && ts.isTypeLiteralNode(stateTypeNode)) {
        collectStateImports(evidence, checker, fileName, anyAlias, neededImports);
      }
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

      updates.push(
        replaceHeritageTypeArguments(
          heritageType,
          [
            // `object` rather than `{}` (no-empty-object-type) or `Record<string, never>`,
            // whose index signature types unknown prop accesses as `never` instead of erroring.
            propsType || ts.factory.createKeywordTypeNode(ts.SyntaxKind.ObjectKeyword),
            ts.factory.createTypeReferenceNode(stateTypeName, undefined),
          ],
          printer,
          sourceFile,
        ),
      );
    });

    const updatedText = updateSourceText(sourceFile.text, updates);
    if (neededImports.length === 0) return updatedText;

    // updateImports only adds a name the text actually uses, so a spec
    // collected for a member that ended up printed as `any` costs nothing.
    const updatedSourceFile = ts.createSourceFile(
      fileName,
      updatedText,
      sourceFile.languageVersion,
      /* setParentNodes */ true,
    );
    const importUpdates = updateImports(updatedSourceFile, neededImports, []);
    return importUpdates.length > 0 ? updateSourceText(updatedText, importUpdates) : updatedText;
  },

  validate: validateAnyAliasOptions,
};

export default reactClassStatePlugin;

function collectStateEvidence(
  classDeclaration: ts.ClassDeclaration,
  checker: ts.TypeChecker | undefined,
  anyAlias: string | undefined,
): StateEvidence {
  const evidence: StateEvidence = {
    usesState: false,
    members: new Map(),
    numInitializers: 0,
    unknownMembers: false,
  };

  const getMember = (name: string): StateMember =>
    getOrCreate(evidence.members, name, () => ({
      type: undefined,
      numInitializers: 0,
      alwaysSet: false,
    }));

  const observe = (member: StateMember, type: DerivedType | undefined) => {
    member.type = mergeTypes(member.type, type, anyAlias);
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

      let type: DerivedType | undefined;
      if (ts.isPropertyAssignment(property)) {
        type = deriveType(property.initializer, checker, anyAlias);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        // `{ mins }` is worth as much as the binding it names is typed.
        type = deriveType(property.name, checker, anyAlias);
      }
      const member = getMember(name);
      observe(member, type);
      if (isInitializer) {
        member.numInitializers += 1;
      }
    });
  };

  const readStateInitializer = (expression: ts.Expression) => {
    if (ts.isObjectLiteralExpression(expression)) {
      evidence.numInitializers += 1;
      readObjectLiteral(expression, true);
      return;
    }

    // `this.state = getStateFromProps(props)`: the shape is the properties of
    // whatever the expression resolves to.
    const properties = checker ? checker.getTypeAtLocation(expression).getProperties() : [];
    if (!checker || properties.length === 0) {
      evidence.unknownMembers = true;
      return;
    }

    evidence.numInitializers += 1;
    properties.forEach((symbol) => {
      const member = getMember(symbol.getName());
      observe(
        member,
        resolveType(checker.getTypeOfSymbolAtLocation(symbol, expression), checker, anyAlias),
      );
      // A property the type marks optional is one this initializer may not set.
      if ((symbol.flags & ts.SymbolFlags.Optional) === 0) {
        member.numInitializers += 1;
      }
    });
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
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      isThisState(node.left.expression)
    ) {
      const member = getMember(node.left.name.text);
      observe(member, deriveType(node.right, checker, anyAlias));
      if (isUnconditionalConstructorWrite(node, classDeclaration)) {
        member.alwaysSet = true;
      }
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

// Whether an assignment has run by the time the component is constructed. Only
// a statement of the constructor's own body qualifies: anywhere else it is a
// write that may not have happened, or may not happen at all.
function isUnconditionalConstructorWrite(
  assignment: ts.BinaryExpression,
  classDeclaration: ts.ClassDeclaration,
): boolean {
  if (!ts.isExpressionStatement(assignment.parent)) return false;

  let node: ts.Node = assignment.parent;
  while (ts.isBlock(node.parent)) {
    node = node.parent;
  }
  return ts.isConstructorDeclaration(node.parent) && node.parent.parent === classDeclaration;
}

function createStateTypeNode(evidence: StateEvidence, anyAlias: string | undefined): ts.TypeNode {
  if (evidence.unknownMembers || evidence.members.size === 0) {
    return anyTypeNode(anyAlias);
  }

  const createTypeNode = (type: DerivedType | undefined): ts.TypeNode => {
    if (type === undefined || type.kind === 'any') {
      return anyTypeNode(anyAlias);
    }
    if (type.kind === 'resolved') {
      return buildTypeNode(type.typeStr, anyAlias);
    }
    return type.kind === 'array'
      ? ts.factory.createArrayTypeNode(createTypeNode(type.element))
      : ts.factory.createKeywordTypeNode(type.keyword);
  };

  return ts.factory.createTypeLiteralNode(
    Array.from(evidence.members, ([name, member]) =>
      ts.factory.createPropertySignature(
        undefined,
        isIdentifierName(name)
          ? ts.factory.createIdentifier(name)
          : ts.factory.createStringLiteral(name),
        // Members an initializer does not set are undefined until setState writes them.
        !member.alwaysSet &&
        evidence.numInitializers > 0 &&
        member.numInitializers < evidence.numInitializers
          ? ts.factory.createToken(ts.SyntaxKind.QuestionToken)
          : undefined,
        createTypeNode(member.type),
      ),
    ),
  );
}

// The names a resolved member type spells have to be in scope where the alias
// is written, which for a type from another module means importing them.
function collectStateImports(
  evidence: StateEvidence,
  checker: ts.TypeChecker,
  fileName: string,
  anyAlias: string | undefined,
  out: NamedImport[],
): void {
  const seen = new Set<ts.Symbol>();
  const visit = (type: DerivedType | undefined) => {
    if (type === undefined) return;
    if (type.kind === 'array') {
      visit(type.element);
      return;
    }
    if (type.kind !== 'resolved' || isAnyTypeStr(type.typeStr, anyAlias)) return;
    type.tsTypes.forEach((tsType) => collectImportSpecs(tsType, checker, fileName, seen, out));
  };
  evidence.members.forEach((member) => visit(member.type));
}

function isAnyTypeStr(typeStr: string, anyAlias: string | undefined): boolean {
  return typeStr === 'any' || (anyAlias != null && typeStr === anyAlias);
}

// The text form of a derived type, for the cases merging has to go through
// widenTypes to answer.
function typeStrOf(type: DerivedType | undefined, anyAlias: string | undefined): string {
  if (type === undefined || type.kind === 'any') return anyAlias ?? 'any';
  if (type.kind === 'resolved') return type.typeStr;
  if (type.kind === 'array') return `${typeStrOf(type.element, anyAlias)}[]`;
  return ts.tokenToString(type.keyword) ?? anyAlias ?? 'any';
}

// What the checker says a type is, in the form the rest of this plugin writes.
//
// NoTruncation because typeToString otherwise cuts a long type off with `...`
// and `... N more ...`, which are display markers rather than a limit on what
// it can say: a wide union or a deep generic reference is written in full and
// reads back. What is left after that is the shapes buildTypeNode does not
// parse at any length, recorded as the `any` they would have been anyway.
function resolveType(
  type: ts.Type,
  checker: ts.TypeChecker,
  anyAlias: string | undefined,
): DerivedType {
  let typeStr = checker.typeToString(
    checker.getBaseTypeOfLiteralType(type),
    undefined,
    ts.TypeFormatFlags.AllowUniqueESSymbolType |
      ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
      ts.TypeFormatFlags.NoTruncation,
  );
  // A type declared in another file prints with an `import("…").` prefix that
  // is not writable; the name alone is, once collectStateImports imports it.
  typeStr = typeStr.replace(/^import\("[^"]+"\)\./, '');
  // buildTypeNode parses an import type, so one left in a nested position would
  // be spliced into the file as an absolute path rather than refused.
  if (typeStr.includes('import("')) return { kind: 'any' };
  // So that a checker-produced `any[]` dedupes against the `$TSFixMe[]` an
  // empty array literal derives rather than unioning with it.
  if (anyAlias != null) typeStr = typeStr.replace(/\bany\b/g, anyAlias);
  if (typeStrDegradesToAny(typeStr)) return { kind: 'any' };
  return { kind: 'resolved', typeStr, tsTypes: [type] };
}

function deriveType(
  expression: ts.Expression,
  checker: ts.TypeChecker | undefined,
  anyAlias: string | undefined,
): DerivedType | undefined {
  if (ts.isParenthesizedExpression(expression)) {
    return deriveType(expression.expression, checker, anyAlias);
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
        ? expression.elements.map((element) => deriveType(element, checker, anyAlias))
        : [undefined];
    return {
      kind: 'array',
      element: elements.reduce((left, right) => mergeTypes(left, right, anyAlias)),
    };
  }

  if (!checker) return undefined;
  const resolved = resolveType(checker.getTypeAtLocation(expression), checker, anyAlias);
  return resolved.kind === 'any' ? typeQueryType(expression, checker) ?? resolved : resolved;
}

// A type the checker resolves but cannot write is still nameable when the
// expression names the thing that has it. The state alias is written at the top
// of the same file the expression is in, so a binding declared there is already
// in scope and no import follows the query.
function typeQueryType(
  expression: ts.Expression,
  checker: ts.TypeChecker,
): DerivedType | undefined {
  if (ts.isCallExpression(expression)) {
    const callee = moduleScopedName(expression.expression, checker);
    if (callee === undefined || expression.typeArguments !== undefined) return undefined;
    // ReturnType reads the last signature, so it is this call's type only where
    // there is one signature and it is not generic.
    const signatures = checker.getTypeAtLocation(expression.expression).getCallSignatures();
    if (signatures.length !== 1 || (signatures[0].getTypeParameters() ?? []).length > 0) {
      return undefined;
    }
    return { kind: 'resolved', typeStr: `ReturnType<typeof ${callee}>`, tsTypes: [] };
  }

  const name = moduleScopedName(expression, checker);
  return name === undefined
    ? undefined
    : { kind: 'resolved', typeStr: `typeof ${name}`, tsTypes: [] };
}

// The name of a binding declared at the top level of its file. A parameter or a
// local is a name the state alias cannot see, and resolving the symbol rather
// than reading the text is what tells the two apart when a local shadows an
// import.
function moduleScopedName(expression: ts.Expression, checker: ts.TypeChecker): string | undefined {
  if (!ts.isIdentifier(expression)) return undefined;
  const declaration = checker.getSymbolAtLocation(expression)?.declarations?.[0];
  if (declaration === undefined) return undefined;

  for (let node: ts.Node | undefined = declaration.parent; node; node = node.parent) {
    if (ts.isSourceFile(node)) return expression.text;
    if (ts.isFunctionLike(node) || ts.isBlock(node) || ts.isClassLike(node)) return undefined;
  }
  return undefined;
}

function mergeTypes(
  a: DerivedType | undefined,
  b: DerivedType | undefined,
  anyAlias: string | undefined,
): DerivedType | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;

  if (a.kind === 'array' && b.kind === 'array') {
    return { kind: 'array', element: mergeTypes(a.element, b.element, anyAlias) };
  }

  if (a.kind === 'keyword' && b.kind === 'keyword' && a.keyword === b.keyword) {
    return a;
  }

  // Two syntactic answers that are not the same answer are `any`; anything the
  // checker resolved is worth unioning, and worth keeping over an `any` the
  // other side observed, which is what widenTypes' dropAny does.
  if (a.kind === 'resolved' || b.kind === 'resolved') {
    return {
      kind: 'resolved',
      typeStr: widenTypes([typeStrOf(a, anyAlias), typeStrOf(b, anyAlias)], anyAlias, true),
      tsTypes: [...tsTypesOf(a), ...tsTypesOf(b)],
    };
  }

  return { kind: 'any' };
}

function tsTypesOf(type: DerivedType): ts.Type[] {
  return type.kind === 'resolved' ? type.tsTypes : [];
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
    !isStatic(member)
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
