import {
  createTypesPackageDetector,
  eslintFixPlugin,
  stripTSIgnorePlugin,
  tsIgnorePlugin,
  Plugin,
  TypesPackageDetector,
} from '@obiemunoz/ts-migrate-plugins';
import { migrate, MigrateConfig, MigrateResult } from '@obiemunoz/ts-migrate-server';
import {
  BootstrapFile,
  combineFileFilters,
  createBootstrapMigrationFilter,
} from '../utils/bootstrapFiles';
import { createGitignoreMigrationFilter } from '../utils/gitignore';

interface ReignoreParams {
  rootDir: string;
  sources?: string | string[];
  ambientSources?: boolean;
  messagePrefix?: string;
  /** Skip gitignored files (default). */
  gitignore?: boolean;
  /** Skip build system files (default). */
  bootstrap?: boolean;
  /** Run every pass but write nothing to disk. */
  dryRun?: boolean;
}

interface ReignoreResult extends MigrateResult {
  typesPackageDetector: TypesPackageDetector;
  skippedGitignoredFiles: number;
  skippedBootstrapFiles: BootstrapFile[];
}

export default async function reignore({
  rootDir,
  sources,
  ambientSources,
  messagePrefix,
  gitignore = true,
  bootstrap = true,
  dryRun,
}: ReignoreParams): Promise<ReignoreResult> {
  const changedFiles = new Map<string, string>();
  function withChangeTracking(plugin: Plugin<unknown>): Plugin<unknown> {
    return {
      name: plugin.name,
      mutationsPreserveTypes: plugin.mutationsPreserveTypes,
      independentFiles: plugin.independentFiles,
      async run(params) {
        const prevText = params.text;
        const nextText = await plugin.run(params);
        const seen = changedFiles.has(params.fileName);
        if (!seen && nextText != null && nextText !== prevText) {
          changedFiles.set(params.fileName, prevText);
        }
        return nextText;
      },
    };
  }
  const eslintFixChangedPlugin: Plugin = {
    name: 'eslint-fix-changed',
    independentFiles: eslintFixPlugin.independentFiles,
    async run(params) {
      if (!changedFiles.has(params.fileName)) return undefined;
      if (changedFiles.get(params.fileName) === params.text) return undefined;
      return eslintFixPlugin.run(params);
    },
  };

  const typesPackageDetector = createTypesPackageDetector();
  const config = new MigrateConfig()
    .addPlugin(withChangeTracking(stripTSIgnorePlugin), {})
    .addPlugin(typesPackageDetector.plugin, {})
    .addPlugin(withChangeTracking(tsIgnorePlugin), { messagePrefix })
    .addPlugin(eslintFixChangedPlugin, {});

  const gitignoreFilter = gitignore ? createGitignoreMigrationFilter(rootDir) : undefined;
  const bootstrapFilter = bootstrap ? createBootstrapMigrationFilter(rootDir) : undefined;
  const result = await migrate({
    rootDir,
    config,
    sources,
    ambientSources,
    filterMigrationFiles: combineFileFilters([gitignoreFilter, bootstrapFilter]),
    dryRun,
  });

  return {
    ...result,
    typesPackageDetector,
    skippedGitignoredFiles: gitignoreFilter ? gitignoreFilter.skippedFiles().length : 0,
    skippedBootstrapFiles: bootstrapFilter ? bootstrapFilter.skippedFiles() : [],
  };
}
