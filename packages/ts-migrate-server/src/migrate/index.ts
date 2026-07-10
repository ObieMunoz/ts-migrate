/* eslint-disable no-await-in-loop, no-restricted-syntax */
import ts from 'typescript';
import fs from 'fs';
import path from 'path';
import log from 'updatable-log';
import MigrateConfig from './MigrateConfig';
import MigrationProject from './MigrationProject';
import computeDirtyFiles from './dirtyFiles';
import PerfTimer from '../utils/PerfTimer';
import { PluginParams, LintConfig } from '../../types';

interface MigrateParams {
  rootDir: string;
  tsConfigDir?: string;
  config: MigrateConfig;
  sources?: string | string[];
  lintConfig?: LintConfig;
  maxStablePasses?: number;
  incrementalPasses?: boolean;
}

export default async function migrate({
  rootDir,
  tsConfigDir = rootDir,
  config,
  sources,
  lintConfig,
  maxStablePasses = 5,
  incrementalPasses = true,
}: MigrateParams): Promise<{ exitCode: number; updatedSourceFiles: Set<string> }> {
  let exitCode = 0;
  log.info(`TypeScript version: ${ts.version}`);

  const serverInitTimer = new PerfTimer();

  // Normalize sources to be an array of full paths.
  if (sources !== undefined) {
    sources = Array.isArray(sources) ? sources : [sources];
    sources = sources.map((source) => path.resolve(rootDir, source));
    log.info(`Ignoring sources from tsconfig.json, using the ones provided manually instead.`);
  }

  const tsConfigFilePath = path.join(tsConfigDir, 'tsconfig.json');
  const project = new MigrationProject({
    tsConfigFilePath,
    skipAddingFilesFromTsConfig: sources !== undefined,
  });

  // If we passed in our own sources, let's add them to the project.
  // If not, let's just get all the sources in the project.
  if (sources) {
    project.addSourceFilesByPaths(sources);
  }

  log.info(`Initialized tsserver project in ${serverInitTimer.elapsedStr()}.`);

  log.info('Start...');
  const pluginsTimer = new PerfTimer();
  const updatedSourceFiles = new Set<string>();
  const originalSourceFilesToMigrate = new Set<string>(
    getSourceFilesToMigrate(project).map((file) => file.fileName),
  );

  // Consecutive repeatUntilStable plugins form one group; other plugins are
  // groups of one that run a single pass.
  const pluginGroups: { pluginIndexes: number[]; repeatUntilStable: boolean }[] = [];
  config.plugins.forEach(({ repeatUntilStable }, index) => {
    const lastGroup = pluginGroups[pluginGroups.length - 1];
    if (repeatUntilStable && lastGroup && lastGroup.repeatUntilStable) {
      lastGroup.pluginIndexes.push(index);
    } else {
      pluginGroups.push({ pluginIndexes: [index], repeatUntilStable: !!repeatUntilStable });
    }
  });

  for (const pluginGroup of pluginGroups) {
    // Files whose outcome can still change this pass; null means all files.
    let dirtyFiles: Set<string> | null = null;
    for (let pass = 0; ; pass += 1) {
      let changedInPass = false;
      const changedThisPass = new Set<string>();
      const dirtyFilesThisPass = dirtyFiles;

      for (const i of pluginGroup.pluginIndexes) {
        const { plugin, options: pluginOptions } = config.plugins[i];

        const pluginLogPrefix = `[${plugin.name}]`;
        const pluginTimer = new PerfTimer();
        const passSuffix = pass > 0 ? ` (pass ${pass + 1})` : '';
        log.info(
          `${pluginLogPrefix} Plugin ${i + 1} of ${config.plugins.length}${passSuffix}. Start...`,
        );

        const sourceFiles = getSourceFilesToMigrate(project).filter(
          ({ fileName }) =>
            originalSourceFilesToMigrate.has(fileName) &&
            (dirtyFilesThisPass === null || dirtyFilesThisPass.has(fileName)),
        );

        for (const sourceFile of sourceFiles) {
          const { fileName } = sourceFile;
          // const fileTimer = new PerfTimer();
          const relFile = path.relative(rootDir, sourceFile.fileName);
          const fileLogPrefix = `${pluginLogPrefix}[${relFile}]`;

          const getLanguageService = () => project.getLanguageService();

          const params: PluginParams<unknown> = {
            fileName,
            rootDir,
            sourceFile,
            text: sourceFile.text,
            options: pluginOptions,
            getLanguageService,
          };
          try {
            const newText = await plugin.run(params, lintConfig);
            if (typeof newText === 'string' && newText !== sourceFile.text) {
              project.updateSourceFile(fileName, newText);
              updatedSourceFiles.add(sourceFile.fileName);
              changedInPass = true;
              changedThisPass.add(fileName);
            }
          } catch (pluginErr) {
            log.error(`${fileLogPrefix} Error:\n`, pluginErr);
            exitCode = -1;
          }
          // log.info(`${fileLogPrefix} Finished in ${fileTimer.elapsedStr()}.`);
        }

        log.info(`${pluginLogPrefix} Finished in ${pluginTimer.elapsedStr()}.`);
      }

      if (!pluginGroup.repeatUntilStable || !changedInPass) {
        break;
      }
      if (pass + 1 >= maxStablePasses) {
        const names = pluginGroup.pluginIndexes
          .map((i) => config.plugins[i].plugin.name)
          .join(', ');
        log.warn(`Plugin group [${names}] still changing files after ${maxStablePasses} passes.`);
        break;
      }
      dirtyFiles = incrementalPasses
        ? computeDirtyFiles(project.getSourceFiles(), changedThisPass, project.getCompilerOptions())
        : null;
      if (dirtyFiles !== null) {
        log.info(`Next pass revisits ${dirtyFiles.size} file(s) affected by this pass's changes.`);
      }
    }
  }

  log.info(`Finished in ${pluginsTimer.elapsedStr()}, for ${config.plugins.length} plugin(s).`);

  // Files that still fail to parse cannot be fixed by suppression comments;
  // surface them instead of reporting success.
  const filesWithSyntaxErrors = getSourceFilesToMigrate(project)
    .filter(({ fileName }) => originalSourceFilesToMigrate.has(fileName))
    .filter(
      ({ fileName }) => project.getLanguageService().getSyntacticDiagnostics(fileName).length > 0,
    );
  if (filesWithSyntaxErrors.length > 0) {
    filesWithSyntaxErrors.forEach(({ fileName }) => {
      log.error(`${path.relative(rootDir, fileName)} still has syntax errors after migration.`);
    });
    exitCode = -1;
  }

  const writeTimer = new PerfTimer();

  log.info(`Writing ${updatedSourceFiles.size} updated file(s)...`);
  const writes = [];
  // eslint-disable-next-line no-restricted-syntax
  for (const fileName of updatedSourceFiles) {
    const sourceFile = project.getSourceFileOrThrow(fileName);
    writes.push(fs.promises.writeFile(sourceFile.fileName, sourceFile.text));
  }
  await Promise.all(writes);

  log.info(`Wrote ${updatedSourceFiles.size} updated file(s) in ${writeTimer.elapsedStr()}.`);

  return { updatedSourceFiles, exitCode };
}

function getSourceFilesToMigrate(project: MigrationProject) {
  return project
    .getSourceFiles()
    .filter(({ fileName }) => !/(\.d\.ts|\.json)$|node_modules/.test(fileName));
}

export { MigrateConfig };
