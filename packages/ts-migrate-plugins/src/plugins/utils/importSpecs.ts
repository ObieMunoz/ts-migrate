import path from 'path';
import ts from 'typescript';
import { NamedImport } from './imports';

// Extract an npm package name from a file path that passes through node_modules.
// e.g. "/…/node_modules/@reduxjs/toolkit/dist/index.d.ts" → "@reduxjs/toolkit"
//      "/…/node_modules/react/index.d.ts"                 → "react"
//      "/…/node_modules/@types/react/index.d.ts"          → "react"
//      "/…/node_modules/@types/foo__bar/index.d.ts"       → "@foo/bar"
export function packageNameFromNodeModulesPath(filePath: string): string | undefined {
  const idx = filePath.lastIndexOf('/node_modules/');
  if (idx === -1) return undefined;
  // TypeScript's own built-in lib files (lib.es5.d.ts, lib.dom.d.ts, etc.) live
  // at {typescript-pkg}/lib/lib.*.d.ts. The types they declare (Record, Partial,
  // Array, etc.) are globally available and must never be imported.
  if (filePath.includes('/typescript/lib/lib.')) return undefined;
  const rest = filePath.slice(idx + '/node_modules/'.length);
  const parts = rest.split('/');
  let pkg: string | undefined;
  if (parts[0].startsWith('@') && parts.length >= 2) {
    pkg = `${parts[0]}/${parts[1]}`;
  } else {
    pkg = parts[0] || undefined;
  }
  if (!pkg) return undefined;

  // DefinitelyTyped packages (`@types/*`) provide types for a runtime module;
  // the import must reference that runtime module, not the `@types` package.
  // `@types/react` → `react`; `@types/foo__bar` → `@foo/bar` (the `__`
  // separator encodes a scoped package name).
  if (pkg.startsWith('@types/')) {
    const bare = pkg.slice('@types/'.length);
    return bare.includes('__') ? `@${bare.replace('__', '/')}` : bare;
  }
  return pkg;
}

// Returns undefined when the symbol is declared in the same file or has no
// clear single-module home (e.g. intrinsic / anonymous types).
export function resolveSymbolImport(
  sym: ts.Symbol,
  checker: ts.TypeChecker,
  componentFileName: string,
): NamedImport | undefined {
  if (!sym.declarations?.length) return undefined;
  const namedImport = sym.getName();
  if (!namedImport || namedImport.startsWith('__')) return undefined;

  const decl = sym.declarations[0];
  const fqn = checker.getFullyQualifiedName(sym);
  // External modules have FQN of the form `"module-or-path".SymbolName`
  const moduleMatch = /^"(.+)"\.[^.]+$/.exec(fqn);
  if (!moduleMatch) {
    // Some npm packages (e.g. @reduxjs/toolkit) declare types as interfaces in
    // plain .d.ts files rather than inside `declare module "…"` blocks. In that
    // case TypeScript returns a bare FQN with no module prefix. Fall back to
    // extracting the package name from the declaration file path.
    const declSourceFile = decl.getSourceFile();
    const pkgName = packageNameFromNodeModulesPath(declSourceFile.fileName);
    if (!pkgName) return undefined; // same-file or lib — no import needed

    // Only emit an import if the symbol is actually exported from the package.
    // Internal types (e.g. immer's WritableNonArrayDraft) also have bare FQNs
    // but are NOT exported — importing them would produce a TS error.
    // We use getExportsOfModule so that both `export type Foo` and
    // `export { type Foo }` patterns are covered.
    const moduleSymbol = checker.getSymbolAtLocation(declSourceFile);
    if (moduleSymbol) {
      const exports = checker.getExportsOfModule(moduleSymbol);
      if (!exports.some((exp) => exp.getName() === namedImport)) {
        return undefined;
      }
    }

    return { namedImport, moduleSpecifier: pkgName };
  }

  const moduleStr = moduleMatch[1];

  // Bare package name (no leading . or /): use as-is.
  if (!moduleStr.startsWith('.') && !moduleStr.startsWith('/')) {
    return { namedImport, moduleSpecifier: moduleStr };
  }

  // Local file: compute a relative specifier from the component file.
  const rel = path
    .relative(path.dirname(componentFileName), moduleStr)
    .replace(/\.d\.ts$/, '')
    .replace(/\.(tsx?|jsx?)$/, '');
  const moduleSpecifier = rel.startsWith('.') ? rel : `./${rel}`;
  return { namedImport, moduleSpecifier };
}

// Recursively collect all importable symbols from a ts.Type, including its
// type arguments, union/intersection members, etc.
export function collectImportSpecs(
  type: ts.Type,
  checker: ts.TypeChecker,
  componentFileName: string,
  seen: Set<ts.Symbol>,
  out: NamedImport[],
): void {
  // Always prefer the alias symbol: if the type is `ButtonSize = 'sm' | 'md'`,
  // we want `ButtonSize` — not a recursion into the string literal members.
  if (type.aliasSymbol) {
    if (!seen.has(type.aliasSymbol)) {
      seen.add(type.aliasSymbol);
      const imp = resolveSymbolImport(type.aliasSymbol, checker, componentFileName);
      if (imp) out.push(imp);
    }
    // Recurse into alias type arguments (e.g. Map<K, V> → also import K and V).
    if (type.aliasTypeArguments) {
      for (const arg of type.aliasTypeArguments) {
        collectImportSpecs(arg, checker, componentFileName, seen, out);
      }
    }
    return;
  }

  // Recurse into union / intersection members.
  if (type.isUnion() || type.isIntersection()) {
    for (const part of type.types) {
      collectImportSpecs(part, checker, componentFileName, seen, out);
    }
    return;
  }

  // Plain reference type: collect the symbol.
  const sym = type.symbol;
  if (sym && !seen.has(sym)) {
    seen.add(sym);
    const imp = resolveSymbolImport(sym, checker, componentFileName);
    if (imp) out.push(imp);
  }

  // Recurse into type arguments (generic instantiations).
  const typeArgs = (type as ts.TypeReference).typeArguments;
  if (typeArgs) {
    for (const arg of typeArgs) {
      collectImportSpecs(arg, checker, componentFileName, seen, out);
    }
  }
}
