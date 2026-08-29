import path from 'path';

/** A path with forward slashes, whatever separator the platform uses. */
export function toPosix(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

/** A file's rootDir-relative form with forward slashes. */
export function relativeTo(rootDir: string, file: string): string {
  return toPosix(path.relative(rootDir, file));
}
