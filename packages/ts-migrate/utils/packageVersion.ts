import fs from 'fs';
import path from 'path';

// package.json sits at the package root: one level up from here when running
// from source, two levels up from the compiled build/utils/ output.
const candidates = [
  path.join(__dirname, '..', 'package.json'),
  path.join(__dirname, '..', '..', 'package.json'),
];

export default function packageVersion(): string {
  const packageJsonPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!packageJsonPath) {
    throw new Error(`Could not find package.json at ${candidates.join(' or ')}`);
  }
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version;
}
