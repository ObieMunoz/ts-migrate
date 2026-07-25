import fs from 'fs';
import path from 'path';
import log from 'updatable-log';
import ts from 'typescript';
import { BundlerDetection } from './bundler';

/** A mapping the project declares and this cannot translate. */
export interface SkippedAlias {
  /** How the project names it, e.g. `resolve.alias "@"`. */
  name: string;
  reason: string;
}

export interface PathAliases {
  /** rootDir-relative, forward slashes. */
  baseUrl?: string;
  /** Keys sorted, values rootDir-relative with forward slashes. */
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
    // eslint-disable-next-line no-bitwise
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
  return relative === '' ? '.' : relative.split(path.sep).join('/');
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
 * The `paths` entries one alias needs. A directory answers both the alias
 * itself and everything under it, which is what webpack matches; a file
 * answers only itself, with the extension dropped so the compiler can pick
 * the migrated one.
 */
function aliasEntries(key: string, relative: string, isDirectory: boolean): [string, string[]][] {
  // A trailing $ is webpack's exact-match marker.
  if (key.endsWith('$')) return [[key.slice(0, -1), [relative]]];
  if (!isDirectory) return [[key, [relative.replace(CODE_EXTENSION_REGEX, '')]]];
  return [
    [key, [relative]],
    [`${key}/*`, [`${relative}/*`]],
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
 * Without a baseUrl the compiler reads a `paths` value from the tsconfig and
 * rejects one that is not written as a relative path (TS5090).
 */
function relativeToConfig(paths: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(paths).map(([pattern, values]) => [
      pattern,
      values.map((value) =>
        value.startsWith('.') || path.isAbsolute(value) ? value : `./${value}`,
      ),
    ]),
  );
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
    let text: string;
    try {
      text = fs.readFileSync(path.join(rootDir, file), 'utf-8');
    } catch {
      return;
    }
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
  if (moduleDirectories.length === 1 && Object.keys(paths).length === 0) {
    return { baseUrl: moduleDirectories[0], source, skipped };
  }
  // No baseUrl beside them: a bare specifier no pattern answers then falls
  // through to node_modules, which is the order webpack resolves in.
  if (moduleDirectories.length > 0) {
    paths['*'] = moduleDirectories.map((directory) => `${directory}/*`);
  }
  if (Object.keys(paths).length === 0) {
    return skipped.length > 0 ? { source, skipped } : null;
  }
  return { paths: relativeToConfig(sortPaths(paths)), source, skipped };
}

/**
 * The `baseUrl` and `paths` a project already wrote for its editor. A
 * jsconfig.json is the project saying what its absolute imports mean, so it
 * needs no interpretation; entries whose target is gone are still left out.
 */
function jsConfigAliases(rootDir: string): PathAliases | null {
  const file = path.join(rootDir, 'jsconfig.json');
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
  const { config, error } = ts.parseConfigFileTextToJson(file, text);
  if (error || typeof config !== 'object' || config === null) return null;
  const compilerOptions = (config as { compilerOptions?: unknown }).compilerOptions;
  if (typeof compilerOptions !== 'object' || compilerOptions === null) return null;
  const { baseUrl, paths } = compilerOptions as { baseUrl?: unknown; paths?: unknown };

  const skipped: SkippedAlias[] = [];
  const result: PathAliases = { source: 'jsconfig.json', skipped };
  if (typeof baseUrl === 'string') {
    const relative = insideRoot(rootDir, path.resolve(rootDir, baseUrl));
    if (relative === null) {
      skipped.push({ name: 'baseUrl', reason: `${baseUrl} is outside the migration root` });
    } else if (!statOf(path.resolve(rootDir, relative))?.isDirectory()) {
      skipped.push({ name: 'baseUrl', reason: `${baseUrl} is not a directory` });
    } else {
      result.baseUrl = relative;
    }
  }
  if (typeof paths === 'object' && paths !== null) {
    const kept: Record<string, string[]> = {};
    Object.entries(paths as Record<string, unknown>).forEach(([pattern, values]) => {
      if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) return;
      // paths are read from baseUrl when there is one, so the check is too.
      const from = path.resolve(rootDir, result.baseUrl ?? '.');
      const missing = (values as string[]).filter((value) => !targetExists(from, value));
      if (missing.length > 0) {
        skipped.push({
          name: `paths "${pattern}"`,
          reason: `${missing.join(', ')} does not exist`,
        });
        return;
      }
      kept[pattern] = values as string[];
    });
    if (Object.keys(kept).length > 0) {
      const sorted = sortPaths(kept);
      result.paths = result.baseUrl === undefined ? relativeToConfig(sorted) : sorted;
    }
  }
  if (result.baseUrl === undefined && result.paths === undefined && skipped.length === 0) {
    return null;
  }
  return result;
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
  if (fromJsConfig && (fromJsConfig.baseUrl !== undefined || fromJsConfig.paths !== undefined)) {
    return fromJsConfig;
  }
  const fromWebpack = bundler?.name === 'webpack' ? webpackAliases(rootDir) : null;
  return fromWebpack ?? fromJsConfig;
}

function describe(aliases: PathAliases): string {
  const parts: string[] = [];
  if (aliases.baseUrl !== undefined) parts.push(`"baseUrl": "${aliases.baseUrl}"`);
  if (aliases.paths !== undefined) {
    parts.push(`"paths" for ${Object.keys(aliases.paths).join(', ')}`);
  }
  return parts.join(' and ');
}

/** The tsconfig fields, rendered for the generated config. */
export function renderPathAliases(aliases: PathAliases): string {
  const fields: string[] = [];
  if (aliases.baseUrl !== undefined) fields.push(`    "baseUrl": "${aliases.baseUrl}",`);
  if (aliases.paths !== undefined) {
    const entries = Object.entries(aliases.paths).map(
      ([pattern, values]) =>
        `      "${pattern}": [${values.map((value) => `"${value}"`).join(', ')}]`,
    );
    fields.push(`    "paths": {\n${entries.join(',\n')}\n    },`);
  }
  if (fields.length === 0) return '';
  return `
    // Absolute imports this project resolves through ${aliases.source}, which
    // the compiler resolves only from here.
${fields.join('\n')}`;
}

export function logPathAliases(aliases: PathAliases): void {
  const mapped = describe(aliases);
  if (mapped) {
    log.info(
      `Read ${mapped} from ${aliases.source}, so this project's absolute imports resolve ` +
        'instead of collecting a suppression.',
    );
  }
  aliases.skipped.forEach(({ name, reason }) => {
    log.info(`Leaving ${name} out of the generated tsconfig: ${reason}.`);
  });
}
