import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';
import {
  findKnownImports,
  findKnownVariables,
  collectIdentifierNodes,
  isPropertyNamePosition,
  KnownDefinitionMap,
} from './utils/identifiers';
import { anyTypeNode } from './utils/anyTypes';
import { AnyAliasOptions, validateAnyAliasOptions } from '../utils/validateOptions';

type Options = AnyAliasOptions;

const hoistClassStaticsPlugin: Plugin<Options> = {
  name: 'hoist-class-statics',

  run({ sourceFile, text, options }) {
    return hoistStaticClassProperties(sourceFile, text, options);
  },

  validate: validateAnyAliasOptions,
};

export default hoistClassStaticsPlugin;

const globalWhitelist = [
  'Array',
  'Boolean',
  'Date',
  'Error',
  'Function',
  'Infinity',
  'JSON',
  'Map',
  'Math',
  'NaN',
  'Number',
  'Object',
  'Promise',
  'RegExp',
  'Set',
  'String',
  'Symbol',
  'document',
  'global',
  'globalThis',
  'undefined',
  'window',
];

/**
 * Determines whether or not we can hoist this identifier
 * @param identifier
 * @param hoistToPos -- the position we would hoist this identifier to
 * @param knownDefinitions -- a map describing any known imports or variable declarations
 */
function canHoistIdentifier(
  identifier: ts.Identifier,
  hoistToPos: number,
  knownDefinitions: KnownDefinitionMap,
): boolean {
  const id = identifier.text;
  const isDefined = knownDefinitions[id] && knownDefinitions[id].end <= hoistToPos;
  const isGlobal = globalWhitelist.includes(id);

  return (
    isDefined ||
    isGlobal ||
    // e.g. in 'PropTypes.string.isRequired' allow the accessing identifiers 'string' and 'isRequired'
    // e.g. in { foo: 'bar' } allow the assigned identifier key 'foo'
    isPropertyNamePosition(identifier) ||
    // e.g. in { foo() {} } allow foo
    (ts.isMethodDeclaration(identifier.parent) && identifier.parent.name === identifier)
  );
}

/**
 * Determines whether or not we can hoist this expression
 * @param expression
 * @param hoistToPos -- the position we would hoist this expression to
 * @param knownDefinitions -- a map describing any known imports or variable declarations
 */
function canHoistExpression(
  expression: ts.Expression,
  hoistToPos: number,
  knownDefinitions: KnownDefinitionMap,
): boolean {
  const allIdentifiers = collectIdentifierNodes(expression);
  return allIdentifiers.every((identifier: ts.Identifier) =>
    canHoistIdentifier(identifier, hoistToPos, knownDefinitions),
  );
}

/** `ClassName.prop = value`, the only statement shape this plugin hoists. */
type StaticAssignment = ts.ExpressionStatement & {
  expression: ts.BinaryExpression & { left: ts.PropertyAccessExpression };
};

/**
 * Determines whether or not this statement assigns a static onto this class
 * @param statement -- a top-level statement following the class declaration
 * @param className -- the name of the class to hoist to
 */
function isStaticAssignmentTo(
  statement: ts.Statement,
  className: ts.Identifier,
): statement is StaticAssignment {
  return (
    ts.isExpressionStatement(statement) &&
    ts.isBinaryExpression(statement.expression) &&
    ts.isPropertyAccessExpression(statement.expression.left) &&
    ts.isIdentifier(statement.expression.left.expression) &&
    statement.expression.left.expression.text === className.text &&
    statement.expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
  );
}

/**
 * Determines whether or not this assignment was already hoisted to this class
 * @param statment -- a static binary expresison statement
 * @param classDeclaration -- the class declaration to hoist to
 */
function isAlreadyHoisted(
  statement: ts.ExpressionStatement,
  classDeclaration: ts.ClassDeclaration,
): boolean {
  if (
    !ts.isBinaryExpression(statement.expression) ||
    !ts.isPropertyAccessExpression(statement.expression.left)
  ) {
    return false;
  }

  const propertyToHoist = statement.expression.left.name.text;
  return classDeclaration.members.some(
    (member) => member.name && ts.isIdentifier(member.name) && member.name.text === propertyToHoist,
  );
}

/**
 * Emits a class with no members of its own by reprinting the whole declaration:
 * there is no member to indent against, so the printer supplies the body. The
 * replaced span starts past the trivia the declaration's `pos` covers, leaving
 * whatever sits above the class untouched.
 */
function replaceEmptyClass(
  classDeclaration: ts.ClassDeclaration,
  properties: ts.PropertyDeclaration[],
  sourceFile: ts.SourceFile,
  sourceText: string,
  printer: ts.Printer,
): SourceTextUpdate {
  const updatedClassDeclaration = ts.factory.updateClassDeclaration(
    classDeclaration,
    classDeclaration.modifiers,
    classDeclaration.name,
    classDeclaration.typeParameters,
    classDeclaration.heritageClauses,
    ts.factory.createNodeArray(properties),
  );

  let index = classDeclaration.pos;
  while (index < sourceText.length && /\s/.test(sourceText[index])) index += 1;

  return {
    kind: 'replace',
    index,
    length: classDeclaration.end - index,
    text: printer.printNode(ts.EmitHint.Unspecified, updatedClassDeclaration, sourceFile),
  };
}

/**
 * Emits into a class that already has members, keeping their formatting. The
 * printed properties carry no indentation of their own, so every non-empty line
 * takes the indent of the first member and the block is inserted at that
 * member's `pos`, ahead of its leading trivia.
 */
function insertBeforeFirstMember(
  classDeclaration: ts.ClassDeclaration,
  properties: ts.PropertyDeclaration[],
  sourceFile: ts.SourceFile,
  sourceText: string,
  printer: ts.Printer,
): SourceTextUpdate {
  const firstMember = classDeclaration.members[0];
  const memberStart = firstMember.getStart(sourceFile);
  const lineStart = memberStart - sourceFile.getLineAndCharacterOfPosition(memberStart).character;
  const indent = sourceText.slice(lineStart, memberStart);

  const text =
    ts.sys.newLine +
    properties
      .map((property) => printer.printNode(ts.EmitHint.Unspecified, property, sourceFile))
      .join(ts.sys.newLine + ts.sys.newLine)
      .split(ts.sys.newLine)
      .map((line) => (line.length > 0 ? indent + line : line))
      .join(ts.sys.newLine) +
    ts.sys.newLine;

  return { kind: 'insert', index: firstMember.pos, text };
}

function hoistStaticClassProperties(
  sourceFile: ts.SourceFile,
  sourceText: string,
  options: Options,
): string {
  const printer = ts.createPrinter();
  const updates: SourceTextUpdate[] = [];

  const classDeclarations = sourceFile.statements.filter(ts.isClassDeclaration);
  const knownDefinitions = {
    ...findKnownImports(sourceFile),
    ...findKnownVariables(sourceFile),
  };

  classDeclarations.forEach((classDeclaration) => {
    const className = classDeclaration.name;
    if (!className) return;

    const properties: ts.PropertyDeclaration[] = [];
    const classIndex = sourceFile.statements.indexOf(classDeclaration);
    const declaredNames = new Set<string>();
    // Hoisting an initializer moves its evaluation to class-definition time, so
    // it is only safe while every statement between the class and the
    // assignment has itself been hoisted (deleted). Once any other statement
    // intervenes, only type annotations may be added.
    let directlyFollowsClass = true;

    sourceFile.statements.forEach((statement, statementIndex) => {
      if (statementIndex <= classIndex) return;
      if (!isStaticAssignmentTo(statement, className)) {
        directlyFollowsClass = false;
        return;
      }

      const assignment = statement.expression;
      const propertyName = assignment.left.name.text;
      if (isAlreadyHoisted(statement, classDeclaration) || declaredNames.has(propertyName)) {
        directlyFollowsClass = false;
        return;
      }

      // A statement that cannot be hoisted gets a static type annotation instead.
      const canHoist =
        directlyFollowsClass &&
        canHoistExpression(assignment.right, classDeclaration.pos, knownDefinitions);
      properties.push(
        ts.factory.createPropertyDeclaration(
          [ts.factory.createModifier(ts.SyntaxKind.StaticKeyword)],
          propertyName,
          undefined,
          canHoist ? undefined : anyTypeNode(options.anyAlias),
          canHoist ? assignment.right : undefined,
        ),
      );
      declaredNames.add(propertyName);
      if (canHoist) {
        updates.push({
          kind: 'delete',
          index: statement.pos,
          length: statement.end - statement.pos,
        });
      } else {
        directlyFollowsClass = false;
      }
    });

    if (properties.length > 0) {
      updates.push(
        classDeclaration.members.length === 0
          ? replaceEmptyClass(classDeclaration, properties, sourceFile, sourceText, printer)
          : insertBeforeFirstMember(classDeclaration, properties, sourceFile, sourceText, printer),
      );
    }
  });

  return updateSourceText(sourceText, updates);
}
