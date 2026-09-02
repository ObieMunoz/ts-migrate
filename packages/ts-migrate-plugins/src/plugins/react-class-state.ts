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
import { buildTypeNode } from './utils/typeStrings';
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
  // What the checker answered, as the members of a union rather than the text
  // of one, so that merging is a list operation and nothing is parsed back out.
  | { kind: 'resolved'; members: ts.TypeNode[] };

type Resolution = {
  checker: ts.TypeChecker;
  // What run() will add to the file, for a caller that took an answer.
  imports: NamedImport[];
  // The imports the file needs to spell the given names, or undefined where one
  // of them is a name it cannot be given.
  resolveImports: (type: ts.Type, names: Set<string>) => NamedImport[] | undefined;
};

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

const printer = ts.createPrinter();

// Somewhere to print a synthesized node into, for comparing one against another.
// Shared across runs, so nothing per-run belongs here.
const scratchFile = ts.createSourceFile('scratch.ts', '', ts.ScriptTarget.Latest);

const reactClassStatePlugin: Plugin<Options> = {
  name: 'react-class-state',

  async run({ fileName, sourceFile, options, getLanguageService }) {
    if (!fileName.endsWith('.tsx')) return undefined;

    const { anyAlias } = options;
    const updates: SourceTextUpdate[] = [];
    const neededImports: NamedImport[] = [];

    const reactClassDeclarations = sourceFile.statements
      .filter(ts.isClassDeclaration)
      .filter(isReactClassComponent);
    if (reactClassDeclarations.length === 0) return undefined;

    // Asked only where the syntax says nothing.
    const checker = getLanguageService?.().getProgram?.()?.getTypeChecker();
    const resolution =
      checker && createResolution(checker, sourceFile, fileName, anyAlias, neededImports);

    const numComponentsInFile = getNumComponentsInSourceFile(sourceFile);
    const usedIdentifiers = collectIdentifiers(sourceFile);

    reactClassDeclarations.forEach((classDeclaration) => {
      const componentName = (classDeclaration.name && classDeclaration.name.text) || 'Component';
      const heritageType = getReactComponentHeritageType(classDeclaration)!;
      const heritageTypeArgs = heritageType.typeArguments || [];
      const propsType = heritageTypeArgs[0];
      const stateType = heritageTypeArgs[1];
      if (stateType) return;

      const evidence = collectStateEvidence(classDeclaration, resolution, anyAlias);
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
      const inferredMembers = inferStateMembers(evidence, anyAlias);
      const newStateType = ts.factory.createTypeAliasDeclaration(
        undefined,
        stateTypeName,
        undefined,
        inferredMembers ?? anyTypeNode(anyAlias),
      );

      // The type a `state = {...}` property infers on its own shadows the state
      // type parameter at every this.state read.
      const stateProperty = classDeclaration.members.find(isStateProperty);
      if (stateProperty && !stateProperty.type && inferredMembers) {
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
    );
    const importUpdates = updateImports(updatedSourceFile, neededImports, []);
    return importUpdates.length > 0 ? updateSourceText(updatedText, importUpdates) : updatedText;
  },

  validate: validateAnyAliasOptions,
};

export default reactClassStatePlugin;

function collectStateEvidence(
  classDeclaration: ts.ClassDeclaration,
  resolution: Resolution | undefined,
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
        type = deriveType(property.initializer, resolution, anyAlias);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        // `{ mins }` is worth as much as the binding it names is typed.
        type = deriveType(property.name, resolution, anyAlias);
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
    // whatever the expression resolves to. Its methods are not state members.
    const properties = resolution
      ? resolution.checker
          .getTypeAtLocation(expression)
          .getProperties()
          .filter((symbol) => (symbol.flags & ts.SymbolFlags.Property) !== 0)
      : [];
    if (!resolution || properties.length === 0) {
      evidence.unknownMembers = true;
      return;
    }

    evidence.numInitializers += 1;
    properties.forEach((symbol) => {
      const member = getMember(symbol.getName());
      // A property the type marks optional is one this initializer may not set.
      const isOptional = (symbol.flags & ts.SymbolFlags.Optional) !== 0;
      const type = resolveType(
        resolution.checker.getTypeOfSymbolAtLocation(symbol, expression),
        resolution,
        anyAlias,
      );
      observe(member, isOptional ? withoutUndefined(type) : type);
      if (!isOptional) {
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
      observe(member, deriveType(node.right, resolution, anyAlias));
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

// The members the evidence describes, or undefined where it describes no
// shape at all and the alias is written as `any` instead.
function inferStateMembers(
  evidence: StateEvidence,
  anyAlias: string | undefined,
): ts.TypeLiteralNode | undefined {
  if (evidence.unknownMembers || evidence.members.size === 0) {
    return undefined;
  }

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
        typeNodeOf(member.type, anyAlias),
      ),
    ),
  );
}

// The names a resolved member type spells have to be in scope where the alias
// is written: declared in this file, global, or imported. A type declared where
// nothing can import it from, inside a function or private to a package, would
// leave the member naming something the file does not have, and is refused.
function createResolution(
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  fileName: string,
  anyAlias: string | undefined,
  imports: NamedImport[],
): Resolution {
  // Every global type there is, so read only once a type has resolved at all.
  let inScope: Map<string, ts.Symbol> | undefined;
  const namesInScope = () => (inScope ??= collectScope(checker, sourceFile));

  return {
    checker,
    imports,
    resolveImports: (type, names) => {
      const resolved: NamedImport[] = [];
      // Every symbol the walk considered, which is what the names printed for
      // this type stand for.
      const seen = new Set<ts.Symbol>();
      collectImportSpecs(type, checker, fileName, seen, resolved);
      const importable = new Set(resolved.map(({ namedImport }) => namedImport));
      const printedAs = new Map([...seen].map((symbol) => [symbol.getName(), symbol] as const));
      const scope = namesInScope();

      const writable = [...names].every((name) => {
        if (name === anyAlias) return true;
        const bound = scope.get(name);
        // A name the file already has has to stand for the thing the checker
        // printed it for, not for whatever else the file calls by it.
        if (bound !== undefined) {
          const symbol = printedAs.get(name);
          return symbol === undefined || symbol === bound;
        }
        return importable.has(name);
      });
      return writable ? resolved : undefined;
    },
  };
}

// What each name the file has stands for, innermost declaration first, with an
// import read through to what it imports. Alias as well as Type in the meaning:
// whatever an imported name stands for, the symbol the file has for it is an
// alias, and importing is how most of these names are already here.
function collectScope(checker: ts.TypeChecker, sourceFile: ts.SourceFile): Map<string, ts.Symbol> {
  const scope = new Map<string, ts.Symbol>();
  checker
    .getSymbolsInScope(sourceFile, ts.SymbolFlags.Type | ts.SymbolFlags.Alias)
    .forEach((symbol) => {
      const name = symbol.getName();
      if (scope.has(name)) return;
      scope.set(
        name,
        symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol,
      );
    });
  return scope;
}

// The names a type node spells. A `typeof` query names a binding
// moduleScopedName already found at the top level of this file.
function collectTypeNames(node: ts.TypeNode, out: Set<string>): void {
  if (ts.isTypeReferenceNode(node)) {
    let entityName: ts.EntityName = node.typeName;
    while (ts.isQualifiedName(entityName)) entityName = entityName.left;
    out.add(entityName.text);
    node.typeArguments?.forEach((argument) => collectTypeNames(argument, out));
  } else if (ts.isUnionTypeNode(node)) {
    node.types.forEach((type) => collectTypeNames(type, out));
  } else if (ts.isArrayTypeNode(node)) {
    collectTypeNames(node.elementType, out);
  } else if (ts.isParenthesizedTypeNode(node)) {
    collectTypeNames(node.type, out);
  }
}

// The `?` on the member says what the `| undefined` the checker prints on an
// optional property says, and the member is written with one or the other.
function withoutUndefined(type: DerivedType): DerivedType {
  if (type.kind !== 'resolved') return type;
  const members = type.members.filter((node) => node.kind !== ts.SyntaxKind.UndefinedKeyword);
  return members.length === 0 ? type : { ...type, members };
}

// The member's type as the one node it is written as.
function typeNodeOf(type: DerivedType | undefined, anyAlias: string | undefined): ts.TypeNode {
  const members = typeNodesOf(type, anyAlias);
  return members.length === 1 ? members[0] : ts.factory.createUnionTypeNode(members);
}

// A derived type as the members of the union it stands for, which is what a
// merge concatenates.
function typeNodesOf(type: DerivedType | undefined, anyAlias: string | undefined): ts.TypeNode[] {
  if (type === undefined || type.kind === 'any') return [anyTypeNode(anyAlias)];
  if (type.kind === 'resolved') return type.members;
  if (type.kind === 'array') {
    const element = typeNodesOf(type.element, anyAlias);
    return [
      ts.factory.createArrayTypeNode(
        element.length === 1
          ? element[0]
          : ts.factory.createParenthesizedType(ts.factory.createUnionTypeNode(element)),
      ),
    ];
  }
  return [ts.factory.createKeywordTypeNode(type.keyword)];
}

function isAnyTypeNode(node: ts.TypeNode, anyAlias: string | undefined): boolean {
  if (node.kind === ts.SyntaxKind.AnyKeyword) return true;
  return (
    anyAlias != null &&
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    node.typeName.text === anyAlias
  );
}

// An `any` member says nothing beside one that resolved, so it is dropped
// unless every member is `any`, which is all the observations amount to.
function mergeMembers(members: ts.TypeNode[], anyAlias: string | undefined): ts.TypeNode[] {
  const concrete = members.filter((node) => !isAnyTypeNode(node, anyAlias));
  const kept = concrete.length > 0 ? concrete : [anyTypeNode(anyAlias)];
  const seen = new Set<string>();
  return kept.filter((node) => {
    const text = printer.printNode(ts.EmitHint.Unspecified, node, scratchFile);
    if (seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

// buildTypeNode writes `any` both for the keyword and for a shape it cannot
// reconstruct, and the alias is how this run spells that. Rewriting the node
// rather than the text is what leaves a literal whose own text is the keyword
// alone.
function withAnyAlias(node: ts.TypeNode, anyAlias: string | undefined): ts.TypeNode {
  if (anyAlias == null) return node;
  if (node.kind === ts.SyntaxKind.AnyKeyword) return anyTypeNode(anyAlias);
  if (ts.isUnionTypeNode(node)) {
    return ts.factory.createUnionTypeNode(node.types.map((type) => withAnyAlias(type, anyAlias)));
  }
  if (ts.isArrayTypeNode(node)) {
    return ts.factory.createArrayTypeNode(withAnyAlias(node.elementType, anyAlias));
  }
  if (ts.isParenthesizedTypeNode(node)) {
    return ts.factory.createParenthesizedType(withAnyAlias(node.type, anyAlias));
  }
  if (ts.isTypeReferenceNode(node) && node.typeArguments) {
    return ts.factory.createTypeReferenceNode(
      node.typeName,
      node.typeArguments.map((type) => withAnyAlias(type, anyAlias)),
    );
  }
  return node;
}

// What the checker says a type is, in the form the rest of this plugin writes.
//
// NoTruncation because typeToString otherwise cuts a long type off with `...`
// and `... N more ...`, which is a display default rather than a limit on what
// it can say. What buildTypeNode cannot parse at any length is the `any` it
// would have been anyway.
function resolveType(
  type: ts.Type,
  resolution: Resolution,
  anyAlias: string | undefined,
): DerivedType {
  let typeStr = resolution.checker.typeToString(
    resolution.checker.getBaseTypeOfLiteralType(type),
    // No enclosing declaration, so a nested reference prints as a bare name
    // rather than qualified against a scope, which is the name to import.
    undefined,
    ts.TypeFormatFlags.AllowUniqueESSymbolType |
      ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope |
      ts.TypeFormatFlags.NoTruncation,
  );
  // A type declared in another file prints with an `import("…").` prefix that
  // is not writable; the name alone is, once the file imports it.
  typeStr = typeStr.replace(/^import\("[^"]+"\)\./, '');
  // buildTypeNode parses an import type, so one left in a nested position would
  // be spliced into the file as an absolute path rather than refused.
  if (typeStr.includes('import("')) return { kind: 'any' };

  const node = withAnyAlias(buildTypeNode(typeStr), anyAlias);
  if (isAnyTypeNode(node, anyAlias)) return { kind: 'any' };

  const names = new Set<string>();
  collectTypeNames(node, names);
  const imports = resolution.resolveImports(type, names);
  if (imports === undefined) return { kind: 'any' };
  // An import for a member that merging later drops costs nothing:
  // updateImports only adds a name the text goes on to use.
  resolution.imports.push(...imports);

  const members = ts.isUnionTypeNode(node) ? Array.from(node.types) : [node];
  return { kind: 'resolved', members: mergeMembers(members, anyAlias) };
}

function deriveType(
  expression: ts.Expression,
  resolution: Resolution | undefined,
  anyAlias: string | undefined,
): DerivedType | undefined {
  if (ts.isParenthesizedExpression(expression)) {
    return deriveType(expression.expression, resolution, anyAlias);
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
        ? expression.elements.map((element) => deriveType(element, resolution, anyAlias))
        : [undefined];
    return {
      kind: 'array',
      element: elements.reduce((left, right) => mergeTypes(left, right, anyAlias)),
    };
  }

  if (!resolution) return undefined;
  const { checker } = resolution;
  const resolved = resolveType(checker.getTypeAtLocation(expression), resolution, anyAlias);
  if (resolved.kind !== 'any') return resolved;
  // An answer of `any` is the checker having nothing to say rather than
  // evidence that the member holds anything, so it is carried as a resolved
  // member for merging to drop against an observation that does say something.
  return (
    typeQueryType(expression, checker) ?? {
      kind: 'resolved',
      members: [anyTypeNode(anyAlias)],
    }
  );
}

// A type the checker cannot write is still named by the expression that has it.
// The alias is written at the top of that expression's own file, so a binding
// declared there is in scope already and the query needs no import.
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
    return {
      kind: 'resolved',
      members: [
        ts.factory.createTypeReferenceNode('ReturnType', [
          ts.factory.createTypeQueryNode(ts.factory.createIdentifier(callee)),
        ]),
      ],
    };
  }

  const name = moduleScopedName(expression, checker);
  return name === undefined
    ? undefined
    : {
        kind: 'resolved',
        members: [ts.factory.createTypeQueryNode(ts.factory.createIdentifier(name))],
      };
}

// The name of a binding declared at the top level of its file. Resolving the
// symbol rather than reading the text is what tells a local that shadows an
// import from the import.
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
  // other side observed, which is what mergeMembers drops.
  if (a.kind === 'resolved' || b.kind === 'resolved') {
    return {
      kind: 'resolved',
      members: mergeMembers([...typeNodesOf(a, anyAlias), ...typeNodesOf(b, anyAlias)], anyAlias),
    };
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
