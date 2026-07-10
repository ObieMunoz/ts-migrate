import ts from 'typescript';

export type Nullable<T> = T | null | undefined;
export interface PluginParams<TPluginOptions> {
  options: TPluginOptions;
  fileName: string;
  rootDir: string;
  text: string;
  sourceFile: ts.SourceFile;
  getLanguageService: () => ts.LanguageService;
}

export type PluginResult = string | void;

export interface LintConfig {
  useTabs: boolean;
  tabWidth: number;
}

export interface Plugin<TPluginOptions = unknown> {
  name: string;
  run(
    params: PluginParams<TPluginOptions>,
    lintConfig?: LintConfig,
  ): Promise<PluginResult> | PluginResult;

  /**
   * Set when the plugin's edits never change any file's types (e.g. it only
   * inserts suppression comments). The runner then defers this plugin's overlay
   * writes to the end of its pass, so the language service checks every file
   * against one warm program instead of rebuilding it after each changed file.
   */
  mutationsPreserveTypes?: boolean;

  /**
   * Returns true if options is a valid options object for this plugin.
   * If options is invalid, it throws a PluginOptionsError.
   *
   * This method should be implemented if TPluginOptions is anything other than unknown.
   */
  validate?(options: unknown): options is TPluginOptions;
}

export type PluginWithOptions<TPluginOptions = unknown> = {
  plugin: Plugin<TPluginOptions>;
  options: TPluginOptions;
};
