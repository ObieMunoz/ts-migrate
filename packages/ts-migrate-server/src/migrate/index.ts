/* eslint-disable no-await-in-loop, no-restricted-syntax */
import ts from 'typescript';
import fs from 'fs';
import path from 'path';
import log from 'updatable-log';
import MigrateConfig from './MigrateConfig';
import MigrationProject from './MigrationProject';
import computeDirtyFiles from './dirtyFiles';
import PassProgress from '../utils/PassProgress';
import PassNotices from '../utils/PassNotices';
import PerfTimer from '../utils/PerfTimer';
import { PluginParams, LintConfig } from '../../types';

interface MigrateParams {
  rootDir: string;
  tsConfigDir?: string;
  config: MigrateConfig;
  sources?: string | string[];
  /**
   * When sources are provided, keep the tsconfig's declaration files in the
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

/**
 * Which signal explains an empty migration set. Every one of them is a fact the
 * run already had; none of them is a guess from a further scan of the disk.
 */
export type EmptyMigrationSetReason =
  /** The tsconfig's include matched no file at all, which it reports as TS18003. */
  | 'tsconfig-matched-nothing'
  /** `sources` was given and matched no file. */
  | 'sources-matched-nothing'
  /** Everything matched was a declaration file, which holds nothing to migrate. */
  | 'only-declaration-files'
  /** Everything matched was JavaScript, which no plugin may edit. */
  | 'only-javascript-files'
  /** Every migratable file was dropped by `filterMigrationFiles`. */
  | 'all-files-filtered'
  | 'no-migratable-files';

export interface MigrateResult {
  exitCode: number;
  updatedSourceFiles: Set<string>;
  /**
   * The final text of every file in updatedSourceFiles. On a dry run this is
   * the only place the would-be contents exist.
   */
  updatedFileTexts: Map<string, string>;
  /** How many files the plugins were handed, counted before the first one ran. */
  filesToMigrate: number;
  /**
   * Why filesToMigrate was 0, present only when it was. `diagnostics` carries
   * the tsconfig's own errors, formatted with their codes.
   */
  emptyMigrationSet?: { reason: EmptyMigrationSetReason; diagnostics: string[] };
  /**
   * Program files with syntax errors that no plugin can edit (declaration
   * files, files outside the migration set). They will fail any tsc run
   * over this project until fixed, regenerated, or excluded. Unlike
   * migratedFilesWithSyntaxErrors, these do not fail the run.
   */
  nonMigratedFilesWithSyntaxErrors: string[];
  /**
   * One entry per configured plugin, in pipeline order, with the number of
   * distinct files that plugin changed across all passes.
   */
  pluginStats: Array<{ pluginName: string; changedFileCount: number }>;
  /**
   * Files a plugin could not process, grouped by cause. One entry per plugin
   * and cause, merged across the passes of a repeated plugin group.
   */
  pluginFailures: Array<{
    pluginName: string;
    reason: string;
    ruleId?: string;
    fileCount: number;
    files: string[];
  }>;
  /**
   * Declaration files plugins generated during the run, with their contents.
   * Written like the updated files, so on a dry run this is the only place
   * they exist.
   */
  generatedFiles: Map<string, string>;
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
  let ambientFileNames: string[] = [];
  if (sources) {
    // Manual sources replace the tsconfig include, which would drop ambient
    // declaration files and turn resolvable globals into bogus suppressions,
    // so the include's declaration files stay in the program unless opted out.
    if (ambientSources) {
      ambientFileNames = project.getTsConfigFileNames().filter(isDeclarationFile);
      if (ambientFileNames.length > 0) {
        project.addSourceFilesByPaths(ambientFileNames);
        log.info(
          `Retaining ${ambientFileNames.length} ambient declaration file(s) from tsconfig.json: ` +
            `${ambientFileNames.map((fileName) => path.relative(rootDir, fileName)).join(', ')}.`,
        );
      }
    }
    project.addSourceFilesByPaths(sources);
  }

  const rootFileNamesBeforeFilter = project.getRootFileNames();

  // Runs before the first program is created, once every on-disk root is
  // registered. Virtual files join afterwards: they model files this run
  // itself creates, which no filter should drop.
  let filteredOutMigratableFiles = 0;
  if (filterMigrationFiles) {
    project.retainRootFiles((rootFiles) => {
      const declarationFiles = rootFiles.filter(isDeclarationFile);
      const candidates = rootFiles.filter((fileName) => !isDeclarationFile(fileName));
      const kept = new Set(filterMigrationFiles(candidates));
      filteredOutMigratableFiles = candidates.filter(
        (fileName) => !kept.has(fileName) && isMigratableFile(fileName),
      ).length;
      return [...declarationFiles, ...kept];
    });
  }

  if (virtualFiles) {
    virtualFiles.forEach(({ fileName, text }) => project.addVirtualSourceFile(fileName, text));
  }

  log.info(`Initialized tsserver project in ${serverInitTimer.elapsedStr()}.`);

  const originalSourceFilesToMigrate = new Set<string>(
    getSourceFilesToMigrate(project).map((file) => file.fileName),
  );
  const emptyMigrationSet =
    originalSourceFilesToMigrate.size === 0
      ? {
          reason: diagnoseEmptyMigrationSet({
            sources,
            ambientFileNames,
            rootFileNames: rootFileNamesBeforeFilter,
            tsConfigFileNames: project.getTsConfigFileNames(),
            filteredOutMigratableFiles,
          }),
          diagnostics: project
            .getConfigDiagnostics()
            .map(
              (diagnostic) =>
                `TS${diagnostic.code}: ` +
                `${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
            ),
        }
      : undefined;
  log.info(`Migrating ${originalSourceFilesToMigrate.size} file(s) in ${rootDir}.`);

  const pluginsTimer = new PerfTimer();
  const generatedFiles = new Map<string, string>();
  const addGeneratedFile = (fileName: string, text: string) => {
    generatedFiles.set(fileName, text);
    // Adding a file invalidates the program, so regenerating what a previous
    // run already wrote (and the tsconfig already includes) costs no rebuild.
    if (project.hasRootFile(fileName) && project.getFileText(fileName) === text) return;
    project.addVirtualSourceFile(fileName, text);
  };
  const updatedSourceFiles = new Set<string>();
  const changedFilesByPlugin = config.plugins.map(() => new Set<string>());
  const pluginFailures: MigrateResult['pluginFailures'] = [];

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
        // A repeating group re-enters the same pipeline indexes, so only the
        // first pass reports one: an ordinal that moves backwards mid-run
        // reads as a restart.
        const banner =
          pass > 0
            ? `Re-running (pass ${pass + 1} of ${maxStablePasses})`
            : `Plugin ${i + 1} of ${config.plugins.length}`;
        log.info(`${pluginLogPrefix} ${banner}. Start...`);

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
        const notices = new PassNotices(rootDir);

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
            addGeneratedFile,
            reportFileNotice: (notice) => notices.add(fileName, notice),
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
        // After the counter is cleared, so nothing renders over the report.
        notices.report(pluginLogPrefix);
        mergePluginFailures(pluginFailures, plugin.name, notices);

        for (const { fileName, text } of deferredWrites) {
          project.updateSourceFile(fileName, text);
        }

        log.info(
          `${pluginLogPrefix} Finished in ${pluginTimer.elapsedStr()}, ` +
            `${pluginsTimer.elapsedStr()} into the run.`,
        );
      }

      if (!pluginGroup.repeatUntilStable || !changedInPass) {
        break;
      }
      if (pass + 1 >= maxStablePasses) {
        const names = pluginGroup.pluginIndexes
          .map((i) => config.plugins[i].plugin.name)
          .join(', ');
        log.warn(
          `Plugin group [${names}] still changing files after ${maxStablePasses} passes, ` +
            `${changedThisPass.size} in the last one.`,
        );
        break;
      }
      // Comparing this across passes is what tells a group that is settling
      // from one that is thrashing.
      log.info(`Pass ${pass + 1} of ${maxStablePasses} changed ${changedThisPass.size} file(s).`);
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
    // eslint-disable-next-line no-restricted-syntax
    for (const [fileName, text] of generatedFiles) {
      writes.push(
        fs.promises
          .mkdir(path.dirname(fileName), { recursive: true })
          .then(() => fs.promises.writeFile(fileName, text)),
      );
    }
    await Promise.all(writes);
    log.info(`Wrote ${updatedSourceFiles.size} updated file(s) in ${writeTimer.elapsedStr()}.`);
  }

  const pluginStats = config.plugins.map(({ plugin }, i) => ({
    pluginName: plugin.name,
    changedFileCount: changedFilesByPlugin[i].size,
  }));

  return {
    updatedSourceFiles,
    updatedFileTexts,
    exitCode,
    filesToMigrate: originalSourceFilesToMigrate.size,
    emptyMigrationSet,
    nonMigratedFilesWithSyntaxErrors,
    pluginStats,
    pluginFailures,
    generatedFiles,
  };
}

/**
 * Names the signal that left the migration set empty. Ordered by how specific
 * the signal is, so the first one that holds is the one worth reporting.
 */
function diagnoseEmptyMigrationSet({
  sources,
  ambientFileNames,
  rootFileNames,
  tsConfigFileNames,
  filteredOutMigratableFiles,
}: {
  sources: string[] | undefined;
  ambientFileNames: string[];
  rootFileNames: string[];
  tsConfigFileNames: string[];
  filteredOutMigratableFiles: number;
}): EmptyMigrationSetReason {
  if (filteredOutMigratableFiles > 0) return 'all-files-filtered';

  const ambient = new Set(ambientFileNames);
  const selected = sources
    ? rootFileNames.filter((fileName) => !ambient.has(fileName))
    : rootFileNames;
  if (sources && selected.length === 0) return 'sources-matched-nothing';
  if (!sources && tsConfigFileNames.length === 0) return 'tsconfig-matched-nothing';
  if (selected.length > 0 && selected.every(isDeclarationFile)) return 'only-declaration-files';
  if (selected.some((fileName) => /\.[cm]?jsx?$/.test(fileName))) return 'only-javascript-files';
  return 'no-migratable-files';
}

/**
 * Folds one pass's failures into the run's. A repeated plugin group retries the
 * files it changed, so the same cause can arrive from several passes; those
 * merge into one entry with the union of the files.
 */
function mergePluginFailures(
  failures: MigrateResult['pluginFailures'],
  pluginName: string,
  notices: PassNotices,
): void {
  notices
    .groups()
    .filter((group) => !group.recovered)
    .forEach(({ reason, ruleId, files }) => {
      const existing = failures.find(
        (failure) =>
          failure.pluginName === pluginName &&
          failure.reason === reason &&
          failure.ruleId === ruleId,
      );
      const merged = [...new Set([...(existing?.files ?? []), ...files])].sort();
      if (existing) {
        existing.files = merged;
        existing.fileCount = merged.length;
      } else {
        failures.push({ pluginName, reason, ruleId, fileCount: merged.length, files: merged });
      }
    });
}

/** A declaration file in any of its module formats: .d.ts, .d.mts, .d.cts. */
function isDeclarationFile(fileName: string) {
  return /\.d\.[cm]?ts$/.test(fileName);
}

/**
 * Whether plugins may edit a file. Declaration and JSON files hold nothing to
 * migrate, and TypeScript written into a JavaScript file stops that file from
 * parsing as JavaScript, so every JavaScript extension is context only: it
 * still types the files that import it. `rename` is what makes a file
 * migratable.
 */
function isMigratableFile(fileName: string) {
  return !isDeclarationFile(fileName) && !/(\.json|\.[cm]?jsx?)$|node_modules/.test(fileName);
}

/** The program files plugins may edit. */
function getSourceFilesToMigrate(project: MigrationProject) {
  return project.getSourceFiles().filter(({ fileName }) => isMigratableFile(fileName));
}

export { MigrateConfig };
