import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { ModuleResolution, Plugin } from '@obiemunoz/ts-migrate-server';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';
import { createValidate, Properties } from '../utils/validateOptions';
import { isEsmFilePath } from '../utils/moduleFormat';

/**
 * Updates module specifiers that name a file under an extension the project
 * does not ship it under.
 *
 * A specifier that still ends in `.js`/`.jsx` after the rename step converted
 * its target to `.ts`/`.tsx` is one of the two. TypeScript tolerates the stale
 * extension, substituting the migrated extension when it resolves, but bundlers
 * and test runners resolving the literal path do not. Specifiers whose target
 * still exists on disk are left alone.
 *
 * A specifier that names a TypeScript file outright (`./foo.ts`, the form a
 * bundler-resolved codebase can write before the migration and the one an
 * import of an already migrated file keeps) is the other. It is error TS5097
 * unless the project sets `allowImportingTsExtensions`, and it names a file no
 * build emits, so it is rewritten rather than suppressed. A project that does
 * set that option means the extension and keeps it.
 *
 * Relative specifiers name a path from the importing file, so a rewrite is
 * decided by looking on disk. An absolute specifier the project resolves
 * through tsconfig `paths` (`selectors/AddressSelector.js`) names no such path,
 * so it is decided by resolving it instead: the rewrite happens only when the
 * compiler answers the specifier with the file at stake, its literal target is
 * gone (or, for a TypeScript extension, is the file the specifier names), and
 * the candidate resolves back to that same file.
 *
 * By default the extension is dropped (`./foo.js` and `./foo.ts` -> `./foo`).
 * When the importing file is ESM, where extensionless relative imports are an
 * error, the specifier keeps a `.js` extension instead (`./foo.jsx` and
 * `./foo.tsx` -> `./foo.js`). A file is ESM either by its own `.mts`/`.mjs`
 * extension or by belonging to a `"type": "module"` package, except that
 * `.cts`/`.cjs` are CommonJS whatever the package says. The `extension` option
 * overrides the detection.
 *
 * `.mjs`/`.cjs` specifiers are left alone: `.mts`/`.cts` emit those same
 * extensions, so the specifier still names the file that ships. A `.mts`/`.cts`
 * specifier is rewritten to that emitted extension whatever the `extension`
 * option says, since neither the extensionless form nor `.js` resolves to the
 * file that ships.
 *
 * A rewrite that could name a different file than the specifier already does is
 * declined, since the extension is the only thing telling two files at the same
 * base apart.
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
    const rewrite: Rewrite = {
      extension: options.extension ?? (isEsmFilePath(fileName) ? 'js' : 'omit'),
      typeScript: !moduleResolution?.compilerOptions.allowImportingTsExtensions,
    };

    const updates: SourceTextUpdate[] = [];
    collectModuleSpecifiers(sourceFile).forEach((literal) => {
      // Splice the raw quoted text so the rest of the literal is untouched.
      const start = literal.getStart(sourceFile) + 1;
      const specifier = text.slice(start, literal.getEnd() - 1);
      const newSpecifier = isRelative(specifier)
        ? renamedSpecifier(specifier, importerDir, rewrite)
        : renamedAliasedSpecifier(specifier, rewrite, {
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

interface Rewrite {
  /** What a rewritten specifier ends in, where the extension is not fixed. */
  extension: 'omit' | 'js';
  /** Whether a specifier that names a TypeScript file is rewritten at all. */
  typeScript: boolean;
}

// The rename command converts .jsx to .tsx, and .js to .ts or (with JSX
// contents) .tsx, so a stale .js specifier may point at either.
const renamedExtensions: Record<string, string[]> = {
  '.js': ['.ts', '.tsx'],
  '.jsx': ['.tsx', '.ts'],
};

// The extension .mts and .cts emit, which a specifier that names one of those
// files takes whatever the `extension` option says.
const emittedExtensions: Record<string, string> = { '.mts': '.mjs', '.cts': '.cjs' };

// A file at the same base under one of these is what an extensionless
// specifier could be answered with instead.
const siblingExtensions = ['.js', '.jsx', '.mjs', '.cjs', '.json', '.ts', '.tsx', '.mts', '.cts'];

function isRelative(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

/**
 * The extension a specifier carries that a rewrite may replace, or undefined
 * when it carries none. A specifier that is nothing but an extension (`./.js`)
 * names a dotfile rather than a module, and one that names a declaration file
 * names a file no build emits under any other extension.
 */
function rewritableExtension(specifier: string, rewrite: Rewrite): string | undefined {
  const match = (rewrite.typeScript ? /\.(?:jsx?|tsx?|mts|cts)$/ : /\.jsx?$/).exec(specifier);
  if (!match) return undefined;
  if (/\.d\.[cm]?ts$/.test(specifier)) return undefined;
  const lastSegment = specifier.slice(specifier.lastIndexOf('/') + 1);
  return lastSegment.length > match[0].length ? match[0] : undefined;
}

/** The extension a rewrite writes, which is empty where it drops it. */
function candidateExtension(oldExtension: string, rewrite: Rewrite): string {
  const emitted = emittedExtensions[oldExtension];
  if (emitted !== undefined) return emitted;
  return rewrite.extension === 'js' ? '.js' : '';
}

/** The same specifier written for the file the project ships. */
function candidateSpecifier(specifier: string, oldExtension: string, rewrite: Rewrite): string {
  return specifier.slice(0, -oldExtension.length) + candidateExtension(oldExtension, rewrite);
}

/**
 * Whether the rewrite could name a file other than the one the specifier
 * already names. A candidate that keeps an extension names a single file, so
 * only a file sitting at that path is a risk; one that drops it is answered by
 * the resolver's extension order, so any sibling makes it a guess between two
 * files.
 */
function namesAnotherFile(target: string, oldExtension: string, newExtension: string): boolean {
  const base = target.slice(0, -oldExtension.length);
  if (newExtension !== '') return fs.existsSync(base + newExtension);
  return siblingExtensions.some(
    (sibling) => sibling !== oldExtension && fs.existsSync(base + sibling),
  );
}

function renamedSpecifier(
  specifier: string,
  importerDir: string,
  rewrite: Rewrite,
): string | undefined {
  const oldExtension = rewritableExtension(specifier, rewrite);
  if (oldExtension === undefined) return undefined;

  const target = path.resolve(importerDir, specifier);
  const migratedExtensions = renamedExtensions[oldExtension];
  if (migratedExtensions !== undefined) {
    // A stale JS extension names the file as it was before the rename, so the
    // rewrite stands only where that file is gone and the renamed one is there.
    if (fs.existsSync(target)) return undefined;
    const base = target.slice(0, -oldExtension.length);
    if (!migratedExtensions.some((newExtension) => fs.existsSync(base + newExtension))) {
      return undefined;
    }
  } else {
    // A TypeScript extension names a file that is there; what is not there is
    // a file under the extension the project ships it as.
    if (!fs.existsSync(target)) return undefined;
    if (namesAnotherFile(target, oldExtension, candidateExtension(oldExtension, rewrite))) {
      return undefined;
    }
  }

  return candidateSpecifier(specifier, oldExtension, rewrite);
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
  rewrite: Rewrite,
  { fileName, sourceFile, usage, resolution }: AliasedContext,
): string | undefined {
  if (resolution === undefined) return undefined;
  const oldExtension = rewritableExtension(specifier, rewrite);
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
  const migratedExtensions = renamedExtensions[oldExtension];
  if (migratedExtensions !== undefined) {
    // Only a specifier the compiler answered by substituting the extension
    // names a file the rename step moved; one that resolved as written still
    // ships.
    if (!migratedExtensions.includes(resolved.extension)) return undefined;
    const base = resolved.resolvedFileName.slice(0, -resolved.extension.length);
    // Without allowJs the compiler substitutes past a `.js` file that is still
    // there, which the bundler would still have resolved to.
    if (fs.existsSync(base + oldExtension)) return undefined;
  } else {
    // A TypeScript extension is only this file's to rewrite where the compiler
    // answered the specifier with the very file it names.
    if (resolved.extension !== oldExtension) return undefined;
    const newExtension = candidateExtension(oldExtension, rewrite);
    if (namesAnotherFile(resolved.resolvedFileName, oldExtension, newExtension)) return undefined;
  }

  const candidate = candidateSpecifier(specifier, oldExtension, rewrite);
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
