import ts from 'typescript';

export type Nullable<T> = T | null | undefined;
export interface PluginParams<TPluginOptions> {
  options: TPluginOptions;
  fileName: string;
  rootDir: string;
  text: string;
  sourceFile: ts.SourceFile;
  getLanguageService: () => ts.LanguageService;
  /**
   * Adds a declaration file to the program and to the files the run writes at
   * the end (nothing is written on a dry run). Lets a plugin declare types the
   * later plugins should then see resolve.
   *
   * The program is rebuilt on the next language service call, so every checked
   * file loses its cached diagnostics: call this once for the whole run, from
   * a pass of its own, rather than once per file. Passing the text a previous
   * run already wrote is a no-op.
   */
  addGeneratedFile?: (fileName: string, text: string) => void;
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
   * Set when each file's new text depends only on that file's own current
   * text — not on other files or on language service state that another
   * file's edit could change mid-pass. The runner then keeps every file's
   * run() call in flight at once instead of awaiting them one at a time,
   * which lets the plugin overlap per-file work (e.g. in worker threads).
   */
  independentFiles?: boolean;

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
