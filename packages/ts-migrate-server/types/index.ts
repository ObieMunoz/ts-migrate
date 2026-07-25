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
   * are reported without being counted as files left unchanged.
   */
  recovered?: boolean;
}

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
  /**
   * Reports something that went wrong for this file, instead of printing it.
   * The runner groups identical causes across the pass and prints one line per
   * cause once the progress counter is out of the way; printing from inside a
   * pass both repeats the cause per file and gets overwritten by the counter.
   */
  reportFileNotice?: (notice: PluginFileNotice) => void;
  /**
   * Runs `use` with `fileName` reading as `text`, then restores the file's real
   * content. Lets a plugin type-check a candidate edit against the run's
   * already-warm program instead of building a throwaway one for it.
   *
   * Both the swap and the rollback invalidate the program, so each call costs
   * two re-syncs: make every query a candidate needs inside one call. Absent
   * for `independentFiles` plugins, whose runs overlap and so would observe
   * each other's scratch text.
   */
  withScratchText?: <T>(fileName: string, text: string, use: () => T) => T;
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
