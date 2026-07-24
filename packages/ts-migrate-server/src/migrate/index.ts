/* eslint-disable no-await-in-loop, no-restricted-syntax */
import ts from 'typescript';
import fs from 'fs';
import path from 'path';
import log from 'updatable-log';
import MigrateConfig from './MigrateConfig';
import MigrationProject from './MigrationProject';
import computeDirtyFiles from './dirtyFiles';
import PassProgress from '../utils/PassProgress';
import PerfTimer from '../utils/PerfTimer';
import { PluginParams, LintConfig } from '../../types';

interface MigrateParams {
  rootDir: string;
  tsConfigDir?: string;
  config: MigrateConfig;
  sources?: string | string[];
  /**
   * When sources are provided, keep the tsconfig's `.d.ts` files in the
   * program so the ambient types they declare still resolve. Default true.
   */
  ambientSources?: boolean;
  /**
   * Restricts which files take part in the migration. Receives the root file
   * names the program would otherwise start from (absolute paths) and returns
   * the subset to keep; the rest never join the program, so they are neither
   * parsed nor edited. A dropped file that a kept file imports still enters
   * the program through module resolution. Declaration files are exempt from
   * the filter: the ambient types they declare must stay resolvable.
   */
  filterMigrationFiles?: (fileNames: string[]) => string[];
  lintConfig?: LintConfig;
  maxStablePasses?: number;
  incrementalPasses?: boolean;
  /**
   * Run every plugin pass but write nothing to disk. The would-be contents
   * are still returned in updatedFileTexts.
   */
  dryRun?: boolean;
  /**
   * Files added to the program in memory only, as if they were on disk.
   * Lets a dry run model files the real run would create before starting
   * (e.g. the generated alias declarations). Never written.
   */
  virtualFiles?: Array<{ fileName: string; text: string }>;
}

export interface MigrateResult {
  exitCode: number;
  updatedSourceFiles: Set<string>;
  /**
   * The final text of every file in updatedSourceFiles. On a dry run this is
   * the only place the would-be contents exist.
   */
  updatedFileTexts: Map<string, string>;
  /**
   * Program files with syntax errors that no plugin can edit (declaration
   * files, files outside the migration set). They will fail any tsc run
   * over this project until fixed, regenerated, or excluded.
   */
  nonMigratedFilesWithSyntaxErrors: string[];
  /**
   * One entry per configured plugin, in pipeline order, with the number of
   * distinct files that plugin changed across all passes.
   */
  pluginStats: Array<{ pluginName: string; changedFileCount: number }>;
}

export default async function migrate({
  rootDir,
  tsConfigDir = rootDir,
  config,
  sources,
  ambientSources = true,
  filterMigrationFiles,
  lintConfig,
  maxStablePasses = 5,
  incrementalPasses = true,
  dryRun = false,
  virtualFiles,
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
    // Manual sources replace the tsconfig include, which would drop ambient
    // declaration files and turn resolvable globals into bogus suppressions,
    // so the include's .d.ts entries stay in the program unless opted out.
    if (ambientSources) {
      const ambientFiles = project
        .getTsConfigFileNames()
        .filter((fileName) => fileName.endsWith('.d.ts'));
      if (ambientFiles.length > 0) {
        project.addSourceFilesByPaths(ambientFiles);
        log.info(
          `Retaining ${ambientFiles.length} ambient declaration file(s) from tsconfig.json: ` +
            `${ambientFiles.map((fileName) => path.relative(rootDir, fileName)).join(', ')}.`,
        );
      }
    }
    project.addSourceFilesByPaths(sources);
  }

  // Runs before the first program is created, once every on-disk root is
  // registered. Virtual files join afterwards: they model files this run
  // itself creates, which no filter should drop.
  if (filterMigrationFiles) {
    project.retainRootFiles((rootFiles) => {
      const isDeclaration = (fileName: string) => /\.d\.[cm]?ts$/.test(fileName);
      const declarationFiles = rootFiles.filter(isDeclaration);
      const candidates = rootFiles.filter((fileName) => !isDeclaration(fileName));
      return [...declarationFiles, ...filterMigrationFiles(candidates)];
    });
  }

  if (virtualFiles) {
    virtualFiles.forEach(({ fileName, text }) => project.addVirtualSourceFile(fileName, text));
  }

  log.info(`Initialized tsserver project in ${serverInitTimer.elapsedStr()}.`);

  log.info('Start...');
  const pluginsTimer = new PerfTimer();
  const updatedSourceFiles = new Set<string>();
  const changedFilesByPlugin = config.plugins.map(() => new Set<string>());
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

        const progress = new PassProgress({
          prefix: pluginLogPrefix,
          total: sourceFiles.length,
          showCurrentFile: !plugin.independentFiles,
        });

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
          const relFile = path.relative(rootDir, sourceFile.fileName);
          const fileLogPrefix = `${pluginLogPrefix}[${relFile}]`;
          progress.fileStarted(relFile);

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
              changedFilesByPlugin[i].add(fileName);
              changedInPass = true;
              changedThisPass.add(fileName);
            }
          } catch (pluginErr) {
            log.error(`${fileLogPrefix} Error:\n`, pluginErr);
            exitCode = -1;
          }
          progress.fileFinished();
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
        progress.finish();

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

  const updatedFileTexts = new Map<string, string>();
  // eslint-disable-next-line no-restricted-syntax
  for (const fileName of updatedSourceFiles) {
    updatedFileTexts.set(fileName, project.getSourceFileOrThrow(fileName).text);
  }

  if (dryRun) {
    log.info(`Dry run: ${updatedSourceFiles.size} updated file(s) not written.`);
  } else {
    const writeTimer = new PerfTimer();
    log.info(`Writing ${updatedSourceFiles.size} updated file(s)...`);
    const writes = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const [fileName, text] of updatedFileTexts) {
      writes.push(fs.promises.writeFile(fileName, text));
    }
    await Promise.all(writes);
    log.info(`Wrote ${updatedSourceFiles.size} updated file(s) in ${writeTimer.elapsedStr()}.`);
  }

  const pluginStats = config.plugins.map(({ plugin }, i) => ({
    pluginName: plugin.name,
    changedFileCount: changedFilesByPlugin[i].size,
  }));

  return { updatedSourceFiles, updatedFileTexts, exitCode, nonMigratedFilesWithSyntaxErrors, pluginStats };
}

// An explicit ancestor walk rather than require.resolve: resolve's global
// fallbacks (NODE_PATH, global installs) can name a typescript the project
// itself would never load.
function projectTypeScriptVersion(rootDir: string): string | undefined {
  for (let dir = path.resolve(rootDir); ; dir = path.dirname(dir)) {
    try {
      const packageJsonPath = path.join(dir, 'node_modules', 'typescript', 'package.json');
      return JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')).version;
    } catch {
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
