import fs from 'fs';
import path from 'path';
import log from 'updatable-log';
import ts from 'typescript';
import { BundlerDetection } from './bundler';
import { toPosix } from './paths';
import { readText } from './readText';

/** A mapping the project declares and this cannot translate. */
export interface SkippedAlias {
  /** How the project names it, e.g. `resolve.alias "@"`. */
  name: string;
  reason: string;
}

/**
 * Always `paths` and never `baseUrl`, which TypeScript 6 reports as deprecated
 * (TS5101) and 7 drops. A `"*"` pattern covers what a baseUrl did: a specifier
 * no pattern answers falls through to node_modules either way.
 */
export interface PathAliases {
  /** Keys sorted, values relative to the tsconfig with forward slashes. */
  paths?: Record<string, string[]>;
  /** rootDir-relative names of the files the mapping was read from. */
  source: string;
  skipped: SkippedAlias[];
}

const PATH_MODULES = new Set(['path', 'node:path']);

const CONFIG_EXTENSION_REGEX = /\.[cm]?[jt]sx?$/;

/** Extensions a `paths` entry must not carry: the compiler substitutes them. */
const CODE_EXTENSION_REGEX = /\.([cm]?[jt]sx?)$/;

/** What a `paths` value may point at when the target has no extension. */
const RESOLVABLE_EXTENSIONS = [
  '',
  '.ts',
  '.tsx',
  '.d.ts',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
];

/**
 * The names in scope of a config file that a value can be read through, and
 * the directory `__dirname` stands for.
 */
interface EvalScope {
  dirname: string;
  /** Local names bound to node's path module. */
  pathModule: Set<string>;
  /** Top-level const bindings whose initializer is a known string. */
  constants: Map<string, string>;
}

function propertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return null;
}

function property(
  objectLiteral: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  return objectLiteral.properties.find(
    (member): member is ts.PropertyAssignment =>
      ts.isPropertyAssignment(member) && propertyName(member.name) === name,
  );
}

function requiredModule(node: ts.Expression): string | null {
  if (!ts.isCallExpression(node)) return null;
  if (!ts.isIdentifier(node.expression) || node.expression.text !== 'require') return null;
  const [specifier] = node.arguments;
  return specifier && ts.isStringLiteralLike(specifier) ? specifier.text : null;
}

function pathMethod(node: ts.CallExpression, scope: EvalScope): 'join' | 'resolve' | null {
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  const { expression, name } = node.expression;
  if (!ts.isIdentifier(expression) || !scope.pathModule.has(expression.text)) return null;
  return name.text === 'join' || name.text === 'resolve' ? name.text : null;
}

/**
 * The string an expression stands for, or null when reading it would take
 * running the config. Only the forms a resolve entry is written in are
 * understood: literals, `__dirname`, `path.join`/`path.resolve` over those,
 * and const bindings of the same. Everything else stays unknown, which is
 * what keeps a computed alias from being guessed at.
 */
function evaluate(node: ts.Expression, scope: EvalScope): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return evaluate(node.expression, scope);
  if (ts.isIdentifier(node)) {
    if (node.text === '__dirname') return scope.dirname;
    return scope.constants.get(node.text) ?? null;
  }
  if (ts.isTemplateExpression(node)) {
    const parts = [node.head.text];
    for (const span of node.templateSpans) {
      const value = evaluate(span.expression, scope);
      if (value === null) return null;
      parts.push(value, span.literal.text);
    }
    return parts.join('');
  }
  if (ts.isCallExpression(node)) {
    const method = pathMethod(node, scope);
    if (method === null) return null;
    const args: string[] = [];
    for (const argument of node.arguments) {
      const value = evaluate(argument, scope);
      if (value === null) return null;
      args.push(value);
    }
    // A relative result stands for a path from the config file, which is
    // where a build reading it runs.
    return method === 'join' ? path.join(...args) : path.resolve(scope.dirname, ...args);
  }
  return null;
}

/** The path-module and const bindings a config file's top level introduces. */
function collectScope(sourceFile: ts.SourceFile, dirname: string): EvalScope {
  const scope: EvalScope = { dirname, pathModule: new Set(), constants: new Map() };
  sourceFile.statements.forEach((statement) => {
    if (ts.isImportDeclaration(statement)) {
      if (!ts.isStringLiteralLike(statement.moduleSpecifier)) return;
      if (!PATH_MODULES.has(statement.moduleSpecifier.text)) return;
      const clause = statement.importClause;
      if (clause?.name) scope.pathModule.add(clause.name.text);
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        scope.pathModule.add(clause.namedBindings.name.text);
      }
      return;
    }
    if (!ts.isVariableStatement(statement)) return;
    // let and var can be reassigned, so only const says what a name holds.
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) return;
    statement.declarationList.declarations.forEach((declaration) => {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return;
      const required = requiredModule(declaration.initializer);
      if (required !== null) {
        if (PATH_MODULES.has(required)) scope.pathModule.add(declaration.name.text);
        return;
      }
      const value = evaluate(declaration.initializer, scope);
      if (value !== null) scope.constants.set(declaration.name.text, value);
    });
  });
  return scope;
}

/**
 * Every `resolve: { ... }` that names an alias or a module directory. A config
 * split per environment, or built up before it is exported, holds more than
 * one; a rule's `resolve` holds neither and is left out.
 */
function collectResolveObjects(sourceFile: ts.SourceFile): ts.ObjectLiteralExpression[] {
  const found: ts.ObjectLiteralExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && propertyName(node.name) === 'resolve') {
      const value = node.initializer;
      if (
        ts.isObjectLiteralExpression(value) &&
        (property(value, 'alias') || property(value, 'modules'))
      ) {
        found.push(value);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** A target's rootDir-relative form, or null when it is outside rootDir. */
function insideRoot(rootDir: string, target: string): string | null {
  const relative = path.relative(rootDir, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return relative === '' ? '.' : toPosix(relative);
}

function statOf(target: string): fs.Stats | null {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

/** Raw `resolve.modules` and `resolve.alias` entries, before validation. */
interface WebpackResolve {
  /** One per `resolve.modules` entry, null where it could not be read. */
  modules: Array<string | null>;
  aliases: Array<{ key: string; value: string | null }>;
}

function readResolveObject(
  objectLiteral: ts.ObjectLiteralExpression,
  scope: EvalScope,
): WebpackResolve {
  const result: WebpackResolve = { modules: [], aliases: [] };
  const modules = property(objectLiteral, 'modules');
  if (modules && ts.isArrayLiteralExpression(modules.initializer)) {
    modules.initializer.elements.forEach((element) => {
      result.modules.push(evaluate(element, scope));
    });
  }
  const alias = property(objectLiteral, 'alias');
  if (alias && ts.isObjectLiteralExpression(alias.initializer)) {
    alias.initializer.properties.forEach((member) => {
      if (!ts.isPropertyAssignment(member)) return;
      const key = propertyName(member.name);
      if (key === null) return;
      result.aliases.push({ key, value: evaluate(member.initializer, scope) });
    });
  }
  return result;
}

function webpackConfigFiles(rootDir: string): string[] {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(rootDir);
  } catch {
    return [];
  }
  return entries
    .filter(
      (entry) => entry.startsWith('webpack.config.') && CONFIG_EXTENSION_REGEX.test(entry),
    )
    .sort();
}

/** Whether a `paths` value points at something that exists. */
function targetExists(rootDir: string, value: string): boolean {
  const wildcard = value.indexOf('*');
  if (wildcard >= 0) {
    const prefix = value.slice(0, wildcard).replace(/\/$/, '');
    return prefix === '' || statOf(path.resolve(rootDir, prefix)) !== null;
  }
  return RESOLVABLE_EXTENSIONS.some(
    (extension) => statOf(path.resolve(rootDir, value + extension)) !== null,
  );
}

/**
 * A rootDir-relative path as a `paths` value. Without a baseUrl the compiler
 * reads the value from the tsconfig and rejects one that is not written as a
 * relative path (TS5090).
 */
function configValue(relative: string, suffix = ''): string {
  if (relative === '.') return suffix === '' ? '.' : `./${suffix}`;
  return suffix === '' ? `./${relative}` : `./${relative}/${suffix}`;
}

/**
 * The `paths` entries one alias needs. A directory answers both the alias
 * itself and everything under it, which is what webpack matches; a file
 * answers only itself, with the extension dropped so the compiler can pick
 * the migrated one.
 */
function aliasEntries(key: string, relative: string, isDirectory: boolean): [string, string[]][] {
  // A trailing $ is webpack's exact-match marker.
  if (key.endsWith('$')) return [[key.slice(0, -1), [configValue(relative)]]];
  if (!isDirectory) {
    return [[key, [configValue(relative.replace(CODE_EXTENSION_REGEX, ''))]]];
  }
  return [
    [key, [configValue(relative)]],
    [`${key}/*`, [configValue(relative, '*')]],
  ];
}

interface Translation {
  moduleDirectories: string[];
  paths: Record<string, string[]>;
  skipped: SkippedAlias[];
}

function translate(rootDir: string, resolves: WebpackResolve[]): Translation {
  const moduleDirectories: string[] = [];
  const paths: Record<string, string[]> = {};
  const skipped: SkippedAlias[] = [];
  const seenAliases = new Map<string, string>();

  resolves.forEach(({ modules, aliases }) => {
    modules.forEach((value, index) => {
      const name = `resolve.modules[${index}]`;
      if (value === null) {
        skipped.push({ name, reason: 'its value is computed when the config runs' });
        return;
      }
      // The bare name is node's own lookup, which the compiler already does.
      if (value === 'node_modules' || value.endsWith(`${path.sep}node_modules`)) return;
      const target = path.resolve(rootDir, value);
      const relative = insideRoot(rootDir, target);
      if (relative === null) {
        skipped.push({ name, reason: `${value} is outside the migration root` });
        return;
      }
      if (!statOf(target)?.isDirectory()) {
        skipped.push({ name, reason: `${relative} is not a directory` });
        return;
      }
      if (!moduleDirectories.includes(relative)) moduleDirectories.push(relative);
    });

    aliases.forEach(({ key, value }) => {
      const name = `resolve.alias "${key}"`;
      if (value === null) {
        skipped.push({ name, reason: 'its target is computed when the config runs' });
        return;
      }
      const target = path.resolve(rootDir, value);
      const relative = insideRoot(rootDir, target);
      if (relative === null) {
        skipped.push({ name, reason: `${value} is outside the migration root` });
        return;
      }
      const stats = statOf(target);
      if (stats === null) {
        skipped.push({ name, reason: `${relative} does not exist` });
        return;
      }
      const previous = seenAliases.get(key);
      if (previous !== undefined) {
        if (previous !== relative) {
          skipped.push({ name, reason: 'the configs disagree about its target' });
        }
        return;
      }
      seenAliases.set(key, relative);
      aliasEntries(key, relative, stats.isDirectory()).forEach(([pattern, values]) => {
        paths[pattern] = values;
      });
    });
  });

  return { moduleDirectories, paths, skipped };
}

function sortPaths(paths: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * What a webpack config's `resolve` says, read without running it. A config
 * that computes its aliases, composes them or exports a function is only
 * partly readable, so each entry is translated on its own and the rest is
 * reported.
 */
function webpackAliases(rootDir: string): PathAliases | null {
  const files = webpackConfigFiles(rootDir);
  const resolves: WebpackResolve[] = [];
  const read: string[] = [];
  files.forEach((file) => {
    const text = readText(path.join(rootDir, file));
    if (text === undefined) return;
    const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const objects = collectResolveObjects(sourceFile);
    if (objects.length === 0) return;
    const scope = collectScope(sourceFile, path.resolve(rootDir));
    objects.forEach((objectLiteral) => resolves.push(readResolveObject(objectLiteral, scope)));
    read.push(file);
  });
  if (resolves.length === 0) return null;

  const { moduleDirectories, paths, skipped } = translate(rootDir, resolves);
  const source = read.join(', ');
  // A specifier no pattern answers falls through to node_modules, which is
  // where webpack's own modules list ends too.
  if (moduleDirectories.length > 0) {
    paths['*'] = moduleDirectories.map((directory) => configValue(directory, '*'));
  }
  if (Object.keys(paths).length === 0) {
    return skipped.length > 0 ? { source, skipped } : null;
  }
  return { paths: sortPaths(paths), source, skipped };
}

/**
 * A jsconfig `paths` value, read from that config's baseUrl, rewritten to be
 * read from the tsconfig instead. Null when it leaves the migration root.
 */
function rebase(baseUrlRelative: string, value: string): string | null {
  if (path.isAbsolute(value)) return null;
  const joined =
    baseUrlRelative === '.'
      ? path.posix.normalize(value)
      : path.posix.normalize(`${baseUrlRelative}/${value}`);
  if (joined.startsWith('..')) return null;
  return configValue(joined);
}

/**
 * The resolution a project already wrote for its editor. A jsconfig.json is
 * the project saying what its absolute imports mean, so it needs no
 * interpretation; its baseUrl becomes the `"*"` pattern that does the same
 * job, and an entry whose target is gone is still left out.
 */
function jsConfigAliases(rootDir: string): PathAliases | null {
  const file = path.join(rootDir, 'jsconfig.json');
  const text = readText(file);
  if (text === undefined) return null;
  const { config, error } = ts.parseConfigFileTextToJson(file, text);
  if (error || typeof config !== 'object' || config === null) return null;
  const compilerOptions = (config as { compilerOptions?: unknown }).compilerOptions;
  if (typeof compilerOptions !== 'object' || compilerOptions === null) return null;
  const { baseUrl, paths } = compilerOptions as { baseUrl?: unknown; paths?: unknown };

  const skipped: SkippedAlias[] = [];
  const declaredBaseUrl = typeof baseUrl === 'string' ? baseUrl : '.';
  const baseUrlRelative = insideRoot(rootDir, path.resolve(rootDir, declaredBaseUrl));
  let root: string | undefined;
  if (typeof baseUrl === 'string') {
    if (baseUrlRelative === null) {
      skipped.push({ name: 'baseUrl', reason: `${baseUrl} is outside the migration root` });
    } else if (!statOf(path.resolve(rootDir, baseUrlRelative))?.isDirectory()) {
      skipped.push({ name: 'baseUrl', reason: `${baseUrl} is not a directory` });
    } else {
      root = configValue(baseUrlRelative, '*');
    }
  }

  const kept: Record<string, string[]> = {};
  if (typeof paths === 'object' && paths !== null && baseUrlRelative !== null) {
    const from = path.resolve(rootDir, baseUrlRelative);
    Object.entries(paths as Record<string, unknown>).forEach(([pattern, values]) => {
      if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) return;
      const unusable = (values as string[]).filter(
        (value) => rebase(baseUrlRelative, value) === null || !targetExists(from, value),
      );
      if (unusable.length > 0) {
        skipped.push({
          name: `paths "${pattern}"`,
          reason: `${unusable.join(', ')} does not exist`,
        });
        return;
      }
      kept[pattern] = (values as string[]).map((value) => rebase(baseUrlRelative, value) as string);
    });
  }
  // The compiler tries every pattern before it tries the baseUrl, so the
  // wildcard the baseUrl becomes goes last.
  if (root !== undefined) kept['*'] = [...(kept['*'] ?? []), root];

  if (Object.keys(kept).length === 0) {
    return skipped.length > 0 ? { source: 'jsconfig.json', skipped } : null;
  }
  return { paths: sortPaths(kept), source: 'jsconfig.json', skipped };
}

/**
 * The tsconfig equivalent of the module resolution a project configures
 * elsewhere, so its absolute imports resolve instead of collecting a TS2307
 * at every import site. A mapping that cannot be established from the config
 * text alone is left out rather than guessed at: an unresolved import is a
 * visible suppression, while a wrong mapping resolves to another module and
 * type-checks.
 */
export function detectPathAliases(
  rootDir: string,
  bundler: BundlerDetection | null,
): PathAliases | null {
  const fromJsConfig = jsConfigAliases(rootDir);
  if (fromJsConfig?.paths !== undefined) return fromJsConfig;
  const fromWebpack = bundler?.name === 'webpack' ? webpackAliases(rootDir) : null;
  return fromWebpack ?? fromJsConfig;
}

/** The tsconfig field, rendered for the generated config. */
export function renderPathAliases(aliases: PathAliases): string {
  if (aliases.paths === undefined) return '';
  const entries = Object.entries(aliases.paths).map(
    ([pattern, values]) =>
      `      "${pattern}": [${values.map((value) => `"${value}"`).join(', ')}]`,
  );
  return `
    // Absolute imports this project resolves through ${aliases.source}, which
    // the compiler resolves only from here. A "*" pattern is the whole-root
    // form; anything it does not answer still resolves from node_modules.
    "paths": {
${entries.join(',\n')}
    },`;
}

export function logPathAliases(aliases: PathAliases): void {
  if (aliases.paths !== undefined) {
    log.info(
      `Read "paths" for ${Object.keys(aliases.paths).join(', ')} from ${aliases.source}, so ` +
        "this project's absolute imports resolve instead of collecting a suppression.",
    );
  }
  aliases.skipped.forEach(({ name, reason }) => {
    log.info(`Leaving ${name} out of the generated tsconfig: ${reason}.`);
  });
}
