import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { ModuleResolution, Plugin } from '@obiemunoz/ts-migrate-server';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';
import { createValidate, Properties } from '../utils/validateOptions';
import { isEsmFilePath } from '../utils/moduleFormat';

/**
 * Updates module specifiers that still end in `.js`/`.jsx` after the rename
 * step converted their target files to `.ts`/`.tsx`. TypeScript tolerates the
 * stale extension, substituting the migrated extension when it resolves, but
 * bundlers and test runners resolving the literal path do not. Specifiers whose
 * target still exists on disk are left alone.
 *
 * Relative specifiers name a path from the importing file, so a rewrite is
 * decided by looking on disk. An absolute specifier the project resolves
 * through tsconfig `paths` (`selectors/AddressSelector.js`) names no such path,
 * so it is decided by resolving it instead: the rewrite happens only when the
 * compiler answers the specifier with a migrated file, its literal target is
 * gone, and the candidate resolves back to that same file.
 *
 * By default the extension is dropped (`./foo.js` -> `./foo`). When the
 * importing file is ESM, where extensionless relative imports are an error,
 * the specifier keeps a `.js` extension instead (`./foo.jsx` -> `./foo.js`).
 * A file is ESM either by its own `.mts`/`.mjs` extension or by belonging to a
 * `"type": "module"` package, except that `.cts`/`.cjs` are CommonJS whatever
 * the package says. The `extension` option overrides the detection.
 *
 * `.mjs`/`.cjs` specifiers are left alone: `.mts`/`.cts` emit those same
 * extensions, so the specifier still names the file that ships.
 */
type Options = {
  extension?: 'omit' | 'js';
};

const optionProperties: Properties = {
  extension: { enum: ['omit', 'js'] },
};

const updateImportPathsPlugin: Plugin<Options> = {
  name: 'update-import-paths',

  run({ fileName, sourceFile, text, options, moduleResolution }) {
    const importerDir = path.dirname(fileName);
    const extension = options.extension ?? (isEsmFilePath(fileName) ? 'js' : 'omit');

    const updates: SourceTextUpdate[] = [];
    collectModuleSpecifiers(sourceFile).forEach((literal) => {
      // Splice the raw quoted text so the rest of the literal is untouched.
      const start = literal.getStart(sourceFile) + 1;
      const specifier = text.slice(start, literal.getEnd() - 1);
      const newSpecifier = isRelative(specifier)
        ? renamedSpecifier(specifier, importerDir, extension)
        : renamedAliasedSpecifier(specifier, extension, {
            fileName,
            sourceFile,
            usage: literal,
            resolution: moduleResolution,
          });
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

function isRelative(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

/**
 * The stale `.js`/`.jsx` extension a specifier carries, or undefined when it
 * carries none. A specifier that is nothing but an extension (`./.js`) names a
 * dotfile rather than a migrated module.
 */
function staleExtension(specifier: string): string | undefined {
  const match = /\.jsx?$/.exec(specifier);
  if (!match) return undefined;
  const lastSegment = specifier.slice(specifier.lastIndexOf('/') + 1);
  return lastSegment.length > match[0].length ? match[0] : undefined;
}

/** The same specifier written for the migrated file. */
function candidateSpecifier(
  specifier: string,
  oldExtension: string,
  extension: 'omit' | 'js',
): string {
  const base = specifier.slice(0, -oldExtension.length);
  return extension === 'js' ? `${base}.js` : base;
}

function renamedSpecifier(
  specifier: string,
  importerDir: string,
  extension: 'omit' | 'js',
): string | undefined {
  const oldExtension = staleExtension(specifier);
  if (oldExtension === undefined) return undefined;

  const target = path.resolve(importerDir, specifier);
  if (fs.existsSync(target)) return undefined;
  const base = target.slice(0, -oldExtension.length);
  if (!renamedExtensions[oldExtension].some((newExtension) => fs.existsSync(base + newExtension))) {
    return undefined;
  }

  return candidateSpecifier(specifier, oldExtension, extension);
}

interface AliasedContext {
  fileName: string;
  sourceFile: ts.SourceFile;
  usage: ts.StringLiteralLike;
  resolution: ModuleResolution | undefined;
}

/**
 * The rewrite for a specifier that is not a path from the importing file, which
 * is either an absolute import the project maps through `paths` or a package
 * name. Where it points is only knowable by resolving it, so without the
 * project's resolution it is left alone.
 */
function renamedAliasedSpecifier(
  specifier: string,
  extension: 'omit' | 'js',
  { fileName, sourceFile, usage, resolution }: AliasedContext,
): string | undefined {
  if (resolution === undefined) return undefined;
  const oldExtension = staleExtension(specifier);
  if (oldExtension === undefined) return undefined;

  const { compilerOptions, host, cache } = resolution;
  // The mode this specifier resolves under, which under `nodenext` differs
  // between an import and a require of the same name.
  const mode = ts.getModeForUsageLocation(sourceFile, usage, compilerOptions);
  const resolve = (name: string) =>
    ts.resolveModuleName(name, fileName, compilerOptions, host, cache, undefined, mode)
      .resolvedModule;

  const resolved = resolve(specifier);
  if (resolved === undefined) return undefined;
  // A dependency's own files are not this migration's to rewrite.
  if (resolved.isExternalLibraryImport) return undefined;
  // Only a specifier the compiler answered by substituting the extension names
  // a file the rename step moved; one that resolved as written still ships.
  if (!renamedExtensions[oldExtension].includes(resolved.extension)) return undefined;
  const base = resolved.resolvedFileName.slice(0, -resolved.extension.length);
  // Without allowJs the compiler substitutes past a `.js` file that is still
  // there, which the bundler would still have resolved to.
  if (fs.existsSync(base + oldExtension)) return undefined;

  const candidate = candidateSpecifier(specifier, oldExtension, extension);
  // A `paths` pattern can name the extension (`"config.js": [...]`), so the
  // rewrite stands only if it still resolves to the file it started from.
  if (resolve(candidate)?.resolvedFileName !== resolved.resolvedFileName) return undefined;
  return candidate;
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
