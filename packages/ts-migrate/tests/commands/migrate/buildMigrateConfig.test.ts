import buildMigrateConfig, { availablePlugins } from '../../../commands/migrate';
import type { MigrateConfig } from '@obiemunoz/ts-migrate-server';

function pluginNames(config: MigrateConfig): string[] {
  return config.plugins.map(({ plugin }) => plugin.name);
}

describe('buildMigrateConfig', () => {
  it('builds the default pipeline with eslint-fix before and after ts-ignore', () => {
    const { config, typesPackageDetector } = buildMigrateConfig({});
    const names = pluginNames(config);
    expect(names.filter((name) => name === 'eslint-fix')).toHaveLength(2);
    expect(names).toContain('infer-types');
    expect(names).toContain('ts-ignore');
    expect(typesPackageDetector).toBeDefined();
  });

  it('removes every occurrence of an excluded plugin', () => {
    const defaultNames = pluginNames(buildMigrateConfig({}).config);
    const { config } = buildMigrateConfig({ excludePlugins: ['eslint-fix'] });
    expect(pluginNames(config)).toEqual(defaultNames.filter((name) => name !== 'eslint-fix'));
  });

  it('excludes several plugins at once, keeping the detector for the report', () => {
    const { config } = buildMigrateConfig({
      excludePlugins: ['ts-ignore', 'strip-ts-ignore'],
    });
    const names = pluginNames(config);
    expect(names).not.toContain('ts-ignore');
    expect(names).not.toContain('strip-ts-ignore');
    expect(names).toContain('detect-types-packages');
  });

  it('rejects unknown excluded plugin names, listing the valid ones', () => {
    expect(() => buildMigrateConfig({ excludePlugins: ['eslint'] })).toThrow(
      /Cannot exclude unknown plugin\(s\): eslint\. Available plugins: .*eslint-fix/,
    );
  });

  it('skips inference with inferTypes: false, keeping a single explicit-any pass', () => {
    const { config } = buildMigrateConfig({ inferTypes: false });
    const names = pluginNames(config);
    expect(names).not.toContain('infer-types');
    const explicitAny = config.plugins.filter(({ plugin }) => plugin.name === 'explicit-any');
    expect(explicitAny).toHaveLength(1);
    expect(explicitAny[0].repeatUntilStable).toBeUndefined();
  });

  it('treats excluding infer-types the same as inferTypes: false', () => {
    const excluded = buildMigrateConfig({ excludePlugins: ['infer-types'] }).config;
    const disabled = buildMigrateConfig({ inferTypes: false }).config;
    const shape = (config: MigrateConfig) =>
      config.plugins.map(({ plugin, repeatUntilStable }) => [plugin.name, repeatUntilStable]);
    expect(shape(excluded)).toEqual(shape(disabled));
  });

  it('builds a single-plugin config for --plugin', () => {
    const { config, typesPackageDetector } = buildMigrateConfig({ plugin: 'explicit-any' });
    expect(pluginNames(config)).toEqual(['explicit-any']);
    expect(typesPackageDetector).toBeUndefined();
  });

  it('rejects an unknown --plugin name', () => {
    expect(() => buildMigrateConfig({ plugin: 'does-not-exist' })).toThrow(
      'Could not find a plugin named does-not-exist.',
    );
  });

  it('threads the tsfixme aliases through the pipeline and the result', () => {
    const { config, anyAlias, anyFunctionAlias } = buildMigrateConfig({ aliases: 'tsfixme' });
    expect(anyAlias).toBe('$TSFixMe');
    expect(anyFunctionAlias).toBe('$TSFixMeFunction');
    const explicitAny = config.plugins.find(({ plugin }) => plugin.name === 'explicit-any');
    expect((explicitAny?.options as { anyAlias?: string }).anyAlias).toBe('$TSFixMe');
  });

  it('resolves no aliases by default', () => {
    const { config, anyAlias, anyFunctionAlias } = buildMigrateConfig({});
    expect(anyAlias).toBeUndefined();
    expect(anyFunctionAlias).toBeUndefined();
    const explicitAny = config.plugins.find(({ plugin }) => plugin.name === 'explicit-any');
    expect((explicitAny?.options as { anyAlias?: string }).anyAlias).toBeUndefined();
  });

  it('passes useDefaultPropsHelper through as a boolean, defaulting to false', () => {
    const defaultPropsOptions = (params: Parameters<typeof buildMigrateConfig>[0]) =>
      buildMigrateConfig(params).config.plugins.find(
        ({ plugin }) => plugin.name === 'react-default-props',
      )?.options as { useDefaultPropsHelper?: boolean };
    expect(defaultPropsOptions({ useDefaultPropsHelper: true }).useDefaultPropsHelper).toBe(true);
    expect(defaultPropsOptions({}).useDefaultPropsHelper).toBe(false);
  });

  it('parses --typeMap JSON for the jsdoc plugin and rejects invalid JSON', () => {
    const { config } = buildMigrateConfig({ plugin: 'jsdoc', typeMap: '{"Object":"any"}' });
    expect((config.plugins[0].options as { typeMap?: unknown }).typeMap).toEqual({ Object: 'any' });
    expect(() => buildMigrateConfig({ plugin: 'jsdoc', typeMap: '{oops' })).toThrow(
      /--typeMap must be valid JSON/,
    );
  });

  it('exposes every default-pipeline plugin as excludable', () => {
    const names = new Set(availablePlugins.map((plugin) => plugin.name));
    const defaultNames = pluginNames(buildMigrateConfig({}).config);
    defaultNames
      .filter((name) => name !== 'detect-types-packages')
      .forEach((name) => expect(names).toContain(name));
  });
});
