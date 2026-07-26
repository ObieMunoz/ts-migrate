/**
 * The declarations for yargs 18, which this repo owns.
 *
 * yargs 18 ships none: its `files` list excludes every declaration file, so
 * only `browser.d.ts` survives into the tarball. DefinitelyTyped stops at
 * `@types/yargs@17`, whose `export = yargs` describes the singleton 18
 * removed, so pointing 17 at 18 would type a value that no longer exists.
 *
 * `export =` rather than `export default`: yargs 18 is ESM, and `cli.ts` is
 * compiled to CommonJS, so the import becomes `require('yargs')`. yargs 18
 * ships `export {Yargs as 'module.exports'}` for exactly that call, which is
 * Node's interop marker for `require()` of an ES module: the require returns
 * the factory itself rather than a namespace holding it. That marker is why
 * this package does not have to become ESM. It also fixes the Node floor,
 * because `require()` of an ES module only works from 20.19.0 on, which is
 * the range yargs 18 declares in its own `engines`.
 *
 * Only the surface `cli.ts` calls is declared. The chain carries the option
 * types forward so a command's handler still reads its own flags off `args`;
 * that inference is the reason these declarations are generic rather than a
 * single `any`.
 */
declare module 'yargs' {
  function yargs(args?: readonly string[], cwd?: string): yargs.Argv;

  namespace yargs {
    /**
     * The parsed arguments a handler receives. The index signature is what
     * yargs itself promises: aliases, camelCase and dash-case spellings of the
     * declared flags all land on the object, and nothing here knows their
     * names. Declared keys keep the precise type from the chain.
     */
    type Arguments<T = object> = T & {
      _: Array<string | number>;
      $0: string;
      [argName: string]: unknown;
    };

    type OptionType = 'boolean' | 'number' | 'string';

    interface Options {
      alias?: string | readonly string[];
      choices?: readonly any[];
      default?: any;
      describe?: string;
      type?: OptionType;
    }

    interface PositionalOptions {
      choices?: readonly any[];
      default?: any;
      describe?: string;
      type?: OptionType;
    }

    type ValueOfType<N> = N extends 'boolean'
      ? boolean
      : N extends 'number'
        ? number
        : N extends 'string'
          ? string
          : unknown;

    /**
     * The type a `.option()`/`.positional()` descriptor produces. A descriptor
     * carrying a default always has a value, so `undefined` is only added when
     * there is none.
     */
    type InferredOptionType<O> = O extends { choices: readonly (infer C)[]; default: infer D }
      ? C | D
      : O extends { choices: readonly (infer C)[] }
        ? C | undefined
        : O extends { type: infer N; default: infer D }
          ? ValueOfType<N> | D
          : O extends { type: infer N }
            ? ValueOfType<N> | undefined
            : O extends { default: infer D }
              ? D
              : unknown;

    /** `.require(keys)`: yargs refuses to run the handler without them. */
    type Defined<T, K extends keyof T> = Omit<T, K> & {
      [key in K]-?: Exclude<T[key], undefined>;
    };

    /** Only the parser settings this CLI chooses; yargs-parser has many more. */
    interface ParserConfiguration {
      /**
       * Leave the dashed spelling of a camelCase flag out of the parsed
       * arguments, so each flag arrives under one name. Both spellings still
       * parse: this is about the result, not the input.
       */
      'strip-dashed'?: boolean;
    }

    /**
     * The options registered on an instance so far. Only the flag names are
     * declared, which is what the config file is validated against.
     */
    interface RegisteredOptions {
      key: Record<string, boolean>;
    }

    /** `T` is the flags declared so far; the chain adds to it as it goes. */
    interface Argv<T = object> {
      /** A Promise when any command handler is async, which `full` and `migrate` are. */
      argv: Arguments<T> | Promise<Arguments<T>>;

      alias(shortName: string, longName: string): Argv<T>;
      boolean<K extends keyof T>(key: K): Argv<Omit<T, K> & { [key in K]: boolean | undefined }>;
      boolean<K extends string>(key: K): Argv<T & { [key in K]: boolean | undefined }>;
      choices<K extends keyof T, C extends readonly any[]>(
        key: K,
        values: C,
      ): Argv<Omit<T, K> & { [key in K]: C[number] | undefined }>;
      choices<K extends string, C extends readonly any[]>(
        key: K,
        values: C,
      ): Argv<T & { [key in K]: C[number] | undefined }>;
      command<U>(
        command: string,
        description: string,
        builder: (args: Argv<T>) => Argv<U>,
        handler: (args: Arguments<U>) => void | Promise<void>,
      ): Argv<T>;
      /**
       * Reads flags from the file `key` names. `parseFn` receives the path and
       * returns the flags to apply; anything it throws is reported as a parse
       * failure. Values from the file are defaults, so a flag on the command
       * line wins. One overload only: the key is always new to the chain.
       */
      config<K extends string>(
        key: K,
        description: string,
        parseFn: (configPath: string) => object,
      ): Argv<T & { [key in K]: string | undefined }>;
      conflicts(key: string, value: string): Argv<T>;
      default<K extends keyof T, V>(key: K, value: V): Argv<Omit<T, K> & { [key in K]: V }>;
      default<K extends string, V>(key: K, value: V): Argv<T & { [key in K]: V }>;
      demandCommand(min: number, minMsg?: string): Argv<T>;
      describe(key: string, description: string): Argv<T>;
      epilogue(msg: string): Argv<T>;
      example(command: string, description: string): Argv<T>;
      /** The flag names registered so far, which a command builder reports. */
      getOptions(): RegisteredOptions;
      help(option?: string): Argv<T>;
      number<K extends keyof T>(key: K): Argv<Omit<T, K> & { [key in K]: number | undefined }>;
      number<K extends string>(key: K): Argv<T & { [key in K]: number | undefined }>;
      parserConfiguration(configuration: ParserConfiguration): Argv<T>;
      option<K extends keyof T, O extends Options>(
        key: K,
        options: O,
      ): Argv<Omit<T, K> & { [key in K]: InferredOptionType<O> }>;
      option<K extends string, O extends Options>(
        key: K,
        options: O,
      ): Argv<T & { [key in K]: InferredOptionType<O> }>;
      positional<K extends keyof T, O extends PositionalOptions>(
        key: K,
        options: O,
      ): Argv<Omit<T, K> & { [key in K]: InferredOptionType<O> }>;
      positional<K extends string, O extends PositionalOptions>(
        key: K,
        options: O,
      ): Argv<T & { [key in K]: InferredOptionType<O> }>;
      recommendCommands(): Argv<T>;
      require<K extends keyof T>(keys: readonly K[], msg?: string): Argv<Defined<T, K>>;
      scriptName(name: string): Argv<T>;
      strictCommands(enabled?: boolean): Argv<T>;
      strictOptions(enabled?: boolean): Argv<T>;
      string<K extends keyof T>(key: K): Argv<Omit<T, K> & { [key in K]: string | undefined }>;
      string<K extends string>(key: K): Argv<T & { [key in K]: string | undefined }>;
      /** null off a TTY, which is why every caller has to pick a fallback width. */
      terminalWidth(): number | null;
      usage(message: string): Argv<T>;
      version(version: string): Argv<T>;
      wrap(columns: number | null): Argv<T>;
    }
  }

  export = yargs;
}

declare module 'yargs/helpers' {
  /** Drops the executable and script path, leaving the arguments to parse. */
  export function hideBin(argv: readonly string[]): string[];
}
