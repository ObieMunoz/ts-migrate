import fs from 'fs';
import path from 'path';

/**
 * Reads a file that ships at the package root. The `..` hops are relative to
 * this file, so this helper has to live in utils/ alongside its callers.
 */
export default function readPackageRootFile(name: string): string {
  // The file sits at the package root: one level up from here when running
  // from source, two levels up from the compiled build/utils/ output.
  const candidates = [path.join(__dirname, '..', name), path.join(__dirname, '..', '..', name)];
  const filePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!filePath) {
    throw new Error(`Could not find ${name} at ${candidates.join(' or ')}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}
