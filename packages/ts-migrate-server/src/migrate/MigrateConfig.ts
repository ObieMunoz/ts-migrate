import { Plugin } from '../../types';

type InferOptions<P> = P extends Plugin<infer O> ? O : never;

interface AddPluginConfig {
  repeatUntilStable?: boolean;
}

export default class MigrateConfig {
  plugins: { plugin: Plugin<unknown>; options: unknown; repeatUntilStable?: boolean }[] = [];

  /**
   * Consecutive plugins added with `repeatUntilStable` form a group that is
   * re-run until a full pass leaves every file unchanged (bounded), for
   * plugins whose edits can surface new diagnostics for each other.
   */
  addPlugin<P extends Plugin<unknown>>(
    plugin: P,
    options: InferOptions<P>,
    pluginConfig?: AddPluginConfig,
  ): this {
    this.plugins.push({ plugin, options, repeatUntilStable: pluginConfig?.repeatUntilStable });
    return this;
  }
}
