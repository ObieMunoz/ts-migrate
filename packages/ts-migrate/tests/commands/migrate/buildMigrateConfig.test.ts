import log from 'updatable-log';
import buildMigrateConfig, { availablePlugins } from '../../../commands/migrate';
import type { MigrateConfig } from '@obiemunoz/ts-migrate-server';

function pluginNames(config: MigrateConfig): string[] {
  return config.plugins.map(({ plugin }) => plugin.name);
}

function pluginOptions(config: MigrateConfig, name: string): unknown {
  return config.plugins.find(({ plugin }) => plugin.name === name)?.options;
}

describe('buildMigrateConfig', () => {
  it('builds the default pipeline with eslint-fix before ts-ignore', () => {
    const { config, typesPackageDetector } = buildMigrateConfig({});
    const names = pluginNames(config);
    expect(names.filter((name) => name === 'eslint-fix')).toHaveLength(1);
    expect(names.indexOf('eslint-fix')).toBeLessThan(names.indexOf('ts-ignore'));
    expect(names).toContain('infer-types');
    expect(typesPackageDetector).toBeDefined();
  });

  // A suppression comment only reaches the line directly below it, so a pass
  // that reformats after ts-ignore can move the comment off its error, leaving
  // the error reported and the comment unused.
  it('ends at ts-ignore, so nothing reformats the suppressions it wrote', () => {
    const names = pluginNames(buildMigrateConfig({}).config);
    expect(names[names.length - 1]).toBe('ts-ignore');
  });

  it('types empty object literals after inference and before add-conversions', () => {
    const names = pluginNames(buildMigrateConfig({}).config);
    expect(names.indexOf('declare-empty-object-properties')).toBeGreaterThan(
      names.lastIndexOf('infer-types'),
    );
    expect(names.indexOf('declare-empty-object-properties')).toBe(
      names.indexOf('add-conversions') - 1,
    );
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

  it('runs react-hook-types after react-props and before the inference stage', () => {
    const names = pluginNames(buildMigrateConfig({}).config);
    expect(names.indexOf('react-hook-types')).toBeGreaterThan(names.indexOf('react-props'));
    expect(names.indexOf('react-hook-types')).toBeLessThan(names.indexOf('infer-types'));
    expect(names.indexOf('react-hook-types')).toBeLessThan(names.indexOf('ts-ignore'));
    expect(pluginOptions(buildMigrateConfig({ aliases: 'tsfixme' }).config, 'react-hook-types'))
      .toEqual({ anyAlias: '$TSFixMe' });
  });

  it('runs the suppression explainer immediately before ts-ignore', () => {
    const { config, suppressionExplainer } = buildMigrateConfig({});
    const names = pluginNames(config);
    expect(suppressionExplainer).toBeDefined();
    expect(names.indexOf('explain-suppressions')).toBe(names.indexOf('ts-ignore') - 1);
  });

  it('drops the suppression explainer when ts-ignore is excluded', () => {
    const { config, suppressionExplainer } = buildMigrateConfig({
      excludePlugins: ['ts-ignore'],
    });
    expect(suppressionExplainer).toBeUndefined();
    expect(pluginNames(config)).not.toContain('explain-suppressions');
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

  it('names the real problem when --plugin is repeated', () => {
    expect(() => buildMigrateConfig({ plugin: ['explicit-any', 'ts-ignore'] })).toThrow(
      '--plugin takes a single plugin name, but was given explicit-any, ts-ignore. ' +
        'To run the default pipeline without some of its plugins, use --excludePlugin instead.',
    );
  });

  it('gives a single --plugin run the options the pipeline gives that plugin', () => {
    const accessibility = {
      defaultAccessibility: 'private' as const,
      privateRegex: '^_',
      protectedRegex: '^p_',
      publicRegex: '^pub_',
    };
    const single = buildMigrateConfig({ plugin: 'member-accessibility', ...accessibility }).config;
    expect(single.plugins[0].options).toEqual(accessibility);
    expect(single.plugins[0].options).toEqual(
      pluginOptions(buildMigrateConfig(accessibility).config, 'member-accessibility'),
    );
  });

  it('gives a single --plugin react-default-props run the useDefaultPropsHelper choice', () => {
    const single = buildMigrateConfig({
      plugin: 'react-default-props',
      useDefaultPropsHelper: true,
    }).config;
    expect(single.plugins[0].options).toEqual({
      useDefaultPropsHelper: true,
      modernizeDefaultProps: true,
    });
    expect(single.plugins[0].options).toEqual(
      pluginOptions(
        buildMigrateConfig({ useDefaultPropsHelper: true }).config,
        'react-default-props',
      ),
    );
  });

  it('gives every single-plugin run the same options as the default pipeline', () => {
    const params = {
      aliases: 'tsfixme',
      useDefaultPropsHelper: true,
      defaultAccessibility: 'private' as const,
      privateRegex: '^_',
      projectEslint: false,
    };
    const pipeline = buildMigrateConfig(params).config;
    // Most plugins take none of these flags, so the run is expected to warn.
    const warn = jest.spyOn(log, 'warn').mockImplementation(() => {});
    try {
      pluginNames(pipeline).forEach((name) => {
        if (!availablePlugins.some((plugin) => plugin.name === name)) return;
        const { config } = buildMigrateConfig({ ...params, plugin: name });
        expect([name, config.plugins[0].options]).toEqual([name, pluginOptions(pipeline, name)]);
      });
    } finally {
      warn.mockRestore();
    }
  });

  it('gives the jsdoc plugin its own flags', () => {
    const { config } = buildMigrateConfig({
      plugin: 'jsdoc',
      typeMap: '{"Object":"any"}',
      annotateReturns: true,
    });
    expect(config.plugins[0].options).toEqual({
      anyAlias: undefined,
      typeMap: { Object: 'any' },
      annotateReturns: true,
    });
  });

  it('has options for every plugin --plugin accepts', () => {
    availablePlugins.forEach(({ name }) => {
      const { config } = buildMigrateConfig({ plugin: name });
      expect([name, typeof config.plugins[0].options]).toEqual([name, 'object']);
    });
  });

  it('warns once about the flags the selected plugin has no option for', () => {
    const warn = jest.spyOn(log, 'warn').mockImplementation(() => {});
    try {
      buildMigrateConfig({ plugin: 'ts-ignore', defaultAccessibility: 'private', aliases: 'tsfixme' });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        'Ignoring --aliases, --defaultAccessibility: not an option of the ts-ignore plugin.',
      );

      warn.mockClear();
      buildMigrateConfig({ plugin: 'member-accessibility', defaultAccessibility: 'private' });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
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

  it('converts function component defaultProps unless --modernizeDefaultProps=false', () => {
    const defaultPropsOptions = (params: Parameters<typeof buildMigrateConfig>[0]) =>
      buildMigrateConfig(params).config.plugins.find(
        ({ plugin }) => plugin.name === 'react-default-props',
      )?.options as { modernizeDefaultProps?: boolean };
    expect(defaultPropsOptions({}).modernizeDefaultProps).toBe(true);
    expect(defaultPropsOptions({ modernizeDefaultProps: false }).modernizeDefaultProps).toBe(false);
  });

  it('gives the eslint-fix pass the projectEslint choice', () => {
    const eslintFixOptions = (params: Parameters<typeof buildMigrateConfig>[0]) =>
      buildMigrateConfig(params)
        .config.plugins.filter(({ plugin }) => plugin.name === 'eslint-fix')
        .map(({ options }) => options as { projectEslint?: boolean });
    expect(eslintFixOptions({ projectEslint: false })).toEqual([{ projectEslint: false }]);
    expect(eslintFixOptions({})).toEqual([{ projectEslint: undefined }]);
  });

  it('passes projectEslint to a single --plugin eslint-fix run', () => {
    const { config } = buildMigrateConfig({ plugin: 'eslint-fix', projectEslint: false });
    expect(config.plugins[0].options).toEqual({ projectEslint: false });
  });

  it('parses --typeMap JSON for the jsdoc plugin and rejects invalid JSON', () => {
    const { config } = buildMigrateConfig({ plugin: 'jsdoc', typeMap: '{"Object":"any"}' });
    expect((config.plugins[0].options as { typeMap?: unknown }).typeMap).toEqual({ Object: 'any' });
    expect(() => buildMigrateConfig({ plugin: 'jsdoc', typeMap: '{oops' })).toThrow(
      /--typeMap must be valid JSON/,
    );
  });

  it('passes --annotateReturns to a single --plugin jsdoc run', () => {
    const annotateReturns = (params: Parameters<typeof buildMigrateConfig>[0]) =>
      (buildMigrateConfig(params).config.plugins[0].options as { annotateReturns?: unknown })
        .annotateReturns;

    expect(annotateReturns({ plugin: 'jsdoc', annotateReturns: true })).toBe(true);
    expect(annotateReturns({ plugin: 'jsdoc', annotateReturns: false })).toBe(false);
    expect(annotateReturns({ plugin: 'jsdoc' })).toBeUndefined();
  });

  it('exposes every default-pipeline plugin as excludable', () => {
    // The detector's two plugins, the global declaration pair and the
    // suppression explainer hold per-run state, so they are built per command
    // rather than listed among the static plugins.
    const perRunPlugins = [
      'detect-types-packages',
      'declare-untyped-modules',
      'collect-global-assignments',
      'declare-globals',
      'explain-suppressions',
    ];
    const names = new Set(availablePlugins.map((plugin) => plugin.name));
    const defaultNames = pluginNames(buildMigrateConfig({}).config);
    defaultNames
      .filter((name) => !perRunPlugins.includes(name))
      .forEach((name) => expect(names).toContain(name));
  });

  it('runs jsdoc after strip-ts-ignore and before member-accessibility', () => {
    const names = pluginNames(buildMigrateConfig({}).config);
    expect(names.indexOf('jsdoc')).toBeGreaterThan(names.indexOf('strip-ts-ignore'));
    expect(names.indexOf('jsdoc')).toBeLessThan(names.indexOf('member-accessibility'));
    expect(names.indexOf('jsdoc')).toBeLessThan(names.indexOf('infer-types'));
    expect(names.indexOf('jsdoc')).toBeLessThan(names.indexOf('explicit-any'));
  });

  it('leaves return types to inference in the default pipeline', () => {
    const options = pluginOptions(buildMigrateConfig({}).config, 'jsdoc') as {
      annotateReturns?: unknown;
    };
    expect(options.annotateReturns).toBeFalsy();
    expect(
      (pluginOptions(buildMigrateConfig({ annotateReturns: true }).config, 'jsdoc') as {
        annotateReturns?: unknown;
      }).annotateReturns,
    ).toBe(true);
  });

  it('drops jsdoc with --jsdoc=false, leaving the rest of the pipeline alone', () => {
    const defaultNames = pluginNames(buildMigrateConfig({}).config);
    expect(defaultNames).toContain('jsdoc');
    expect(pluginNames(buildMigrateConfig({ jsdoc: false }).config)).toEqual(
      defaultNames.filter((name) => name !== 'jsdoc'),
    );
    expect(pluginNames(buildMigrateConfig({ excludePlugins: ['jsdoc'] }).config)).toEqual(
      defaultNames.filter((name) => name !== 'jsdoc'),
    );
  });

  it('drops the module declarations with --declareUntypedModules=false', () => {
    expect(pluginNames(buildMigrateConfig({}).config)).toContain('declare-untyped-modules');
    expect(pluginNames(buildMigrateConfig({ declareUntypedModules: false }).config)).not.toContain(
      'declare-untyped-modules',
    );
  });

  it('collects and declares the globals before add-conversions', () => {
    const names = pluginNames(buildMigrateConfig({}).config);

    expect(names.indexOf('collect-global-assignments')).toBeGreaterThan(-1);
    expect(names.indexOf('declare-globals')).toBe(names.indexOf('collect-global-assignments') + 1);
    expect(names.indexOf('declare-globals')).toBeLessThan(names.indexOf('add-conversions'));
  });

  it('runs the global declarations unless declareGlobals is false', () => {
    const globalPlugins = ['collect-global-assignments', 'declare-globals'];
    const declared = (params: Parameters<typeof buildMigrateConfig>[0]) => {
      const built = buildMigrateConfig(params);
      return {
        plugins: pluginNames(built.config).filter((name) => globalPlugins.includes(name)),
        collector: built.globalDeclarations !== undefined,
      };
    };

    expect(declared({ declareGlobals: true })).toEqual({ plugins: globalPlugins, collector: true });
    expect(declared({})).toEqual({ plugins: globalPlugins, collector: true });
    expect(declared({ declareGlobals: false })).toEqual({ plugins: [], collector: false });
  });

  it('adds the missing imports after the globals and before the passes that read types', () => {
    const names = pluginNames(buildMigrateConfig({}).config);

    expect(names.indexOf('add-missing-imports')).toBeGreaterThan(names.indexOf('declare-globals'));
    expect(names.indexOf('add-missing-imports')).toBeGreaterThan(names.indexOf('jsdoc'));
    expect(names.indexOf('add-missing-imports')).toBeLessThan(names.indexOf('react-props'));
    expect(names.indexOf('add-missing-imports')).toBeLessThan(names.indexOf('infer-types'));
    expect(names.indexOf('add-missing-imports')).toBeLessThan(names.indexOf('ts-ignore'));
  });

  it('drops add-missing-imports with --addMissingImports=false', () => {
    expect(pluginNames(buildMigrateConfig({ addMissingImports: true }).config)).toContain(
      'add-missing-imports',
    );
    expect(pluginNames(buildMigrateConfig({ addMissingImports: false }).config)).not.toContain(
      'add-missing-imports',
    );
  });

  it('passes the ambiguous import choice through', () => {
    expect(pluginOptions(buildMigrateConfig({}).config, 'add-missing-imports')).toEqual({
      ambiguous: undefined,
    });
    expect(
      pluginOptions(buildMigrateConfig({ ambiguousImports: 'skip' }).config, 'add-missing-imports'),
    ).toEqual({ ambiguous: 'skip' });
  });
});
