import {
  createTypesPackageDetector,
  eslintFixPlugin,
  stripTSIgnorePlugin,
  tsIgnorePlugin,
  Plugin,
  TypesPackageDetector,
} from '@obiemunoz/ts-migrate-plugins';
import { migrate, MigrateConfig, MigrateResult } from '@obiemunoz/ts-migrate-server';

interface ReignoreParams {
  rootDir: string;
  sources?: string | string[];
  ambientSources?: boolean;
  messagePrefix?: string;
}

interface ReignoreResult extends MigrateResult {
  typesPackageDetector: TypesPackageDetector;
}

export default async function reignore({
  rootDir,
  sources,
  ambientSources,
  messagePrefix,
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

  const result = await migrate({ rootDir, config, sources, ambientSources });

  return { ...result, typesPackageDetector };
}
