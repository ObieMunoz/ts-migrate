import {
  createSuppressionExplainer,
  createTypesPackageDetector,
  addMissingImportsPlugin,
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
import { BootstrapFile, createMigrationFileFilters } from '../utils/bootstrapFiles';

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
  /** Import the names an earlier run suppressed as TS2304 instead (default). */
  addMissingImports?: boolean;
  /** What to do with a name several modules export. Defaults to taking the first. */
  ambiguousImports?: 'first' | 'skip';
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
  addMissingImports = true,
  ambiguousImports,
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
  // With the suppressions off, the names an earlier run hid behind them are
  // reported again, and the ones a module in the program exports are imported
  // rather than re-suppressed. Before the retry passes below, which read the
  // types those imports restore.
  if (addMissingImports) {
    config.addPlugin(withChangeTracking(addMissingImportsPlugin), { ambiguous: ambiguousImports });
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

  const fileFilters = createMigrationFileFilters(rootDir, { gitignore, bootstrap });
  const result = await migrate({
    rootDir,
    config,
    sources,
    ambientSources,
    filterMigrationFiles: fileFilters.filterMigrationFiles,
    dryRun,
  });

  return {
    ...result,
    typesPackageDetector,
    suppressionExplainer,
    skippedGitignoredFiles: fileFilters.skippedGitignoredFiles(),
    skippedBootstrapFiles: fileFilters.skippedBootstrapFiles(),
  };
}
