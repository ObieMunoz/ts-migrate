import readPackageRootFile from './packageRootFile';

export default function packageVersion(): string {
  return JSON.parse(readPackageRootFile('package.json')).version;
}
