import ts from 'typescript';
import path from 'path';

const normalizeSlashes = (fileName: string): string => fileName.split(path.sep).join('/');

/**
 * Files whose outcome can still change in the next stabilization pass: the
 * files changed last pass, everything that transitively imports them (their
 * diagnostics may differ) and everything they transitively import (call-site
 * evidence for usage-based inference may differ).
 *
 * Returns null when a change's effect cannot be bounded by the import graph
 * (a changed non-module script or global augmentation), meaning every file
 * must be revisited.
 */
export default function computeDirtyFiles(
  sourceFiles: ts.SourceFile[],
  changedFiles: Set<string>,
  compilerOptions: ts.CompilerOptions,
  // The project-wide resolution host and cache: resolutions stay valid across
  // passes (and match the language service's), so nothing is re-resolved here.
  resolution: { host: ts.ModuleResolutionHost; cache: ts.ModuleResolutionCache },
): Set<string> | null {
  const byName = new Map(sourceFiles.map((sourceFile) => [sourceFile.fileName, sourceFile]));
  const unbounded = Array.from(changedFiles).some((fileName) => {
    const sourceFile = byName.get(fileName);
    return sourceFile === undefined || affectsGlobalScope(sourceFile);
  });
  if (unbounded) {
    return null;
  }

  const imports = new Map<string, string[]>();
  const importers = new Map<string, string[]>();
  const addEdge = (edges: Map<string, string[]>, from: string, to: string) => {
    const group = edges.get(from);
    if (group) {
      group.push(to);
    } else {
      edges.set(from, [to]);
    }
  };
  sourceFiles.forEach((sourceFile) => {
    const addDependency = (resolved: string | undefined) => {
      if (resolved !== undefined && resolved !== sourceFile.fileName && byName.has(resolved)) {
        addEdge(imports, sourceFile.fileName, resolved);
        addEdge(importers, resolved, sourceFile.fileName);
      }
    };
    moduleSpecifiers(sourceFile).forEach((specifier) => {
      addDependency(
        ts.resolveModuleName(
          specifier.text,
          sourceFile.fileName,
          compilerOptions,
          resolution.host,
          resolution.cache,
          undefined,
          // The mode the language service resolves this specifier under; under
          // `nodenext` an import and a require of the same name can resolve to
          // different files.
          ts.getModeForUsageLocation(sourceFile, specifier, compilerOptions),
        ).resolvedModule?.resolvedFileName,
      );
    });
    // `/// <reference path="..." />` names a file directly rather than a module.
    sourceFile.referencedFiles.forEach((reference) => {
      addDependency(
        normalizeSlashes(path.resolve(path.dirname(sourceFile.fileName), reference.fileName)),
      );
    });
  });

  const dirty = new Set(changedFiles);
  const expand = (edges: Map<string, string[]>) => {
    const queue = Array.from(changedFiles);
    const seen = new Set(changedFiles);
    while (queue.length > 0) {
      const current = queue.pop() as string;
      (edges.get(current) ?? []).forEach((next) => {
        if (!seen.has(next)) {
          seen.add(next);
          dirty.add(next);
          queue.push(next);
        }
      });
    }
  };
  expand(imports);
  expand(importers);
  return dirty;
}

/**
 * Every module specifier the file names, read from the AST the program already
 * parsed rather than from a text pre-scan: `ts.preProcessFile` drops the
 * specifier of a namespace re-export (`export * as ns from './b'`), which would
 * cost the file its dependency edge.
 *
 * Over-collecting only costs an extra file in the next pass, so shapes that may
 * not be dependencies (an `import()` of a computed name, a `define` argument
 * list) are taken as they come.
 */
function moduleSpecifiers(sourceFile: ts.SourceFile): ts.StringLiteralLike[] {
  const specifiers: ts.StringLiteralLike[] = [];
  const add = (node: ts.Node | undefined) => {
    if (node && ts.isStringLiteralLike(node)) {
      specifiers.push(node);
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      add(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node)) {
      if (ts.isExternalModuleReference(node.moduleReference)) {
        add(node.moduleReference.expression);
      }
    } else if (ts.isImportTypeNode(node)) {
      if (ts.isLiteralTypeNode(node.argument)) {
        add(node.argument.literal);
      }
    } else if (ts.isCallExpression(node) && isModuleLoadingCall(node)) {
      node.arguments.forEach((argument) => {
        if (ts.isArrayLiteralExpression(argument)) {
          // AMD dependency list.
          argument.elements.forEach(add);
        } else {
          add(argument);
        }
      });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return specifiers;
}

function isModuleLoadingCall(node: ts.CallExpression): boolean {
  return (
    node.expression.kind === ts.SyntaxKind.ImportKeyword ||
    (ts.isIdentifier(node.expression) &&
      (node.expression.text === 'require' || node.expression.text === 'define'))
  );
}

function affectsGlobalScope(sourceFile: ts.SourceFile): boolean {
  // Non-module scripts and namespace/global/ambient-module declarations
  // contribute to the global scope, so their changes can affect any file.
  return (
    !ts.isExternalModule(sourceFile) ||
    sourceFile.statements.some((statement) => ts.isModuleDeclaration(statement))
  );
}
