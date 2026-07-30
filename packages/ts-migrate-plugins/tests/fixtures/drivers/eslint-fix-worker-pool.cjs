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
const pluginModule = require('./plugin/' + PLUGIN_ENTRY);
const plugin = pluginModule.default;
const { files, rootDir, options, generatedFiles } = JSON.parse(process.argv[2]);
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
  // Checked after the pass, on the engine the pass resolved, the way a run
  // reports on the declaration files its plugins generated.
  const generatedFileParseErrors = generatedFiles
    ? (
        await pluginModule.findGeneratedFileParseErrors(
          generatedFiles.map(({ fileName, text }) => ({
            filePath: path.resolve(rootDir, fileName),
            text,
          })),
        )
      ).map(({ filePath, message }) => ({
        // The temp tree the paths point into is gone by the time the test reads this.
        fileName: path.relative(rootDir, filePath),
        message,
      }))
    : undefined;
  fs.writeFileSync(
    path.join(__dirname, 'result.json'),
    JSON.stringify({
      results,
      notices,
      generatedFileParseErrors,
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
