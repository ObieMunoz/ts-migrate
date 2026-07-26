// Written into a scratch directory and run by eslint-fix.test.ts, which
// substitutes the plugin's path inside the tree under test below.

const fs = require('fs');
const path = require('path');
const workerThreads = require('worker_threads');
const RealWorker = workerThreads.Worker;
const workerData = [];
workerThreads.Worker = class extends RealWorker {
  constructor(source, options) {
    workerData.push(options && options.workerData);
    super(source, options);
  }
};
const plugin = require('./plugin/' + PLUGIN_ENTRY).default;
const { files, rootDir, options } = JSON.parse(process.argv[2]);
const notices = [];
(async () => {
  const results = await Promise.all(
    files.map(({ fileName, text }) =>
      plugin.run({
        fileName: path.resolve(rootDir, fileName),
        rootDir,
        text,
        options,
        reportFileNotice: (notice) => notices.push({ ...notice, file: fileName }),
      }),
    ),
  );
  fs.writeFileSync(
    path.join(__dirname, 'result.json'),
    JSON.stringify({
      results,
      notices,
      // The temp tree is gone by the time the test reads this.
      workerData: workerData.map((data) => ({
        ...data,
        eslintRealPath: fs.realpathSync(data.eslintPath),
      })),
      spawnedWorkers: workerData.length,
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
