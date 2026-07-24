import {
  addConversionsPlugin,
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
  reactInlineImportedPropTypesPlugin,
  reactPropsPlugin,
  reactShapePlugin,
  stripTSIgnorePlugin,
  tsIgnorePlugin,
  updateImportPathsPlugin,
  createTypesPackageDetector,
  TypesPackageDetector,
} from '@obiemunoz/ts-migrate-plugins';
import { MigrateConfig } from '@obiemunoz/ts-migrate-server';

export const availablePlugins = [
  addConversionsPlugin,
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
  reactInlineImportedPropTypesPlugin,
  reactPropsPlugin,
  reactShapePlugin,
  stripTSIgnorePlugin,
  tsIgnorePlugin,
  updateImportPathsPlugin,
];

interface BuildMigrateConfigParams {
  plugin?: string;
  excludePlugins?: string[];
  aliases?: string;
  typeMap?: string;
  useDefaultPropsHelper?: boolean;
  defaultAccessibility?: 'private' | 'protected' | 'public';
  privateRegex?: string;
  protectedRegex?: string;
  publicRegex?: string;
  inferTypes?: boolean;
}

interface MigrateCommandConfig {
  config: MigrateConfig;
  typesPackageDetector?: TypesPackageDetector;
  anyAlias?: string;
  anyFunctionAlias?: string;
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

  const airbnbAnyAlias = '$TSFixMe';
  const airbnbAnyFunctionAlias = '$TSFixMeFunction';
  // by default, we're not going to use any aliases in ts-migrate
  const anyAlias = params.aliases === 'tsfixme' ? airbnbAnyAlias : undefined;
  const anyFunctionAlias = params.aliases === 'tsfixme' ? airbnbAnyFunctionAlias : undefined;

  if (params.plugin) {
    const plugin = availablePlugins.find((cur) => cur.name === params.plugin);
    if (!plugin) {
      throw new Error(`Could not find a plugin named ${params.plugin}.`);
    }
    if (plugin === jsDocPlugin) {
      let typeMap;
      try {
        typeMap = params.typeMap ? JSON.parse(params.typeMap) : undefined;
      } catch (err) {
        throw new Error(`--typeMap must be valid JSON: ${(err as Error).message}`);
      }
      return {
        config: new MigrateConfig().addPlugin(jsDocPlugin, { anyAlias, typeMap }),
        anyAlias,
        anyFunctionAlias,
      };
    }
    return {
      config: new MigrateConfig().addPlugin(plugin, { anyAlias, anyFunctionAlias }),
      anyAlias,
      anyFunctionAlias,
    };
  }

  const useDefaultPropsHelper = params.useDefaultPropsHelper ?? false;

  const { defaultAccessibility, privateRegex, protectedRegex, publicRegex } = params;

  // Excluding infer-types is equivalent to --no-inferTypes: both switch
  // explicit-any to a single non-repeating pass.
  const inferTypes =
    (params.inferTypes ?? true) && !excludePlugins.includes(inferTypesPlugin.name);

  const config = new MigrateConfig()
    .addPlugin(updateImportPathsPlugin, {})
    .addPlugin(stripTSIgnorePlugin, {})
    .addPlugin(reactInlineImportedPropTypesPlugin, {})
    .addPlugin(hoistClassStaticsPlugin, { anyAlias })
    .addPlugin(hoistArrowFunctionsPlugin, {})
    .addPlugin(hoistDeclarationsPlugin, {})
    .addPlugin(reactPropsPlugin, {
      anyAlias,
      anyFunctionAlias,
      shouldUpdateAirbnbImports: true,
    })
    .addPlugin(reactClassStatePlugin, { anyAlias })
    .addPlugin(reactClassLifecycleMethodsPlugin, { force: true })
    .addPlugin(reactDefaultPropsPlugin, {
      useDefaultPropsHelper,
    })
    .addPlugin(reactShapePlugin, {
      anyAlias,
      anyFunctionAlias,
    })
    .addPlugin(declareMissingClassPropertiesPlugin, { anyAlias })
    .addPlugin(memberAccessibilityPlugin, {
      defaultAccessibility,
      privateRegex,
      protectedRegex,
      publicRegex,
    });
  if (inferTypes) {
    // Annotations from one pass can surface new implicit anys (e.g. a
    // variable annotated `any` makes its callback parameters implicit
    // any), so these two repeat until the files stop changing.
    config
      .addPlugin(inferTypesPlugin, {}, { repeatUntilStable: true })
      .addPlugin(explicitAnyPlugin, { anyAlias }, { repeatUntilStable: true });
  } else {
    config.addPlugin(explicitAnyPlugin, { anyAlias });
  }
  const typesPackageDetector = createTypesPackageDetector();
  config
    .addPlugin(addConversionsPlugin, { anyAlias })
    // We need to run eslint-fix before ts-ignore because formatting may affect where
    // the errors are that need to get ignored.
    .addPlugin(eslintFixPlugin, {})
    // Recommends @types packages from the diagnostics ts-ignore is about
    // to suppress, so it must run before they are hidden.
    .addPlugin(typesPackageDetector.plugin, {})
    .addPlugin(tsIgnorePlugin, {})
    // We need to run eslint-fix again after ts-ignore to fix up formatting.
    .addPlugin(eslintFixPlugin, {});

  if (excludePlugins.length > 0) {
    const excluded = new Set(excludePlugins);
    config.plugins = config.plugins.filter(({ plugin }) => !excluded.has(plugin.name));
  }

  return { config, typesPackageDetector, anyAlias, anyFunctionAlias };
}
