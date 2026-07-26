const fs = require('fs');
const path = require('path');

// Removes the scratch projects `createDir` in packages/ts-migrate-test-utils
// leaves under packages/*/tests/tmp. Each suite deletes its own project in
// afterEach; a suite killed by a timeout never gets there.
//
// This is a globalTeardown rather than an afterAll because the tmp root is
// shared by every suite in the repository and jest runs those suites in
// parallel workers: the first suite to finish would delete projects the others
// are still using. globalTeardown runs once, after every worker is done.
//
// The glob still covers every package: the helpers moved to one package, and a
// stale root under another is exactly what this should sweep.
//
// Set TS_MIGRATE_KEEP_TEST_TMP=1 to keep the projects, which is what a run that
// died leaves as evidence of what it had written.

const keepEnvVar = 'TS_MIGRATE_KEEP_TEST_TMP';
const packagesDir = path.resolve(__dirname, '..', 'packages');

function scratchRoots() {
  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(packagesDir, entry.name, 'tests', 'tmp'))
    .filter((root) => fs.existsSync(root));
}

module.exports = function globalTeardown() {
  const roots = scratchRoots();

  if (process.env[keepEnvVar]) {
    roots.forEach((root) => {
      const count = fs.readdirSync(root).length;
      if (count > 0) {
        console.log(
          `${keepEnvVar} is set: keeping ${count} scratch project(s) in ${path.relative(
            process.cwd(),
            root,
          )}`,
        );
      }
    });
    return;
  }

  roots.forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
};
