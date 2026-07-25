// One jest process with a shared worker pool across packages; running
// per-package processes concurrently oversubscribes CI runners.
// testTimeout is global-only, so it belongs here and not in the project configs.
// The suites that build a real TypeScript program cost under 1s each alone and
// up to 10s when several runs share the cores, which is what 30000 is sized for.
// maxWorkers stays at jest's cores - 1: a cap here is wrong for the single run
// CI does and cannot bound several jest processes on one machine anyway.
module.exports = {
  projects: ['<rootDir>/packages/*/jest-config.json'],
  testTimeout: 30000,
};
