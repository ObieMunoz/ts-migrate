import readPackageRootFile from './packageRootFile';

export default function readAgentsPlaybook(): string {
  return readPackageRootFile('AGENTS.md');
}
