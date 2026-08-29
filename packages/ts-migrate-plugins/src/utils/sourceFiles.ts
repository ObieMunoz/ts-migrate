import ts from 'typescript';

/** A file a pass may edit: not a declaration file, not somebody else's package. */
export function isMigratableFile(file: ts.SourceFile): boolean {
  return !file.isDeclarationFile && !file.fileName.includes('/node_modules/');
}
