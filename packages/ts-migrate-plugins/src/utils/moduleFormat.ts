import fs from 'fs';
import path from 'path';
import ts from 'typescript';

// Extensions that fix a file's format whatever the enclosing package says.
const ESM_EXTENSION_REGEX = /\.m[jt]s$/;
const CJS_EXTENSION_REGEX = /\.c[jt]s$/;

/**
 * Whether a file is ECMAScript modules by its path alone: by its own
 * `.mts`/`.mjs` extension, or by belonging to a `"type": "module"` package.
 * `.cts`/`.cjs` are CommonJS whatever the package says, since they emit `.cjs`.
 */
export function isEsmFilePath(fileName: string): boolean {
  if (CJS_EXTENSION_REGEX.test(fileName)) return false;
  if (ESM_EXTENSION_REGEX.test(fileName)) return true;
  return isEsmPackageDir(path.dirname(fileName));
}

/**
 * Whether a file is ECMAScript modules: by its path, or by module syntax it
 * already contains. `.cts`/`.cjs` are CommonJS whatever else is true.
 */
export function isEsmSourceFile(fileName: string, sourceFile: ts.SourceFile): boolean {
  if (CJS_EXTENSION_REGEX.test(fileName)) return false;
  if (hasEsmSyntax(sourceFile)) return true;
  return isEsmFilePath(fileName);
}

/**
 * Whether the file already carries ECMAScript module syntax. `import x =
 * require('m')` and `export = x` do not count: those are the CommonJS interop
 * forms and stay legal in a CommonJS file.
 */
export function hasEsmSyntax(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some(
    (statement) =>
      ts.isImportDeclaration(statement) ||
      ts.isExportDeclaration(statement) ||
      (ts.isExportAssignment(statement) && !statement.isExportEquals) ||
      hasExportModifier(statement),
  );
}

/** Whether the file already exports a default binding. */
export function hasDefaultExport(sourceFile: ts.SourceFile): boolean {
  return sourceFile.statements.some((statement) => {
    if (ts.isExportAssignment(statement)) return !statement.isExportEquals;
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      return statement.exportClause.elements.some((element) => element.name.text === 'default');
    }
    return (
      hasExportModifier(statement) &&
      ts.canHaveModifiers(statement) &&
      Boolean(
        ts
          .getModifiers(statement)
          ?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword),
      )
    );
  });
}

function hasExportModifier(statement: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(statement) &&
    Boolean(
      ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
    )
  );
}

const esmPackageDirCache = new Map<string, boolean>();

/** Whether the nearest enclosing package.json declares `"type": "module"`. */
export function isEsmPackageDir(dir: string): boolean {
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
