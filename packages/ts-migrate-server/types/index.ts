import ts from 'typescript';

export type Nullable<T> = T | null | undefined;

/**
 * Something that went wrong for one file. A cause that is a property of the
 * project rather than of the file (a lint rule that throws, a parser that
 * cannot read TypeScript) repeats identically for every file that reaches it,
 * so plugins report these and the runner groups them.
 */
export interface PluginFileNotice {
  /** The cause, as one line. Identical reasons group together. */
  reason: string;
  /** What the cause is attributed to, when the tool names one (an ESLint rule). */
  ruleId?: string;
  /** Guidance printed once under the group, for a cause the plugin recognizes. */
  hint?: string;
  /**
   * Set when the plugin still produced its normal result for the file. Those
   * are reported without being counted as files left unchanged, and the file
   * stays in the passes that follow.
   */
  recovered?: boolean;
  /**
   * Set when the plugin wrote a comment at the site this is about, so the run
   * can send people to the files instead of listing them. A cause with no one
   * site to point at leaves this unset.
   */
  marked?: boolean;
}

/**
 * The project's own module resolution, for a plugin that needs to know where a
 * specifier points without building a program. The host and cache are the ones
 * the language service resolves through, so a lookup here is a cache hit for
 * anything the program already resolved.
 */
export interface ModuleResolution {
  compilerOptions: ts.CompilerOptions;
  host: ts.ModuleResolutionHost;
  cache: ts.ModuleResolutionCache;
}

export interface PluginParams<TPluginOptions> {
  options: TPluginOptions;
  fileName: string;
  rootDir: string;
  text: string;
  sourceFile: ts.SourceFile;
  getLanguageService: () => ts.LanguageService;
  /**
   * Unset when the plugin runs outside a migration project, in which case a
   * plugin that needs resolution leaves whatever it cannot check alone.
   */
  moduleResolution?: ModuleResolution;
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
  /**
   * Reports something that went wrong for this file, instead of printing it.
   * The runner groups identical causes across the pass and prints one line per
   * cause once the progress counter is out of the way; printing from inside a
   * pass both repeats the cause per file and gets overwritten by the counter.
   *
   * A notice that is not `recovered` says the plugin could not process the
   * file, so a repeating group leaves that file out of its later passes for as
   * long as its text stays as it was, and prints the cause for it once.
   */
  reportFileNotice?: (notice: PluginFileNotice) => void;
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
