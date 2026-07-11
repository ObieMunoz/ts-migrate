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

interface MigrateResult {
  exitCode: number;
  updatedSourceFiles: Set<string>;
  /**
   * Program files with syntax errors that no plugin can edit (declaration
   * files, files outside the migration set). They will fail any tsc run
   * over this project until fixed, regenerated, or excluded.
   */
  nonMigratedFilesWithSyntaxErrors: string[];
}

export default async function migrate({
  rootDir,
  tsConfigDir = rootDir,
  config,
  sources,
  lintConfig,
  maxStablePasses = 5,
  incrementalPasses = true,
}: MigrateParams): Promise<MigrateResult> {
  let exitCode = 0;
  log.info(`TypeScript version: ${ts.version}`);
  const projectTsVersion = projectTypeScriptVersion(rootDir);
  if (projectTsVersion && projectTsVersion.split('.')[0] !== ts.version.split('.')[0]) {
    log.warn(
      `This project has typescript ${projectTsVersion} installed, but ts-migrate resolved ` +
        `TypeScript ${ts.version}; the suppressions added here may not match what the ` +
        `project's own tsc reports.`,
    );
  }

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

        // A plugin whose edits never change any file's types can run its whole
        // pass against one program: holding its overlay writes until the pass
        // ends keeps the checker warm across files rather than rebuilding it
        // after each changed file. Writes are flushed below before the next
        // plugin (and before the end-of-run diagnostics) observe the program.
        const deferWrites = plugin.mutationsPreserveTypes === true;
        const deferredWrites: { fileName: string; text: string }[] = [];

        // eslint-disable-next-line no-loop-func
        const runPluginOnFile = async (sourceFile: ts.SourceFile) => {
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
              if (deferWrites) {
                deferredWrites.push({ fileName, text: newText });
              } else {
                project.updateSourceFile(fileName, newText);
              }
              updatedSourceFiles.add(sourceFile.fileName);
              changedInPass = true;
              changedThisPass.add(fileName);
            }
          } catch (pluginErr) {
            log.error(`${fileLogPrefix} Error:\n`, pluginErr);
            exitCode = -1;
          }
          // log.info(`${fileLogPrefix} Finished in ${fileTimer.elapsedStr()}.`);
        };

        if (plugin.independentFiles) {
          // Every file's run() is in flight at once, letting the plugin
          // overlap per-file work; each result still lands per file above.
          await Promise.all(sourceFiles.map(runPluginOnFile));
        } else {
          for (const sourceFile of sourceFiles) {
            await runPluginOnFile(sourceFile);
          }
        }

        for (const { fileName, text } of deferredWrites) {
          project.updateSourceFile(fileName, text);
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
        ? computeDirtyFiles(
            project.getSourceFiles(),
            changedThisPass,
            project.getCompilerOptions(),
            project.getModuleResolution(),
          )
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

  // Suppression comments can only fix type errors in the migrated files; a
  // parse error anywhere else in the program (a generated .d.ts, a file
  // outside the migration set) fails every later tsc run no matter what the
  // plugins did. Name those files now so the compile check's failure has a
  // diagnosis attached.
  const nonMigratedFilesWithSyntaxErrors: string[] = [];
  const program = project.getLanguageService().getProgram();
  if (program) {
    program.getSourceFiles().forEach((sourceFile) => {
      if (originalSourceFilesToMigrate.has(sourceFile.fileName)) return;
      if (program.getSyntacticDiagnostics(sourceFile).length > 0) {
        nonMigratedFilesWithSyntaxErrors.push(sourceFile.fileName);
      }
    });
  }
  if (nonMigratedFilesWithSyntaxErrors.length > 0) {
    log.error(
      `${nonMigratedFilesWithSyntaxErrors.length} file(s) this project depends on have syntax ` +
        `errors ts-migrate cannot fix (declaration files or files outside the migration ` +
        `scope). The TypeScript compile check will keep failing until they are fixed, ` +
        `regenerated, or excluded via tsconfig.json — re-running the migration will not ` +
        `change them:`,
    );
    nonMigratedFilesWithSyntaxErrors.forEach((fileName) => {
      log.error(`  ${path.relative(rootDir, fileName)}`);
    });
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

  return { updatedSourceFiles, exitCode, nonMigratedFilesWithSyntaxErrors };
}

// An explicit ancestor walk rather than require.resolve: resolve's global
// fallbacks (NODE_PATH, global installs) can name a typescript the project
// itself would never load.
function projectTypeScriptVersion(rootDir: string): string | undefined {
  for (let dir = path.resolve(rootDir); ; dir = path.dirname(dir)) {
    try {
      const packageJsonPath = path.join(dir, 'node_modules', 'typescript', 'package.json');
      return JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')).version;
    } catch (e) {
      if (path.dirname(dir) === dir) return undefined;
    }
  }
}

function getSourceFilesToMigrate(project: MigrationProject) {
  return project
    .getSourceFiles()
    .filter(({ fileName }) => !/(\.d\.ts|\.json)$|node_modules/.test(fileName));
}

export { MigrateConfig };
