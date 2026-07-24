import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';
import { createValidate, Properties } from '../utils/validateOptions';

/**
 * Updates relative module specifiers that still end in `.js`/`.jsx` after the
 * rename step converted their target files to `.ts`/`.tsx`. TypeScript
 * tolerates the stale extension, but bundlers and test runners resolving the
 * literal path do not. Specifiers whose target still exists on disk are left
 * alone.
 *
 * By default the extension is dropped (`./foo.js` -> `./foo`). When the
 * importing file belongs to an ESM package (`"type": "module"`), where
 * extensionless relative imports are an error, the specifier keeps a `.js`
 * extension instead (`./foo.jsx` -> `./foo.js`). The `extension` option
 * overrides the detection.
 */
type Options = {
  extension?: 'omit' | 'js';
};

const optionProperties: Properties = {
  extension: { enum: ['omit', 'js'] },
};

const updateImportPathsPlugin: Plugin<Options> = {
  name: 'update-import-paths',

  run({ fileName, sourceFile, text, options }) {
    const importerDir = path.dirname(fileName);
    const extension = options.extension ?? (isEsmPackageDir(importerDir) ? 'js' : 'omit');

    const updates: SourceTextUpdate[] = [];
    collectModuleSpecifiers(sourceFile).forEach((literal) => {
      // Splice the raw quoted text so the rest of the literal is untouched.
      const start = literal.getStart(sourceFile) + 1;
      const specifier = text.slice(start, literal.getEnd() - 1);
      const newSpecifier = renamedSpecifier(specifier, importerDir, extension);
      if (newSpecifier !== undefined && newSpecifier !== specifier) {
        updates.push({ kind: 'replace', index: start, length: specifier.length, text: newSpecifier });
      }
    });

    return updateSourceText(text, updates);
  },

  validate: createValidate(optionProperties),
};

export default updateImportPathsPlugin;

// The rename command converts .jsx to .tsx, and .js to .ts or (with JSX
// contents) .tsx, so a stale .js specifier may point at either.
const renamedExtensions: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx', '.ts'],
};

function renamedSpecifier(
  specifier: string,
  importerDir: string,
  extension: 'omit' | 'js',
): string | undefined {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return undefined;
  const match = /\.jsx?$/.exec(specifier);
  if (!match) return undefined;
  const oldExtension = match[0];
  const lastSegment = specifier.slice(specifier.lastIndexOf('/') + 1);
  if (lastSegment.length <= oldExtension.length) return undefined;

  const target = path.resolve(importerDir, specifier);
  if (fs.existsSync(target)) return undefined;
  const base = target.slice(0, -oldExtension.length);
  if (!renamedExtensions[oldExtension].some((newExtension) => fs.existsSync(base + newExtension))) {
    return undefined;
  }

  const specifierBase = specifier.slice(0, -oldExtension.length);
  return extension === 'js' ? `${specifierBase}.js` : specifierBase;
}

const jestModuleMethods = new Set([
  'mock',
  'unmock',
  'doMock',
  'dontMock',
  'setMock',
  'requireActual',
  'requireMock',
  'createMockFromModule',
  'genMockFromModule',
]);

function isModulePathCallee(expression: ts.LeftHandSideExpression): boolean {
  if (expression.kind === ts.SyntaxKind.ImportKeyword) return true;
  if (ts.isIdentifier(expression)) return expression.text === 'require';
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.name) &&
    ts.isIdentifier(expression.expression)
  ) {
    if (expression.expression.text === 'require') return expression.name.text === 'resolve';
    if (expression.expression.text === 'jest') return jestModuleMethods.has(expression.name.text);
  }
  return false;
}

export function collectModuleSpecifiers(sourceFile: ts.SourceFile): ts.StringLiteralLike[] {
  const literals: ts.StringLiteralLike[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
        literals.push(node.moduleSpecifier);
      }
    } else if (ts.isImportEqualsDeclaration(node)) {
      const reference = node.moduleReference;
      if (ts.isExternalModuleReference(reference) && ts.isStringLiteralLike(reference.expression)) {
        literals.push(reference.expression);
      }
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) {
        literals.push(node.argument.literal);
      }
    } else if (ts.isCallExpression(node)) {
      const [firstArgument] = node.arguments;
      if (
        firstArgument &&
        ts.isStringLiteralLike(firstArgument) &&
        isModulePathCallee(node.expression)
      ) {
        literals.push(firstArgument);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return literals;
}

const esmPackageDirCache = new Map<string, boolean>();

function isEsmPackageDir(dir: string): boolean {
  const cached = esmPackageDirCache.get(dir);
  if (cached !== undefined) return cached;

  let result = false;
  const packageJsonPath = path.join(dir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      result = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')).type === 'module';
    } catch {
      result = false;
    }
  } else {
    const parent = path.dirname(dir);
    result = parent !== dir && isEsmPackageDir(parent);
  }

  esmPackageDirCache.set(dir, result);
  return result;
}
