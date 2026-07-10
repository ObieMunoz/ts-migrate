// One jest process with a shared worker pool across packages; running
// per-package processes concurrently oversubscribes CI runners.
module.exports = {
  projects: ['<rootDir>/packages/*/jest-config.json'],
};
