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
 * Plugins inspect source files with their own `typescript` import, so the
 * server must hand them ASTs produced by that same instance — SyntaxKind
 * numbering differs across TypeScript versions.
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

          // Exercise visitEachChild dispatch, as add-conversions does.
          ts.transform(sourceFile, [
            (context) => {
              const visit = (node: ts.Node): ts.Node => ts.visitEachChild(node, visit, context);
              return (file) => visit(file) as ts.SourceFile;
            },
          ]);

          if (fileName.endsWith('.tsx')) {
            // Exercise JSX detection, as ts-ignore does.
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
