# @obiemunoz/ts-migrate-plugins

*ts-migrate-plugins* is designed as a set of plugins, so that it can be pretty customizable for different use-cases.
This package contains a set of [codemods](https://medium.com/@cpojer/effective-javascript-codemods-5a6686bb46fb) (plugins), which are doing transformation of js/jsx -> ts/tsx.

> **This is a maintained fork of [airbnb/ts-migrate](https://github.com/airbnb/ts-migrate), updated for TypeScript 5 and 6.** Original work © 2020 Airbnb (MIT).

> Most users should start with [`@obiemunoz/ts-migrate`](https://www.npmjs.com/package/@obiemunoz/ts-migrate), the CLI that drives these plugins. Install this package directly only if you're composing a custom migration pipeline.

*ts-migrate-plugins* was originally designed around Airbnb projects. Use at your own risk.


# Install

Install *@obiemunoz/ts-migrate-plugins* using [npm](https://www.npmjs.com):

`npm install --save-dev @obiemunoz/ts-migrate-plugins`

Or [yarn](https://yarnpkg.com):

`yarn add --dev @obiemunoz/ts-migrate-plugins`


# Usage

```typescript
import path from 'path';
import { tsIgnorePlugin } from '@obiemunoz/ts-migrate-plugins';
import { migrate, MigrateConfig } from '@obiemunoz/ts-migrate-server';

// get input files folder
const inputDir = path.resolve(__dirname, 'input');

// create new migration config and add ts-ignore plugin with empty options
const config = new MigrateConfig().addPlugin(tsIgnorePlugin, {});

// run migration
const { exitCode } = await migrate({ rootDir: inputDir, config });

process.exit(exitCode);
```

# List of [plugins](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src)

| Name | Description |
| ---- | ----------- |
| [add-conversions](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/add-conversions.ts) | Add conversions to `any` (`$TSFixMe`) in the case of type errors. |
| [declare-missing-class-properties](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/declare-missing-class-properties.ts) | Declare missing class properties. |
| [eslint-fix](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/eslint-fix.ts) | Run eslint fix to fix any eslint violations that happened along the way. |
| [explicit-any](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/explicit-any.ts) | Annotate variables with `any` (`$TSFixMe`) in the case of an implicit any violation. |
| [hoist-arrow-functions](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/hoist-arrow-functions.ts) | Convert arrow functions that are referenced before their definition into hoisted function declarations. Arrow functions only used after their definition are left alone. |
| [hoist-class-statics](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/hoist-class-statics.ts) | Hoist static class members into the class body (vs. assigning them after the class definition). |
| [hoist-declarations](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/hoist-declarations.ts) | Move a top-level `const`/`let` above its first use when it is referenced before its definition and can't be converted into a hoisting function declaration (e.g. an HOC-wrapped component). Only relocates when it is provably safe. |
| [infer-types](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/infer-types.ts) | Annotate implicit anys with types TypeScript can infer from usage, so only the truly undeterminable ones fall through to explicit-any. |
| [jsdoc](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/jsdoc.ts) | Convert JSDoc @param types to TypeScript annotations. |
| [member-accessibility](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/member-accessibility.ts) | Add accessibility modifiers (private, protected, or public) to class members according to naming conventions. |
| [react-class-lifecycle-methods](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-class-lifecycle-methods.ts) | Annotate React lifecycle method types. |
| [react-class-state](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-class-state.ts) | Declare React state type. |
| [react-default-props](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-default-props.ts) | Annotate React default props. |
| [react-inline-imported-prop-types](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-inline-imported-prop-types.ts) | Copy propTypes objects imported from other modules into the file that assigns them (including spreads of them), carrying over the imports the copied text needs, so react-props converts them structurally like colocated propTypes. Runs before the other React plugins. |
| [react-props](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-props.ts) | Convert React prop types to TypeScript type. Imported propTypes objects that react-inline-imported-prop-types could not copy (non-relative modules, non-literal exports, references to module-local values) are typed with `InferProps<typeof importedPropTypes>` instead. |
| [react-shape](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-shape.ts) | Convert prop types shapes to TypeScript type. |
| [strip-ts-ignore](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/strip-ts-ignore.ts) | Strip `// @ts-ignore`. comments |
| [detect-types-packages](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/utils/typesPackages.ts) | Read-only. Classifies the diagnostics ts-ignore is about to suppress into `@types` package recommendations (missing, not loaded, outdated, or redundant), reported at the end of the run. Created per run with `createTypesPackageDetector()` and placed immediately before ts-ignore. |
| [ts-ignore](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/ts-ignore.ts) | Add `// @ts-ignore` comments for the remaining errors. |
| [update-import-paths](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/update-import-paths.ts) | Re-point relative imports that still say `./foo.js`/`./foo.jsx` after the file was renamed to `.ts`/`.tsx`. Drops the extension by default; keeps a `.js` extension in ESM packages (`"type": "module"`) or with `{ extension: 'js' }`. Imports whose target still exists on disk are left alone. |

## What infer-types annotations mean

The function body is the source of truth for its contract. Call-site evidence
is used only where it contradicts nothing; it never overrides what the body
does:

- Body evidence wins conflicts. `greet(name) { return name.toUpperCase(); }`
  is annotated `name: string` no matter what callers pass; an improper
  `greet(42)` becomes a type error that ts-ignore flags at the call site.
- Harmless call-site evidence is kept. `logId(id) { console.log(id); }` called
  only with numbers infers `id: number`; a setter infers its parameter from
  consistent assignments.
- Contradictory or missing evidence falls back to `any` (`$TSFixMe`). Call
  sites that disagree with each other on an unconstrained body, or a body
  TypeScript cannot express a type for (`a + b` with mixed callers), get no
  annotation rather than an arbitrary or suppression-generating one. The
  plugin never introduces suppressions inside a function body.
- Members with no evidence are spelled `any`, not the empty object type or a
  bottom array type. TypeScript prints a member it knows nothing about as `{}`
  (banned by `@typescript-eslint/no-empty-object-type`) and an empty array
  literal as `never[]` (`undefined[]` without strictNullChecks), which would
  reject every element later added; `initialState = { settings: {},
  items: [] }` infers `settings: any` and `items: any[]`. A genuine
  `undefined[]` inferred from real undefined elements under strictNullChecks
  is kept. An annotation that reduces entirely to `any` this way is dropped
  and left to explicit-any, as usual.
- A signature can still be narrower than everything the function could handle
  at runtime (`half(n) { return n / 2; }` infers `number` even though a
  numeric string would not crash), and callers the program cannot see
  (consumers of a published library) contribute no evidence.


# Type of plugins

We have two main categories of plugins:

- Text based plugins. Plugins of this category are operating with a text of source files and operate based on this.  Example: [example-plugin-text](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-example/src/example-plugin-text.ts).

- TypeScript ast-based plugins. The main idea behind these plugins is by parsing Abstract Syntax Tree with [TypeScript compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API), we can generate an array of updates for the text and apply them to the source file. Example: [example-plugin-ts](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-example/src/example-plugin-ts.ts).


# FAQ

> What is a ts-migrate plugin?

The unit of work in the migration pipeline. A plugin gets a file (its text, a parsed `ts.SourceFile`, and a lazily-created language service for the questions that need type information) and returns the new text of the file. The interface is small on purpose:

```typescript
interface Plugin {
  name: string
  run(params: PluginParams<TPluginOptions = {}>): Promise<string | void> | string | void
}

interface PluginParams<TPluginOptions = {}> {
  options: TPluginOptions;
  fileName: string;
  rootDir: string;
  text: string;
  sourceFile: ts.SourceFile;
  getLanguageService: () => ts.LanguageService;
}
```

> How do I write my own plugin?

Start with the [example plugins](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-example/src), which show the text-based and AST-based approaches side by side, then read the [real plugins](https://github.com/ObieMunoz/ts-migrate/tree/master/packages/ts-migrate-plugins/src/plugins) in this package. My advice: prefer computing text updates from AST node positions over regenerating whole files, since splices preserve the formatting of everything you didn't touch.

> Didn't these plugins use jscodeshift?

They did, and honestly that was one of the first things I regretted keeping. The jscodeshift plugins parsed with a babel config frozen around 2018 syntax, so they'd fail on newer JavaScript (class static blocks, for example) or quietly drop type annotations during reprinting. Every plugin now works off the TypeScript AST or plain text splices, so there's exactly one parser involved: the same one that compiles your code. The jscodeshift dependency is gone entirely.

> Why does eslint-fix use my project's ESLint instead of bundling one?

Because the point of that step is to make the migrated code pass *your* lint setup, and only your ESLint install knows your plugins, parser, and rule set. It auto-detects flat versus legacy configs (ESLint 9 included). The flip side: if your config can't parse TypeScript yet, the plugin can't fix those files. It warns once and leaves them unchanged rather than guessing.

> I have an issue with a specific plugin, what should I do?

Please file an [issue](https://github.com/ObieMunoz/ts-migrate/issues/new) with the smallest input file that reproduces it. Transform bugs get regression tests here, so a good reproduction usually stays fixed for good.


# Contributing

See the [Contributors Guide](https://github.com/ObieMunoz/ts-migrate/blob/master/CONTRIBUTING.md).
