import ts from 'typescript';

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
    ts.preProcessFile(sourceFile.text, true, true).importedFiles.forEach((imported) => {
      const resolved = ts.resolveModuleName(
        imported.fileName,
        sourceFile.fileName,
        compilerOptions,
        resolution.host,
        resolution.cache,
      ).resolvedModule?.resolvedFileName;
      if (resolved !== undefined && byName.has(resolved)) {
        addEdge(imports, sourceFile.fileName, resolved);
        addEdge(importers, resolved, sourceFile.fileName);
      }
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

function affectsGlobalScope(sourceFile: ts.SourceFile): boolean {
  // Non-module scripts and namespace/global/ambient-module declarations
  // contribute to the global scope, so their changes can affect any file.
  return (
    !ts.isExternalModule(sourceFile) ||
    sourceFile.statements.some((statement) => ts.isModuleDeclaration(statement))
  );
}
