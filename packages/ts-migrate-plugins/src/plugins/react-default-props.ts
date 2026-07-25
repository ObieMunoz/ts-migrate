import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';
import { createValidate, Properties } from '../utils/validateOptions';
import {
  isReactForwardRefName,
  isSfcFunctionExpression,
  ReactSfcFunctionExpression,
  unwrapReactMemo,
} from './utils/react';

type Options = {
  useDefaultPropsHelper?: boolean;
  modernizeDefaultProps?: boolean;
};

const optionProperties: Properties = {
  useDefaultPropsHelper: { type: 'boolean' },
  modernizeDefaultProps: { type: 'boolean' },
};

/**
 * At first, we are going to check is there any
 *  - `CompName.defaultProps = defaultPropsName;`
 *  - `static defaultProps = defaultPropsName`
 *  in the file
 */
const WITH_DEFAULT_PROPS_HELPER = `WithDefaultProps`;

// defaulted keys stay required, typed as the declared prop type or the default's type;
// defaults without a declared prop are added as-is
const WITH_DEFAULT_PROPS_DECLARATION = `type ${WITH_DEFAULT_PROPS_HELPER}<P, D> = Omit<P, keyof D> & { [K in keyof D & keyof P]: Exclude<P[K], undefined> | D[K] } & Omit<D, keyof P>;`;

const reactDefaultPropsPlugin: Plugin<Options> = {
  name: 'react-default-props',

  run({ sourceFile, text, options, reportFileNotice }) {
    const importDeclarations = sourceFile.statements.filter(ts.isImportDeclaration);
    const expressionStatements = sourceFile.statements.filter(ts.isExpressionStatement);
    const classDeclarations = sourceFile.statements.filter(ts.isClassDeclaration);
    const interfaceDeclarations = sourceFile.statements.filter(ts.isInterfaceDeclaration);

    // sfcs default props assignments
    const sfcsDefaultPropsAssignments = expressionStatements.filter(
      (expressionStatement) =>
        ts.isBinaryExpression(expressionStatement.expression) &&
        ts.isPropertyAccessExpression(expressionStatement.expression.left) &&
        expressionStatement.expression.left.name.getText() === 'defaultProps',
    );

    // class default props assigments
    const classDefaultPropsAssignment = classDeclarations.filter(
      (classDeclaration) =>
        classDeclaration.members
          .filter(ts.isPropertyDeclaration)
          .filter((declaration) => declaration.name.getText() === 'defaultProps').length > 0,
    );

    if (sfcsDefaultPropsAssignments.length === 0 && classDefaultPropsAssignment.length === 0) {
      return undefined;
    }

    const functionDeclarations = sourceFile.statements.filter(ts.isFunctionDeclaration);
    const variableStatements = sourceFile.statements.filter(ts.isVariableStatement);
    // will use Props type from here
    const typeAliasDeclarations = sourceFile.statements.filter(ts.isTypeAliasDeclaration);

    const updates: SourceTextUpdate[] = [];
    const printer = ts.createPrinter();
    const processedPropTypes = new Map<string, string>();
    let takenNames: Set<string> | undefined;

    // Function components whose defaults moved into the parameter no longer
    // have an assignment to type, so they skip the intersection path below.
    const modernized = new Set<ts.ExpressionStatement>();
    // A props type this pass edited cannot also be replaced wholesale by the
    // intersection path, so components sharing one are left alone there.
    const editedTypeDeclarations = new Set<ts.Declaration>();
    if (options.modernizeDefaultProps) {
      const markedOptional = new Set<ts.PropertySignature>();
      sfcsDefaultPropsAssignments.forEach((assignment) => {
        const result = modernizeDefaultProps(
          assignment,
          sourceFile,
          [...typeAliasDeclarations, ...interfaceDeclarations],
          markedOptional,
          editedTypeDeclarations,
        );
        if (result.updates) {
          updates.push(...result.updates);
          modernized.add(assignment);
        } else if (result.reason && reportFileNotice) {
          reportFileNotice({
            reason: `Left defaultProps in place: ${result.reason}.`,
            hint: 'React 19 ignores defaultProps on function components, so these need converting by hand.',
            recovered: true,
          });
        }
      });
    }

    let shouldAddWithDefaultPropsHelper =
      !importDeclarations.some((importDeclaration) =>
        /WithDefaultProps/.test(importDeclaration.moduleSpecifier.getText()),
      ) &&
      !typeAliasDeclarations.some(
        (typeAliasDeclaration) => typeAliasDeclaration.name.text === WITH_DEFAULT_PROPS_HELPER,
      );

    const insertWithDefaultPropsHelper = () => {
      if (shouldAddWithDefaultPropsHelper) {
        const lastImportDeclaration = importDeclarations[importDeclarations.length - 1];
        updates.push(
          lastImportDeclaration
            ? {
                kind: 'insert',
                index: lastImportDeclaration.end,
                text: `\n\n${WITH_DEFAULT_PROPS_DECLARATION}`,
              }
            : { kind: 'insert', index: 0, text: `${WITH_DEFAULT_PROPS_DECLARATION}\n` },
        );
        shouldAddWithDefaultPropsHelper = false;
      }
    };

    const modifyAndInsertPropsType = (
      propsTypeAliasDeclaration: ts.TypeAliasDeclaration,
      defaultPropsTypeName: string,
      defaultPropsType: ts.TypeNode,
      propsTypeName: string,
      newTypeInsertPos: number,
      componentTypeReference: ts.TypeReferenceNode,
      componentName: string,
      precedingUpdates: SourceTextUpdate[] = [],
    ): boolean => {
      // we don't want process props types more than once
      if (processedPropTypes.get(propsTypeName) === defaultPropsTypeName) return false;

      if (editedTypeDeclarations.has(propsTypeAliasDeclaration)) return false;

      // prevent multiple usage of defalut props or WithDefaultProps
      const alreadyHaveDefalutProps = ts.isIntersectionTypeNode(propsTypeAliasDeclaration.type)
        ? propsTypeAliasDeclaration.type.types.some(
            (typeExp) =>
              readsDefaultPropsType(typeExp, defaultPropsTypeName) ||
              typeExp.getText().includes(WITH_DEFAULT_PROPS_HELPER),
          )
        : ts.isTypeReferenceNode(propsTypeAliasDeclaration.type) &&
          propsTypeAliasDeclaration.type.typeName.getText() === WITH_DEFAULT_PROPS_HELPER;

      if (alreadyHaveDefalutProps) return false;

      if (options.useDefaultPropsHelper) insertWithDefaultPropsHelper();

      const indexOfTypeValue = ts.isIntersectionTypeNode(propsTypeAliasDeclaration.type)
        ? propsTypeAliasDeclaration.type.types.findIndex((typeEl) => ts.isTypeLiteralNode(typeEl))
        : -1;

      const propTypesAreOnlyReferences =
        ts.isIntersectionTypeNode(propsTypeAliasDeclaration.type) && indexOfTypeValue === -1;

      const propsTypeValueNode = ts.isIntersectionTypeNode(propsTypeAliasDeclaration.type)
        ? ts.factory.updateIntersectionTypeNode(
            propsTypeAliasDeclaration.type,
            ts.factory.createNodeArray(
              propsTypeAliasDeclaration.type.types.filter(
                (_, k) => propTypesAreOnlyReferences || indexOfTypeValue === k,
              ),
            ),
          )
        : propsTypeAliasDeclaration.type;

      const doesPropsTypeHaveExport =
        propsTypeAliasDeclaration.modifiers &&
        propsTypeAliasDeclaration.modifiers.find(
          (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        );

      // rename type PropName -> type OwnPropName
      let updatedProptypesName = `Own${propsTypeName}`;
      // not an ideal way to prevent a double declaration of the OwnPropname,
      // however, this should cover most of the cases
      const alreadyHaveUpdatedName =
        interfaceDeclarations.some((node) => node.name.text.includes(updatedProptypesName)) ||
        typeAliasDeclarations.some((node) => node.name.text.includes(updatedProptypesName));

      updatedProptypesName = alreadyHaveUpdatedName
        ? `Own${componentName}${propsTypeName}`
        : updatedProptypesName;

      const updatedPropTypesName = doesPropsTypeHaveExport ? propsTypeName : updatedProptypesName;
      const updatedPropTypeAlias = ts.factory.updateTypeAliasDeclaration(
        propsTypeAliasDeclaration,
        propsTypeAliasDeclaration.modifiers,
        ts.factory.createIdentifier(updatedPropTypesName),
        propsTypeAliasDeclaration.typeParameters,
        propsTypeValueNode,
      );

      const index = propsTypeAliasDeclaration.pos;
      const length = propsTypeAliasDeclaration.end - index;
      const text = printer.printNode(ts.EmitHint.Unspecified, updatedPropTypeAlias, sourceFile);
      updates.push({ kind: 'replace', index, length, text: `\n\n${text}` });

      // create type Props = WithDefaultProps<OwnProps, typeof defaultProps> & types;
      const newPropsTypeValue = options.useDefaultPropsHelper
        ? ts.factory.createTypeReferenceNode(WITH_DEFAULT_PROPS_HELPER, [
            ts.factory.createTypeReferenceNode(updatedPropTypesName, undefined),
            defaultPropsType,
          ])
        : ts.factory.createIntersectionTypeNode([
            ts.factory.createTypeReferenceNode(updatedPropTypesName, undefined),
            defaultPropsType,
          ]);

      const componentPropsTypeName = doesPropsTypeHaveExport
        ? `Private${propsTypeName}`
        : propsTypeName;

      const newPropsTypeAlias = ts.factory.createTypeAliasDeclaration(
        undefined,
        ts.factory.createIdentifier(componentPropsTypeName),
        undefined,
        ts.isIntersectionTypeNode(propsTypeAliasDeclaration.type)
          ? ts.factory.createIntersectionTypeNode([
              newPropsTypeValue,
              ...propsTypeAliasDeclaration.type.types.filter((el, k) =>
                propTypesAreOnlyReferences
                  ? ts.isIntersectionTypeNode(updatedPropTypeAlias) &&
                    !(updatedPropTypeAlias as ts.IntersectionTypeNode).types.includes(el)
                  : indexOfTypeValue !== k,
              ),
            ])
          : newPropsTypeValue,
      );

      // updateSourceText keeps the order of updates that share an index, so
      // anything the alias reads has to be pushed before the alias itself.
      updates.push(...precedingUpdates);

      updates.push({
        kind: 'insert',
        index: newTypeInsertPos,
        text: `\n\n${printer.printNode(ts.EmitHint.Unspecified, newPropsTypeAlias, sourceFile)}`,
      });

      // we should rename component prop type in that case
      if (doesPropsTypeHaveExport) {
        const updatedComponentTypeReference = ts.factory.updateTypeReferenceNode(
          componentTypeReference,
          ts.factory.createIdentifier(componentPropsTypeName),
          undefined,
        );

        const index = componentTypeReference.getStart(sourceFile);
        const length = componentTypeReference.end - index;
        const text = printer.printNode(
          ts.EmitHint.Unspecified,
          updatedComponentTypeReference,
          sourceFile,
        );
        updates.push({ kind: 'replace', index, length, text: `${text}` });
      }

      processedPropTypes.set(propsTypeName, defaultPropsTypeName);
      return true;
    };

    /* process all default props assignments:
     * - find out, is it object literal expression or identifier obj reference
     * - if it's obj literal - use `CompName.defaultProps`, otherwise - save variable name
     * - create OwnProp type
     * - create/modify type Props = WithDefaultProps
     * - use a new Props type in the component
     */
    sfcsDefaultPropsAssignments.forEach((defaultProp) => {
      if (modernized.has(defaultProp)) return;

      const expression = defaultProp.expression as ts.BinaryExpression;
      const leftPart = expression.left as ts.PropertyAccessExpression;
      const componentName = leftPart.expression.getText();

      const isObjectIdentifier = ts.isIdentifier(expression.right);
      const defaultPropsTypeName = isObjectIdentifier
        ? expression.right.getText()
        : `${componentName}.defaultProps`;

      const variableDeclaration = variableStatements.find(
        (variableStatement) =>
          !!variableStatement.declarationList.declarations.find(
            (declaration) => !!(declaration.name && declaration.name.getText() === componentName),
          ),
      );

      const variableInitializer = variableDeclaration
        ? variableDeclaration.declarationList.declarations[0].initializer
        : undefined;

      const componentDeclaration =
        functionDeclarations.find(
          (functionDeclaration) =>
            !!(functionDeclaration.name && functionDeclaration.name.getText() === componentName),
        ) ||
        (variableInitializer &&
        (ts.isArrowFunction(variableInitializer) || ts.isFunctionDeclaration(variableInitializer))
          ? variableInitializer
          : undefined);

      // hasPropsTypeReference
      if (
        componentDeclaration &&
        componentDeclaration.parameters.length === 1 &&
        componentDeclaration.parameters[0].type !== undefined &&
        ts.isTypeReferenceNode(componentDeclaration.parameters[0].type)
      ) {
        const propsTypeName = componentDeclaration.parameters[0].type.getText();
        const propsTypeAliasDeclarations = typeAliasDeclarations.find(
          (typeAlias) => typeAlias.name.getText() === propsTypeName,
        );

        if (propsTypeAliasDeclarations) {
          const componentStatement =
            variableDeclaration && variableInitializer ? variableDeclaration : undefined;
          const newTypeInsertPos = componentStatement
            ? componentStatement.pos
            : componentDeclaration.pos;

          let defaultPropsType: ts.TypeNode;
          let hoistedName: string | undefined;
          const precedingUpdates: SourceTextUpdate[] = [];

          if (isObjectIdentifier) {
            defaultPropsType = createTypeQuery(defaultPropsTypeName);
          } else if (!componentStatement) {
            defaultPropsType = createDefaultPropsIndexedAccess(componentName);
          } else if (canHoistAbove(expression.right, sourceFile, componentStatement)) {
            if (!takenNames) takenNames = collectIdentifiers(sourceFile);
            hoistedName = uniqueName(`${componentName}DefaultProps`, takenNames);
            const defaultsStart = expression.right.getStart(sourceFile);
            precedingUpdates.push(
              {
                kind: 'insert',
                index: newTypeInsertPos,
                text: `\n\nconst ${hoistedName} = ${expression.right.getText(sourceFile)};`,
              },
              {
                kind: 'replace',
                index: defaultsStart,
                length: expression.right.end - defaultsStart,
                text: hoistedName,
              },
            );
            defaultPropsType = createTypeQuery(hoistedName);
          } else {
            if (reportFileNotice) {
              reportFileNotice({
                reason: `Left ${componentName} without a defaults type: naming its defaults would move them above a binding they read.`,
                hint: 'Declare the defaults in a const above the component to have them typed.',
                recovered: true,
              });
            }
            return;
          }

          const emitted = modifyAndInsertPropsType(
            propsTypeAliasDeclarations,
            defaultPropsTypeName,
            defaultPropsType,
            propsTypeName,
            newTypeInsertPos,
            componentDeclaration.parameters[0].type,
            componentName,
            precedingUpdates,
          );

          if (emitted && hoistedName && takenNames) takenNames.add(hoistedName);
        }
      }
    });

    classDefaultPropsAssignment.forEach((classDeclaration) => {
      const componentName = classDeclaration.name && classDeclaration.name.getText();

      const defaultPropsDeclaration = classDeclaration.members
        .filter(ts.isPropertyDeclaration)
        .filter((declaration) => declaration.name.getText() === 'defaultProps')[0];

      if (!defaultPropsDeclaration) return;

      const isObjectIdentifier =
        defaultPropsDeclaration.initializer && ts.isIdentifier(defaultPropsDeclaration.initializer);
      const defaultPropsTypeName =
        isObjectIdentifier && defaultPropsDeclaration.initializer
          ? defaultPropsDeclaration.initializer.getText()
          : `${componentName}.defaultProps`;
      const variableDeclaration = variableStatements.find(
        (variableStatement) =>
          !!variableStatement.declarationList.declarations.find(
            (declaration) => !!(declaration.name && declaration.name.getText() === componentName),
          ),
      );
      const variableInitializer = variableDeclaration
        ? variableDeclaration.declarationList.declarations[0].initializer
        : undefined;
      const heritageClause = classDeclaration.heritageClauses
        ? classDeclaration.heritageClauses.find((heritageClause) => heritageClause.types.length > 0)
        : undefined;
      const expressionWithTypeArguments =
        heritageClause && heritageClause.types
          ? heritageClause.types.find(
              (x) =>
                ts.isExpressionWithTypeArguments(x) &&
                (x.typeArguments ? x.typeArguments.length > 0 : false),
            )
          : undefined;
      const propsTypeReferenceNode =
        expressionWithTypeArguments && expressionWithTypeArguments.typeArguments
          ? (expressionWithTypeArguments.typeArguments.find((genericArgs) =>
              ts.isTypeReferenceNode(genericArgs),
            ) as ts.TypeReferenceNode | undefined)
          : undefined;

      // wasn't able to find a typename of the props :(
      if (!propsTypeReferenceNode || !componentName) return;

      const propsTypeName = propsTypeReferenceNode.getText();
      const propsTypeAliasDeclarations = typeAliasDeclarations.find(
        (typeAlias) => typeAlias.name.getText() === propsTypeName,
      );

      if (propsTypeAliasDeclarations) {
        const newTypeInsertPos =
          variableDeclaration && variableInitializer
            ? variableDeclaration.pos
            : classDeclaration.pos;
        modifyAndInsertPropsType(
          propsTypeAliasDeclarations,
          defaultPropsTypeName,
          createTypeQuery(defaultPropsTypeName),
          propsTypeName,
          newTypeInsertPos,
          propsTypeReferenceNode,
          componentName,
        );
      }
    });

    return updateSourceText(text, updates);
  },

  validate: createValidate(optionProperties),
};

function createTypeQuery(name: string): ts.TypeQueryNode {
  return ts.factory.createTypeQueryNode(ts.factory.createIdentifier(name));
}

/**
 * `Comp.defaultProps` written on a function component is an expando property
 * with no declaration of its own, so a `typeof Comp.defaultProps` query is
 * checked by the same definite assignment analysis as a value read and reports
 * TS2565 wherever it sits above the assignment. Indexing the type of the
 * binding names the same property without a property access, so it holds at any
 * position. A class states `defaultProps` as a member, which is assigned as the
 * class is declared, so the query form is enough there.
 */
function createDefaultPropsIndexedAccess(componentName: string): ts.IndexedAccessTypeNode {
  return ts.factory.createIndexedAccessTypeNode(
    createTypeQuery(componentName),
    ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral('defaultProps')),
  );
}

/**
 * A component declared as `const Comp = (props: Props) => ...` takes its type
 * from that initializer, so a defaults type that queries `Comp` and a props type
 * that reads the defaults type close a loop: TS2456 on the alias and TS7022 on
 * the component, on every compiler and at every strictness. Naming the defaults
 * in a `const` of their own puts them outside the loop, which is the shape the
 * identifier form already produces. The hoist runs where the alias goes, so it
 * only holds when the defaults read nothing declared below that point.
 */
function canHoistAbove(
  defaults: ts.Expression,
  sourceFile: ts.SourceFile,
  component: ts.Statement,
): boolean {
  const boundary = sourceFile.statements.indexOf(component);
  const notYetInitialized = new Set<string>();
  sourceFile.statements.forEach((statement, index) => {
    if (index >= boundary) collectDeferredBindings(statement, notYetInitialized);
  });

  let safe = true;
  const visit = (node: ts.Node) => {
    if (!safe) return;
    if (ts.isIdentifier(node)) {
      if (isValueReference(node) && notYetInitialized.has(node.text)) safe = false;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(defaults);

  return safe;
}

/**
 * Names a statement binds that hold no value until it runs. A function
 * declaration and an import are live from the start of the module, so they are
 * not collected; a `var` is, since it reads as undefined until its assignment.
 */
function collectDeferredBindings(statement: ts.Statement, names: Set<string>) {
  if (ts.isVariableStatement(statement)) {
    statement.declarationList.declarations.forEach((declaration) =>
      collectBindingNames(declaration.name, names),
    );
    return;
  }

  if (
    (ts.isClassDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isModuleDeclaration(statement) ||
      ts.isImportEqualsDeclaration(statement)) &&
    statement.name &&
    ts.isIdentifier(statement.name)
  ) {
    names.add(statement.name.text);
  }
}

function collectBindingNames(name: ts.BindingName, names: Set<string>) {
  if (ts.isIdentifier(name)) {
    names.add(name.text);
    return;
  }

  name.elements.forEach((element) => {
    if (ts.isBindingElement(element)) collectBindingNames(element.name, names);
  });
}

function collectIdentifiers(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return names;
}

function uniqueName(base: string, taken: Set<string>): string {
  let name = base;
  let counter = 2;
  while (taken.has(name)) {
    name = `${base}${counter}`;
    counter += 1;
  }
  return name;
}

/** Both spellings of the defaults type, so an already migrated file is left alone. */
function readsDefaultPropsType(type: ts.TypeNode, defaultPropsTypeName: string): boolean {
  if (ts.isTypeQueryNode(type)) return type.exprName.getText() === defaultPropsTypeName;
  if (!ts.isIndexedAccessTypeNode(type)) return false;

  const objectType = ts.isParenthesizedTypeNode(type.objectType)
    ? type.objectType.type
    : type.objectType;
  return (
    ts.isTypeQueryNode(objectType) &&
    ts.isLiteralTypeNode(type.indexType) &&
    ts.isStringLiteral(type.indexType.literal) &&
    `${objectType.exprName.getText()}.${type.indexType.literal.text}` === defaultPropsTypeName
  );
}

type DefaultValue = { name: string; text: string };

type ModernizeResult = { updates?: SourceTextUpdate[]; reason?: string };

type PropsTypeMembers = {
  members: ts.TypeElement[];
  /** Set when the members are the whole props type, so an absent prop is absent. */
  exhaustive: boolean;
  declaration?: ts.Declaration;
};

/**
 * Moves `Foo.defaultProps = { size: 'md' }` into the props destructuring as
 * `{ size = 'md' }` and marks the prop optional, then deletes the assignment.
 *
 * React resolves defaultProps for a prop that is undefined once the element's
 * props are built, and a default parameter applies to a property that is
 * undefined when it is destructured, so the two agree on an omitted prop, on an
 * explicitly passed `undefined`, and on `null` (neither substitutes). They
 * differ on the value's identity, on props read through the element rather than
 * the component, and on anything that reads `Foo.defaultProps` itself, so the
 * gates below keep the conversion to the components where the two are the same.
 */
function modernizeDefaultProps(
  assignment: ts.ExpressionStatement,
  sourceFile: ts.SourceFile,
  typeDeclarations: (ts.TypeAliasDeclaration | ts.InterfaceDeclaration)[],
  markedOptional: Set<ts.PropertySignature>,
  editedTypeDeclarations: Set<ts.Declaration>,
): ModernizeResult {
  const expression = assignment.expression as ts.BinaryExpression;
  const target = expression.left as ts.PropertyAccessExpression;
  if (
    expression.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
    !ts.isIdentifier(target.expression)
  ) {
    return { reason: 'the assignment target is not a plain component name' };
  }

  const componentName = target.expression.text;
  const isClassComponent = sourceFile.statements.some(
    (statement) => ts.isClassDeclaration(statement) && statement.name?.text === componentName,
  );
  // React 19 still reads defaultProps off class components.
  if (isClassComponent) return {};

  const component = findComponentFunction(sourceFile, componentName);
  if (!component) return { reason: 'the component is not a function component in this file' };

  const propsParam = component.parameters[0];
  if (!propsParam || !ts.isObjectBindingPattern(propsParam.name)) {
    return { reason: 'the props parameter is not destructured' };
  }

  const defaults = findDefaultsObject(expression.right, sourceFile);
  if (!defaults) return { reason: 'the defaults are not an object literal in this file' };

  if (
    defaults.declaration &&
    findValueReferences(sourceFile, (expression.right as ts.Identifier).text).length !== 1
  ) {
    return { reason: 'the defaults object is used elsewhere in the file' };
  }

  if (findDefaultPropsReads(sourceFile, componentName, target).length > 0) {
    return { reason: 'defaultProps is read elsewhere in the file' };
  }

  const values = readDefaultValues(defaults.objectLiteral, sourceFile);
  if (!values) return { reason: 'a default value is not a literal' };

  const propsType = propsParam.type
    ? collectPropsTypeMembers(propsParam.type, typeDeclarations, true)
    : undefined;
  if (propsType && !propsType.exhaustive) {
    return { reason: 'the props type is not declared in full in this file' };
  }

  const updates: SourceTextUpdate[] = [];
  const toMarkOptional: ts.PropertySignature[] = [];

  for (const value of values) {
    const element = findBindingElement(propsParam.name, value.name);
    if (!element) return { reason: 'a defaulted prop is not destructured by the component' };
    if (!ts.isIdentifier(element.name)) {
      return { reason: 'a defaulted prop is destructured into a nested pattern' };
    }
    if (element.initializer) {
      if (element.initializer.getText(sourceFile) !== value.text) {
        return { reason: 'a defaulted prop already has a different default' };
      }
    } else {
      updates.push({ kind: 'insert', index: element.name.end, text: ` = ${value.text}` });
    }

    if (propsType) {
      const signature = findPropertySignature(propsType.members, value.name);
      if (!signature) {
        return { reason: 'a defaulted prop is not declared in a props type in this file' };
      }
      if (!signature.questionToken) toMarkOptional.push(signature);
    }
  }

  toMarkOptional.forEach((signature) => {
    if (markedOptional.has(signature)) return;
    markedOptional.add(signature);
    updates.push({ kind: 'insert', index: signature.name.end, text: '?' });
    if (propsType?.declaration) editedTypeDeclarations.add(propsType.declaration);
  });

  updates.push({ kind: 'delete', index: assignment.pos, length: assignment.end - assignment.pos });
  if (defaults.declaration) {
    const { pos, end } = defaults.declaration;
    updates.push({ kind: 'delete', index: pos, length: end - pos });
  }

  return { updates };
}

/**
 * The component shapes react-props recognizes: a function declaration, a
 * function expression or arrow function, and either of those behind forwardRef
 * and any number of memo calls.
 */
function findComponentFunction(
  sourceFile: ts.SourceFile,
  componentName: string,
): ts.FunctionDeclaration | ReactSfcFunctionExpression | undefined {
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === componentName) {
      return statement;
    }

    if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations.find(
        (current) => ts.isIdentifier(current.name) && current.name.text === componentName,
      );
      if (declaration?.initializer) {
        return unwrapComponentFunction(declaration.initializer);
      }
    }
  }

  return undefined;
}

function unwrapComponentFunction(
  expression: ts.Expression,
): ReactSfcFunctionExpression | undefined {
  const initializer = unwrapReactMemo(expression);
  if (isSfcFunctionExpression(initializer)) return initializer;

  if (ts.isCallExpression(initializer) && isReactForwardRefName(initializer)) {
    const [argument] = initializer.arguments;
    return argument && isSfcFunctionExpression(argument) ? argument : undefined;
  }

  return undefined;
}

function findDefaultsObject(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): { objectLiteral: ts.ObjectLiteralExpression; declaration?: ts.VariableStatement } | undefined {
  if (ts.isObjectLiteralExpression(expression)) return { objectLiteral: expression };
  if (!ts.isIdentifier(expression)) return undefined;

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    if (statement.declarationList.declarations.length !== 1) continue;

    const [declaration] = statement.declarationList.declarations;
    if (
      ts.isIdentifier(declaration.name) &&
      declaration.name.text === expression.text &&
      declaration.initializer &&
      ts.isObjectLiteralExpression(declaration.initializer)
    ) {
      return { objectLiteral: declaration.initializer, declaration: statement };
    }
  }

  return undefined;
}

/**
 * A default parameter is evaluated on every call, so only values that are the
 * same on every evaluation convert. An object, array or function default would
 * reach the component as a new value per render where defaultProps shared one.
 */
function readDefaultValues(
  objectLiteral: ts.ObjectLiteralExpression,
  sourceFile: ts.SourceFile,
): DefaultValue[] | undefined {
  const values: DefaultValue[] = [];

  for (const property of objectLiteral.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) return undefined;
    if (!isStableDefaultValue(property.initializer)) return undefined;
    values.push({ name: property.name.text, text: property.initializer.getText(sourceFile) });
  }

  return values;
}

function isStableDefaultValue(node: ts.Expression): boolean {
  if (ts.isPrefixUnaryExpression(node)) {
    return (
      (node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken) &&
      (ts.isNumericLiteral(node.operand) || ts.isBigIntLiteral(node.operand))
    );
  }

  return (
    ts.isStringLiteral(node) ||
    ts.isNumericLiteral(node) ||
    ts.isBigIntLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(node) && node.text === 'undefined')
  );
}

function findBindingElement(
  pattern: ts.ObjectBindingPattern,
  propName: string,
): ts.BindingElement | undefined {
  return pattern.elements.find((element) => {
    if (element.dotDotDotToken) return false;
    const name = element.propertyName ?? element.name;
    if (ts.isIdentifier(name)) return name.text === propName;
    if (ts.isStringLiteral(name)) return name.text === propName;
    return false;
  });
}

function collectPropsTypeMembers(
  type: ts.TypeNode,
  typeDeclarations: (ts.TypeAliasDeclaration | ts.InterfaceDeclaration)[],
  resolveReference: boolean,
  declaration?: ts.Declaration,
): PropsTypeMembers {
  if (ts.isTypeLiteralNode(type)) {
    return { members: [...type.members], exhaustive: true, declaration };
  }

  if (ts.isIntersectionTypeNode(type)) {
    const literals = type.types.filter(ts.isTypeLiteralNode);
    return {
      members: literals.flatMap((literal) => [...literal.members]),
      exhaustive: literals.length === type.types.length,
      declaration,
    };
  }

  if (
    resolveReference &&
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeArguments == null
  ) {
    const referenced = typeDeclarations.find(
      (current) =>
        current.name.text === (type.typeName as ts.Identifier).text && !current.typeParameters,
    );
    if (referenced && ts.isTypeAliasDeclaration(referenced)) {
      return collectPropsTypeMembers(referenced.type, typeDeclarations, false, referenced);
    }
    if (referenced && ts.isInterfaceDeclaration(referenced)) {
      return {
        members: [...referenced.members],
        // An interface with a heritage clause declares props it does not list,
        // and one that is merged elsewhere cannot take a `?` here alone.
        exhaustive: referenced.heritageClauses == null,
        declaration: referenced,
      };
    }
  }

  return { members: [], exhaustive: false, declaration };
}

function findPropertySignature(
  members: ts.TypeElement[],
  propName: string,
): ts.PropertySignature | undefined {
  return members.filter(ts.isPropertySignature).find((member) => {
    if (ts.isIdentifier(member.name)) return member.name.text === propName;
    if (ts.isStringLiteral(member.name)) return member.name.text === propName;
    return false;
  });
}

/** Reads of `Foo.defaultProps` other than the assignment being converted. */
function findDefaultPropsReads(
  sourceFile: ts.SourceFile,
  componentName: string,
  assignmentTarget: ts.PropertyAccessExpression,
): ts.Node[] {
  const reads: ts.Node[] = [];

  const visit = (node: ts.Node) => {
    if (node !== assignmentTarget) {
      if (
        ts.isPropertyAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === componentName &&
        node.name.text === 'defaultProps'
      ) {
        reads.push(node);
      }
      if (
        ts.isElementAccessExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === componentName &&
        ts.isStringLiteral(node.argumentExpression) &&
        node.argumentExpression.text === 'defaultProps'
      ) {
        reads.push(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  return reads;
}

/** Identifiers that read the named binding, ignoring members that share its name. */
function findValueReferences(sourceFile: ts.SourceFile, name: string): ts.Identifier[] {
  const references: ts.Identifier[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === name && isValueReference(node)) {
      references.push(node);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  return references;
}

function isValueReference(node: ts.Identifier): boolean {
  const { parent } = node;
  if (!parent) return true;
  if (ts.isPropertyAccessExpression(parent)) return parent.expression === node;
  if (ts.isElementAccessExpression(parent)) return parent.expression === node;
  if (ts.isQualifiedName(parent)) return parent.left === node;
  if (ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) return parent.name !== node;
  if (ts.isBindingElement(parent)) return parent.propertyName !== node && parent.name !== node;
  if (ts.isVariableDeclaration(parent) || ts.isParameter(parent)) return parent.name !== node;
  if (ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent)) return parent.name !== node;
  return true;
}

export default reactDefaultPropsPlugin;
