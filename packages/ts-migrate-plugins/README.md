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
| [infer-types](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/infer-types.ts) | Annotate implicit anys with types TypeScript can infer from usage, so only the truly undeterminable ones fall through to explicit-any. |
| [jsdoc](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/jsdoc.ts) | Convert JSDoc @param types to TypeScript annotations. |
| [member-accessibility](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/member-accessibility.ts) | Add accessibility modifiers (private, protected, or public) to class members according to naming conventions. |
| [react-class-lifecycle-methods](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-class-lifecycle-methods.ts) | Annotate React lifecycle method types. |
| [react-class-state](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-class-state.ts) | Declare React state type. |
| [react-default-props](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-default-props.ts) | Annotate React default props. |
| [react-props](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-props.ts) | Convert React prop types to TypeScript type. |
| [react-shape](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-shape.ts) | Convert prop types shapes to TypeScript type. |
| [strip-ts-ignore](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/strip-ts-ignore.ts) | Strip `// @ts-ignore`. comments |
| [ts-ignore](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/ts-ignore.ts) | Add `// @ts-ignore` comments for the remaining errors. |

## What infer-types annotations mean

Inferred types describe *observed* usage — evidence from the function body
(operations on a parameter) combined with evidence from every call site the
program can see — not author intent. Keep in mind when reviewing a migration
diff:

- A signature can be narrower than what the function handles at runtime.
  `add(a, b) { return a + b; }` called only with numbers infers `number`; a
  future string caller has to widen it.
- Conflicting evidence is not silently unioned away. When call sites disagree
  with each other, the dominant type wins and outlier call sites keep their
  type errors (`logId(42)` plus `logId({ … })` infers `number`, and ts-ignore
  flags the object call). When call sites conflict with what the body can
  support, the union wins and the error surfaces inside the body (`add(1, 2)`
  plus `add(1, '2')` infers `string | number` and ts-ignore flags the mixed
  `+`). Treat suppression comments in and around freshly annotated functions
  as review signals — they mark real looseness that a plain `any` would hide.
- Usage that is consistently wrong is indistinguishable from intent, and
  callers the program cannot see (e.g. consumers of a published library)
  contribute no evidence, so exported APIs narrow to in-repo usage.


# Type of plugins

We have three main categories of plugins:

- Text based plugins. Plugins of this category are operating with a text of source files and operate based on this.  Example: [example-plugin-text](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-example/src/example-plugin-text.ts).

- Jscodeshift based plugins. These plugins are using a [jscodeshift toolkit](https://github.com/facebook/jscodeshift) as a base for operations and transformations around Abstract Syntax Tree. Example: [example-plugin-jscodeshift](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-example/src/example-plugin-jscodeshift.ts).

- TypeScript ast-based plugins. The main idea behind these plugins is by parsing Abstract Syntax Tree with [TypeScript compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API), we can generate an array of updates for the text and apply them to the source file. Example: [example-plugin-ts](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-example/src/example-plugin-ts.ts).


# FAQ

> What is the ts-migrate plugin?

The plugin is an abstraction around codemods which provides centralized interfaces for the *ts-migrate*. Plugins should implement the following interface:

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


> How I can write my own plugin?

You can take a look into the [plugin examples](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-example/src).
For more information, please check the [plugins implementation](https://github.com/ObieMunoz/ts-migrate/tree/master/packages/ts-migrate-plugins/src/plugins) for the *ts-migrate*.


> I have an issue with a specific plugin, what should I do?

Please file an [issue here](https://github.com/ObieMunoz/ts-migrate/issues/new).


# Contributing

See the [Contributors Guide](https://github.com/ObieMunoz/ts-migrate/blob/master/CONTRIBUTING.md).
