// One jest process with a shared worker pool across packages; running
// per-package processes concurrently oversubscribes CI runners.
// testTimeout is a global option; jest rejects it inside a project config, so it
// belongs here rather than in packages/*/jest-config.json. The suites that build
// a real TypeScript program cost under 1s each alone and around 7s when the run
// competes for CPU, so 20000 keeps a hang well inside ci.yml's timeout-minutes.
module.exports = {
  projects: ['<rootDir>/packages/*/jest-config.json'],
  testTimeout: 20000,
};
