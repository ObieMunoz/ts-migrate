import ts from 'typescript';
import path from 'path';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import getTypeFromPropTypesObjectLiteral from './utils/react-props';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';
import {
  AnyAliasOptions,
  AnyFunctionAliasOptions,
  anyAliasProperty,
  anyFunctionAliasProperty,
  createValidate,
} from '../utils/validateOptions';

type Options = AnyAliasOptions & AnyFunctionAliasOptions;

/**
 * first we are checking if we have imports of `prop-types` or `react-validators`
 * only if we have them - this file might have shapes
 */
const reactShapePlugin: Plugin<Options> = {
  name: 'react-shape',

  run({ fileName, sourceFile, options, text }) {
    const baseName = path.basename(fileName);
    const importDeclarations = sourceFile.statements.filter(ts.isImportDeclaration);
    const hasPropTypesImport = importDeclarations.find((x) =>
      /prop-types|react-validators/.test(x.moduleSpecifier.getText()),
    );
    if (hasPropTypesImport === undefined) return undefined;

    let shouldAddPropTypesImport =
      importDeclarations.find((x) => /prop-types/.test(x.moduleSpecifier.getText())) === undefined;

    // we are adding a PropTypes.Requireable<FooShape> to shape types, need to be sure that we have a PropTypes import
    const insertPropTypesRequireableNode = () => {
      if (shouldAddPropTypesImport) {
        updates.push({
          kind: 'insert',
          index: 0,
          text: `${printer.printNode(
            ts.EmitHint.Unspecified,
            getPropTypesImportNode(),
            sourceFile,
          )}\n`,
        });
        shouldAddPropTypesImport = false;
      }
    };
    const insertShapeType = (
      index: number,
      shapeNode: ts.CallExpression,
      shapeName: string,
      isArrayShapeType = false,
    ) => {
      updates.push({
        kind: 'insert',
        index,
        text: `\n\n${printer.printNode(
          ts.EmitHint.Unspecified,
          getTypeForTheShape(shapeNode, shapeName, sourceFile, options, isArrayShapeType),
          sourceFile,
        )}`,
      });
    };
    // types are not exported in case if we direct export a variable, like export const Var = ...
    // we need to split export to the separate named export and remove modifier from the variable declaration
    const splitVariableExport = (
      node: ts.VariableStatement,
      shapeName: string,
      exportModifier: ts.Modifier,
    ) => {
      // delete the `export ` keyword using its AST position, not a substring search:
      // getFullText() includes leading comments, so a preceding comment containing
      // "export" (e.g. prefer-default-export) would match ahead of the real keyword.
      const start = exportModifier.getStart(sourceFile);
      updates.push({
        kind: 'delete',
        index: start,
        length: exportModifier.end - start + 1,
      });

      const newExport = ts.factory.createExportDeclaration(
        undefined,
        false,
        ts.factory.createNamedExports([
          ts.factory.createExportSpecifier(
            false,
            undefined,
            ts.factory.createIdentifier(shapeName),
          ),
        ]),
      );
      updates.push({
        kind: 'insert',
        index: node.end,
        text: `\n${printer.printNode(ts.EmitHint.Unspecified, newExport, sourceFile)}`,
      });
    };

    const updates: SourceTextUpdate[] = [];
    const printer = ts.createPrinter();
    // in current codebase we have some amout of cases, when shapes have an interface/type
    // with the same name and the same export for both of them
    const typesAndInterfaces = sourceFile.statements.filter(
      (node) => ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node),
    ) as (ts.InterfaceDeclaration | ts.TypeAliasDeclaration)[];
    const declaresType = (name: string) =>
      typesAndInterfaces.some((tNode) => tNode.name.text === name);

    const handleVariableStatement = (node: ts.VariableStatement) => {
      const variableDeclaration = node.declarationList.declarations[0];
      if (!variableDeclaration) return;
      const { initializer } = variableDeclaration;
      if (!initializer || variableDeclaration.type) return;

      const shape = getShapeOfInitializer(initializer);
      if (!shape) return;
      const { shapeNode, isArrayShapeType } = shape;

      insertPropTypesRequireableNode();
      const shapeName = variableDeclaration.name.getText();
      // we are checking here, if there is existing interface/type with the same name in the file.
      // an array shape keeps no annotation naming the type, so this check is all that stands
      // between a rerun and a second declaration of the name
      if (!declaresType(shapeName)) {
        insertShapeType(node.pos, shapeNode, shapeName, isArrayShapeType);
      }

      if (!isArrayShapeType) {
        const updatedVariableDeclaration = ts.factory.updateVariableDeclaration(
          variableDeclaration,
          variableDeclaration.name,
          undefined,
          getShapeTypeNode(shapeName),
          initializer,
        );
        const index = variableDeclaration.pos + 1;
        const length = variableDeclaration.end - index;
        const text = printer.printNode(
          ts.EmitHint.Unspecified,
          updatedVariableDeclaration,
          sourceFile,
        );
        updates.push({ kind: 'replace', index, length, text });
      }

      const exportModifier = node.modifiers?.find(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (exportModifier) {
        splitVariableExport(node, shapeName, exportModifier);
      }
    };

    for (const node of sourceFile.statements) {
      if (ts.isVariableStatement(node)) {
        handleVariableStatement(node);
      }
      // export default PropTypes.shape({...})
      // @TODO: export default PropTypes.arrayOf
      if (
        ts.isExportAssignment(node) &&
        ts.isCallExpression(node.expression) &&
        ts.isObjectLiteralExpression(node.expression.arguments[0]) &&
        isPropTypesShapeCallExpression(node.expression)
      ) {
        insertPropTypesRequireableNode();
        const shapeNode = node.expression;
        const shapeName = baseName.split('.')[0];

        insertShapeType(
          importDeclarations[importDeclarations.length - 1].end,
          shapeNode,
          shapeName,
        );

        updates.push({
          kind: 'replace',
          index: node.pos,
          length: node.end - node.pos,
          text: `${ts.sys.newLine}${printer.printNode(
            ts.EmitHint.Unspecified,
            ts.factory.createVariableStatement(
              [],
              ts.factory.createVariableDeclarationList(
                [
                  ts.factory.createVariableDeclaration(
                    shapeName,
                    undefined,
                    getShapeTypeNode(shapeName),
                    shapeNode,
                  ),
                ],
                ts.NodeFlags.Const,
              ),
            ),
            sourceFile,
          )}`,
        });

        const exportShapeExpression = `${ts.sys.newLine}${printer.printNode(
          ts.EmitHint.Unspecified,
          ts.factory.createExportAssignment(
            undefined,
            undefined,
            ts.factory.createIdentifier(shapeName),
          ),
          sourceFile,
        )}`;
        updates.push({
          kind: 'insert',
          index: node.end,
          text: exportShapeExpression,
        });
      }
    }

    return updateSourceText(text, updates);
  },

  validate: createValidate({
    ...anyAliasProperty,
    ...anyFunctionAliasProperty,
  }),
};

function getTypeForTheShape(
  shapeNode: ts.CallExpression,
  shapeName: string,
  sourceFile: ts.SourceFile,
  options: Options,
  isArrayShapeType = false,
) {
  const shapeTypeVariable = getTypeFromPropTypesObjectLiteral(
    shapeNode.arguments[0] as ts.ObjectLiteralExpression,
    sourceFile,
    {
      anyAlias: options.anyAlias,
      anyFunctionAlias: options.anyFunctionAlias,
      spreadReplacements: [],
    },
  );
  const propsTypeAlias = ts.factory.createTypeAliasDeclaration(
    undefined,
    shapeName,
    undefined,
    isArrayShapeType ? ts.factory.createArrayTypeNode(shapeTypeVariable) : shapeTypeVariable,
  );
  return ts.moveSyntheticComments(propsTypeAlias, shapeTypeVariable);
}

function isPropTypesShapeCallExpression(node: ts.CallExpression) {
  return /PropTypes.shape|Shape|Types.shape/.test(node.expression.getText());
}

function isPropTypesArrayOfShapes(node: ts.CallExpression) {
  return (
    /arrayOf/.test(node.expression.getText()) &&
    ts.isCallExpression(node.arguments[0]) &&
    isPropTypesShapeCallExpression(node.arguments[0] as ts.CallExpression)
  );
}

function getShapeOfInitializer(initializer: ts.Expression) {
  if (!ts.isCallExpression(initializer)) return undefined;

  // const shapeName = PropTypes.shape({...})
  if (
    initializer.arguments.length > 0 &&
    ts.isObjectLiteralExpression(initializer.arguments[0]) &&
    isPropTypesShapeCallExpression(initializer)
  ) {
    return { shapeNode: initializer, isArrayShapeType: false };
  }

  // const shapeName = Types.arrayOf(Shape(...))
  if (isPropTypesArrayOfShapes(initializer)) {
    return { shapeNode: initializer.arguments[0] as ts.CallExpression, isArrayShapeType: true };
  }

  return undefined;
}

function getPropTypesImportNode() {
  return ts.factory.createImportDeclaration(
    undefined,
    ts.factory.createImportClause(false, ts.factory.createIdentifier('PropTypes'), undefined),
    ts.factory.createStringLiteral('prop-types'),
  );
}

// @TODO: PropTypes.Requireable<ShapeType> doesn't works with react-validators Shapes
function getShapeTypeNode(shapeName: string) {
  return ts.factory.createTypeReferenceNode(
    ts.factory.createQualifiedName(
      ts.factory.createIdentifier('PropTypes'),
      ts.factory.createIdentifier('Requireable'),
    ),
    [ts.factory.createTypeReferenceNode(ts.factory.createIdentifier(shapeName), undefined)],
  );
}

export default reactShapePlugin;
