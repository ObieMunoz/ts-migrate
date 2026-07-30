import {
  createSuppressionExplainer,
  createTypesPackageDetector,
  eslintFixPlugin,
  retryAnnotationsPlugin,
  retryConversionsPlugin,
  stripTSIgnorePlugin,
  tsIgnorePlugin,
  EslintFixOptions,
  Plugin,
  SuppressionExplainer,
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
  /** Lint with the project's own ESLint when it is usable (default). */
  projectEslint?: boolean;
  /** Declare modules with no types available instead of suppressing their imports (default). */
  declareUntypedModules?: boolean;
  /** Re-infer the any annotations an earlier run wrote. What `retype` adds. */
  annotations?: boolean;
  /** Retry the `as any` assertions add-conversions inserted. */
  casts?: boolean;
  /** Run every pass but write nothing to disk. */
  dryRun?: boolean;
}

interface ReignoreResult extends MigrateResult {
  typesPackageDetector: TypesPackageDetector;
  suppressionExplainer: SuppressionExplainer;
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
  projectEslint,
  declareUntypedModules = true,
  annotations = false,
  casts = false,
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
  const eslintFixChangedPlugin: Plugin<EslintFixOptions> = {
    name: 'eslint-fix-changed',
    independentFiles: eslintFixPlugin.independentFiles,
    async run(params) {
      if (!changedFiles.has(params.fileName)) return undefined;
      if (changedFiles.get(params.fileName) === params.text) return undefined;
      return eslintFixPlugin.run(params);
    },
  };

  const typesPackageDetector = createTypesPackageDetector();
  const suppressionExplainer = createSuppressionExplainer();
  const config = new MigrateConfig()
    .addPlugin(withChangeTracking(stripTSIgnorePlugin), {})
    .addPlugin(typesPackageDetector.plugin, {});
  if (declareUntypedModules) {
    config.addPlugin(typesPackageDetector.declarationsPlugin, {});
  }
  // After the declarations the new types come from, and before the passes that
  // read and suppress what is left, so a removal that reintroduces an error
  // still gets a suppression.
  //
  // Annotations before assertions: a type recovered here is what the assertion
  // beside it is re-checked against, and it repeats because an annotation one
  // pass writes is evidence for the declaration the next one reads.
  if (annotations) {
    config.addPlugin(withChangeTracking(retryAnnotationsPlugin), {}, { repeatUntilStable: true });
  }
  if (casts) {
    config.addPlugin(withChangeTracking(retryConversionsPlugin), {});
  }
  config
    .addPlugin(suppressionExplainer.plugin, {})
    .addPlugin(withChangeTracking(tsIgnorePlugin), { messagePrefix })
    .addPlugin(eslintFixChangedPlugin, { projectEslint });

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
    suppressionExplainer,
    skippedGitignoredFiles: gitignoreFilter ? gitignoreFilter.skippedFiles().length : 0,
    skippedBootstrapFiles: bootstrapFilter ? bootstrapFilter.skippedFiles() : [],
  };
}
