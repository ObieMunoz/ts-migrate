import {
  addConversionsPlugin,
  convertCommonjsPlugin,
  declareMissingClassPropertiesPlugin,
  eslintFixPlugin,
  explicitAnyPlugin,
  hoistArrowFunctionsPlugin,
  hoistClassStaticsPlugin,
  hoistDeclarationsPlugin,
  inferTypesPlugin,
  jsDocPlugin,
  memberAccessibilityPlugin,
  reactClassLifecycleMethodsPlugin,
  reactClassStatePlugin,
  reactDefaultPropsPlugin,
  reactHookTypesPlugin,
  reactInlineImportedPropTypesPlugin,
  reactPropsPlugin,
  reactShapePlugin,
  stripTSIgnorePlugin,
  tsIgnorePlugin,
  updateImportPathsPlugin,
  createSuppressionExplainer,
  createTypesPackageDetector,
  SuppressionExplainer,
  TypesPackageDetector,
} from '@obiemunoz/ts-migrate-plugins';
import { MigrateConfig, Plugin } from '@obiemunoz/ts-migrate-server';
import log from 'updatable-log';

export const availablePlugins = [
  addConversionsPlugin,
  convertCommonjsPlugin,
  declareMissingClassPropertiesPlugin,
  eslintFixPlugin,
  explicitAnyPlugin,
  hoistArrowFunctionsPlugin,
  hoistClassStaticsPlugin,
  hoistDeclarationsPlugin,
  inferTypesPlugin,
  jsDocPlugin,
  memberAccessibilityPlugin,
  reactClassLifecycleMethodsPlugin,
  reactClassStatePlugin,
  reactDefaultPropsPlugin,
  reactHookTypesPlugin,
  reactInlineImportedPropTypesPlugin,
  reactPropsPlugin,
  reactShapePlugin,
  stripTSIgnorePlugin,
  tsIgnorePlugin,
  updateImportPathsPlugin,
];

interface BuildMigrateConfigParams {
  // yargs collects a repeated --plugin into an array, which is not a valid
  // selection but has to be recognized to be reported.
  plugin?: string | string[];
  excludePlugins?: string[];
  aliases?: string;
  typeMap?: string;
  annotateReturns?: boolean;
  useDefaultPropsHelper?: boolean;
  defaultAccessibility?: 'private' | 'protected' | 'public';
  privateRegex?: string;
  protectedRegex?: string;
  publicRegex?: string;
  inferTypes?: boolean;
  projectEslint?: boolean;
  declareUntypedModules?: boolean;
}

interface MigrateCommandConfig {
  config: MigrateConfig;
  typesPackageDetector?: TypesPackageDetector;
  suppressionExplainer?: SuppressionExplainer;
  anyAlias?: string;
  anyFunctionAlias?: string;
}

type PluginOptions<P> = P extends Plugin<infer TOptions> ? TOptions : never;

/** Type-checks an entry of the options table against the plugin it is for. */
function entry<P extends Plugin<any>>(plugin: P, options: PluginOptions<P>): [P, unknown] {
  return [plugin, options];
}

/**
 * The options every plugin runs with, in one place. Both `--plugin <name>` and
 * the default pipeline read from here, so a flag cannot reach one and not the
 * other.
 */
function buildPluginOptions(params: BuildMigrateConfigParams) {
  const airbnbAnyAlias = '$TSFixMe';
  const airbnbAnyFunctionAlias = '$TSFixMeFunction';
  // by default, we're not going to use any aliases in ts-migrate
  const anyAlias = params.aliases === 'tsfixme' ? airbnbAnyAlias : undefined;
  const anyFunctionAlias = params.aliases === 'tsfixme' ? airbnbAnyFunctionAlias : undefined;

  let typeMap;
  try {
    typeMap = params.typeMap ? JSON.parse(params.typeMap) : undefined;
  } catch (err) {
    throw new Error(`--typeMap must be valid JSON: ${(err as Error).message}`);
  }

  const options = new Map<Plugin<any>, unknown>([
    entry(addConversionsPlugin, { anyAlias }),
    entry(convertCommonjsPlugin, {}),
    entry(declareMissingClassPropertiesPlugin, { anyAlias }),
    entry(eslintFixPlugin, { projectEslint: params.projectEslint }),
    entry(explicitAnyPlugin, { anyAlias }),
    entry(hoistArrowFunctionsPlugin, {}),
    entry(hoistClassStaticsPlugin, { anyAlias }),
    entry(hoistDeclarationsPlugin, {}),
    entry(inferTypesPlugin, {}),
    entry(jsDocPlugin, { anyAlias, typeMap, annotateReturns: params.annotateReturns }),
    entry(memberAccessibilityPlugin, {
      defaultAccessibility: params.defaultAccessibility,
      privateRegex: params.privateRegex,
      protectedRegex: params.protectedRegex,
      publicRegex: params.publicRegex,
    }),
    entry(reactClassLifecycleMethodsPlugin, { force: true }),
    entry(reactClassStatePlugin, { anyAlias }),
    entry(reactDefaultPropsPlugin, {
      useDefaultPropsHelper: params.useDefaultPropsHelper ?? false,
    }),
    entry(reactHookTypesPlugin, { anyAlias }),
    entry(reactInlineImportedPropTypesPlugin, {}),
    entry(reactPropsPlugin, { anyAlias, anyFunctionAlias, shouldUpdateAirbnbImports: true }),
    entry(reactShapePlugin, { anyAlias, anyFunctionAlias }),
    entry(stripTSIgnorePlugin, {}),
    entry(tsIgnorePlugin, {}),
    entry(updateImportPathsPlugin, {}),
  ]);

  return {
    anyAlias,
    anyFunctionAlias,
    optionsFor: <P extends Plugin<any>>(plugin: P): PluginOptions<P> =>
      options.get(plugin) as PluginOptions<P>,
  };
}

/**
 * The flags that only reach a plugin through its options, and the option names
 * each one produces. Applicability is read off the options table rather than a
 * second per-plugin list that would drift from it. yargs applies the boolean
 * defaults before params arrive here, so a boolean counts as set only when it
 * differs from its default.
 */
function inapplicableFlags(params: BuildMigrateConfigParams, options: unknown): string[] {
  const setFlags: [string, string[]][] = [];
  if (params.aliases !== undefined) setFlags.push(['--aliases', ['anyAlias', 'anyFunctionAlias']]);
  if (params.typeMap !== undefined) setFlags.push(['--typeMap', ['typeMap']]);
  if (params.annotateReturns) setFlags.push(['--annotateReturns', ['annotateReturns']]);
  if (params.useDefaultPropsHelper)
    setFlags.push(['--useDefaultPropsHelper', ['useDefaultPropsHelper']]);
  if (params.defaultAccessibility !== undefined)
    setFlags.push(['--defaultAccessibility', ['defaultAccessibility']]);
  if (params.privateRegex !== undefined) setFlags.push(['--privateRegex', ['privateRegex']]);
  if (params.protectedRegex !== undefined) setFlags.push(['--protectedRegex', ['protectedRegex']]);
  if (params.publicRegex !== undefined) setFlags.push(['--publicRegex', ['publicRegex']]);
  if (params.projectEslint === false) setFlags.push(['--no-projectEslint', ['projectEslint']]);

  const accepted = new Set(Object.keys(options as object));
  return setFlags
    .filter(([, optionNames]) => !optionNames.some((name) => accepted.has(name)))
    .map(([flag]) => flag);
}

/**
 * Builds the MigrateConfig for the migrate command: either a single plugin
 * (`--plugin`) or the default pipeline, minus any `--exclude-plugin` names.
 * Throws on plugin names that don't exist.
 */
export default function buildMigrateConfig(params: BuildMigrateConfigParams): MigrateCommandConfig {
  const excludePlugins = params.excludePlugins ?? [];
  const unknownExcludes = excludePlugins.filter(
    (name) => !availablePlugins.some((plugin) => plugin.name === name),
  );
  if (unknownExcludes.length > 0) {
    throw new Error(
      `Cannot exclude unknown plugin(s): ${unknownExcludes.join(', ')}. ` +
        `Available plugins: ${availablePlugins.map((plugin) => plugin.name).join(', ')}.`,
    );
  }

  const { anyAlias, anyFunctionAlias, optionsFor } = buildPluginOptions(params);

  if (params.plugin) {
    if (Array.isArray(params.plugin)) {
      throw new Error(
        `--plugin takes a single plugin name, but was given ${params.plugin.join(', ')}. ` +
          'To run the default pipeline without some of its plugins, use --exclude-plugin instead.',
      );
    }
    const plugin = availablePlugins.find((cur) => cur.name === params.plugin);
    if (!plugin) {
      throw new Error(`Could not find a plugin named ${params.plugin}.`);
    }
    const options = optionsFor(plugin);
    const ignored = inapplicableFlags(params, options);
    if (ignored.length > 0) {
      log.warn(`Ignoring ${ignored.join(', ')}: not an option of the ${plugin.name} plugin.`);
    }
    return {
      config: new MigrateConfig().addPlugin(plugin, options),
      anyAlias,
      anyFunctionAlias,
    };
  }

  // Excluding infer-types is equivalent to --no-inferTypes: both switch
  // explicit-any to a single non-repeating pass.
  const inferTypes =
    (params.inferTypes ?? true) && !excludePlugins.includes(inferTypesPlugin.name);

  const config = new MigrateConfig()
    .addPlugin(updateImportPathsPlugin, optionsFor(updateImportPathsPlugin))
    // Runs on the specifiers update-import-paths has already re-pointed, and
    // before the passes that read types across files, which need the imports
    // this restores.
    .addPlugin(convertCommonjsPlugin, optionsFor(convertCommonjsPlugin))
    .addPlugin(stripTSIgnorePlugin, optionsFor(stripTSIgnorePlugin))
    .addPlugin(reactInlineImportedPropTypesPlugin, optionsFor(reactInlineImportedPropTypesPlugin))
    .addPlugin(hoistClassStaticsPlugin, optionsFor(hoistClassStaticsPlugin))
    .addPlugin(hoistArrowFunctionsPlugin, optionsFor(hoistArrowFunctionsPlugin))
    .addPlugin(hoistDeclarationsPlugin, optionsFor(hoistDeclarationsPlugin))
    .addPlugin(reactPropsPlugin, optionsFor(reactPropsPlugin))
    .addPlugin(reactClassStatePlugin, optionsFor(reactClassStatePlugin))
    .addPlugin(reactClassLifecycleMethodsPlugin, optionsFor(reactClassLifecycleMethodsPlugin))
    .addPlugin(reactDefaultPropsPlugin, optionsFor(reactDefaultPropsPlugin))
    .addPlugin(reactShapePlugin, optionsFor(reactShapePlugin))
    // Runs on the props react-props has just typed, so a setter called with
    // one is evidence instead of an any.
    .addPlugin(reactHookTypesPlugin, optionsFor(reactHookTypesPlugin))
    .addPlugin(declareMissingClassPropertiesPlugin, optionsFor(declareMissingClassPropertiesPlugin))
    .addPlugin(memberAccessibilityPlugin, optionsFor(memberAccessibilityPlugin));
  if (inferTypes) {
    // Annotations from one pass can surface new implicit anys (e.g. a
    // variable annotated `any` makes its callback parameters implicit
    // any), so these two repeat until the files stop changing.
    config
      .addPlugin(inferTypesPlugin, optionsFor(inferTypesPlugin), { repeatUntilStable: true })
      .addPlugin(explicitAnyPlugin, optionsFor(explicitAnyPlugin), { repeatUntilStable: true });
  } else {
    config.addPlugin(explicitAnyPlugin, optionsFor(explicitAnyPlugin));
  }
  const typesPackageDetector = createTypesPackageDetector();
  config
    .addPlugin(addConversionsPlugin, optionsFor(addConversionsPlugin))
    // We need to run eslint-fix before ts-ignore because formatting may affect where
    // the errors are that need to get ignored.
    .addPlugin(eslintFixPlugin, optionsFor(eslintFixPlugin))
    // Recommends @types packages from the diagnostics ts-ignore is about
    // to suppress, so it must run before they are hidden.
    .addPlugin(typesPackageDetector.plugin, {});
  if (params.declareUntypedModules ?? true) {
    // Declares the modules with no types available, so their imports resolve
    // for ts-ignore below instead of being suppressed one by one.
    config.addPlugin(typesPackageDetector.declarationsPlugin, {});
  }
  // Records what the compiler knew about each diagnostic ts-ignore is about to
  // hide, which nothing downstream can recover from the comment. Registered
  // after the declarations above so it sees the diagnostics ts-ignore sees.
  const suppressionExplainer = excludePlugins.includes(tsIgnorePlugin.name)
    ? undefined
    : createSuppressionExplainer();
  if (suppressionExplainer) {
    config.addPlugin(suppressionExplainer.plugin, {});
  }
  config
    .addPlugin(tsIgnorePlugin, optionsFor(tsIgnorePlugin))
    // We need to run eslint-fix again after ts-ignore to fix up formatting.
    .addPlugin(eslintFixPlugin, optionsFor(eslintFixPlugin));

  if (excludePlugins.length > 0) {
    const excluded = new Set(excludePlugins);
    config.plugins = config.plugins.filter(({ plugin }) => !excluded.has(plugin.name));
  }

  return { config, typesPackageDetector, suppressionExplainer, anyAlias, anyFunctionAlias };
}
