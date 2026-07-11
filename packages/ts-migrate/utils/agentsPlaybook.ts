import fs from 'fs';
import path from 'path';

// AGENTS.md sits at the package root: one level up from here when running
// from source, two levels up from the compiled build/utils/ output.
const candidates = [
  path.join(__dirname, '..', 'AGENTS.md'),
  path.join(__dirname, '..', '..', 'AGENTS.md'),
];

export default function readAgentsPlaybook(): string {
  const playbookPath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!playbookPath) {
    throw new Error(`Could not find AGENTS.md at ${candidates.join(' or ')}`);
  }
  return fs.readFileSync(playbookPath, 'utf8');
}
