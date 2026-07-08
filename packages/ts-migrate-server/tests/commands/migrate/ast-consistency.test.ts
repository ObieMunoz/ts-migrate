import path from 'path';
import ts from 'typescript';
import { createDir, copyDir, deleteDir } from '../../test-utils';
import migrate, { MigrateConfig } from '../../../src/migrate';

jest.mock('updatable-log', () => {
  // eslint-disable-next-line global-require
  const { mockUpdatableLog } = require('../../test-utils');
  return mockUpdatableLog();
});

/**
 * Regression test: the server used to hand plugins ASTs parsed by ts-morph's
 * bundled TypeScript compiler instead of the host `typescript` package the
 * plugins import. SyntaxKind numbering shifts between compiler versions
 * (e.g. 5.8 -> 5.9), so every kind check in every plugin misfired against
 * those ASTs: ts.transform() threw "Debug Failure.", isVariableStatement
 * matched expression statements, and JSX was never detected, causing
 * @ts-expect-error comments to be inserted as rendered JSX text nodes.
 */
describe('AST / TypeScript instance consistency', () => {
  let rootDir: string;
  beforeEach(() => {
    rootDir = createDir();
  });

  afterEach(() => {
    deleteDir(rootDir);
  });

  it('hands plugins source files produced by the host typescript instance', async () => {
    copyDir(path.resolve(__dirname, 'ast-input'), rootDir);
    copyDir(path.resolve(__dirname, 'config'), rootDir);

    const visitedFiles: string[] = [];
    const config = new MigrateConfig().addPlugin(
      {
        name: 'ast-consistency-plugin',
        run({ sourceFile, fileName, getLanguageService }) {
          if (!ts.isSourceFile(sourceFile) || sourceFile.kind !== ts.SyntaxKind.SourceFile) {
            throw new Error('sourceFile was not produced by the host typescript instance');
          }

          // What add-conversions does; threw "Debug Failure." on mismatched ASTs.
          ts.transform(sourceFile, [
            (context) => {
              const visit = (node: ts.Node): ts.Node => ts.visitEachChild(node, visit, context);
              return (file) => visit(file) as ts.SourceFile;
            },
          ]);

          if (fileName.endsWith('.tsx')) {
            // What ts-ignore's JSX detection does; silently found no JSX on
            // mismatched ASTs.
            let sawJsx = false;
            const walk = (node: ts.Node): void => {
              if (ts.isJsxElement(node)) sawJsx = true;
              ts.forEachChild(node, walk);
            };
            walk(sourceFile);
            if (!sawJsx) {
              throw new Error(`Expected to find a JSX element in ${fileName}`);
            }
          }

          // Diagnostics must come from the same instance without throwing.
          getLanguageService().getSemanticDiagnostics(fileName);

          visitedFiles.push(path.basename(fileName));
          return undefined;
        },
      },
      {},
    );

    const { exitCode } = await migrate({ rootDir, config });

    expect(exitCode).toBe(0);
    expect(visitedFiles.sort()).toEqual(['component.tsx', 'enums.ts']);
  });
});
