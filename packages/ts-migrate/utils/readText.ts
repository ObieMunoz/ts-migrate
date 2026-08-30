import fs from 'fs';

/**
 * A file's text, or undefined when it cannot be read. Missing and unreadable
 * are the same answer here: a file nothing can read is no evidence either.
 * An empty file still reads as text, so callers must test for undefined
 * rather than for a falsy value.
 */
export function readText(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return undefined;
  }
}
