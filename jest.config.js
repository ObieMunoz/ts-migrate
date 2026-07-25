// One jest process with a shared worker pool across packages; running
// per-package processes concurrently oversubscribes CI runners.
// testTimeout is a global option; jest rejects it inside a project config, so it
// belongs here rather than in packages/*/jest-config.json. The suites that build
// a real TypeScript program cost under 1s each alone and around 7s when the run
// competes for CPU, so 20000 keeps a hang well inside ci.yml's timeout-minutes.
// maxWorkers is left to jest, which derives cores - 1. That is the right size for
// the single run CI and a solo `pnpm test` do, and a cap here cannot bound several
// jest processes started against the same machine.
module.exports = {
  projects: ['<rootDir>/packages/*/jest-config.json'],
  testTimeout: 20000,
};
