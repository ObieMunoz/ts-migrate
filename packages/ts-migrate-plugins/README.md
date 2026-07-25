# @obiemunoz/ts-migrate-plugins

*ts-migrate-plugins* is designed as a set of plugins, so that it can be pretty customizable for different use-cases.
This package contains a set of [codemods](https://medium.com/@cpojer/effective-javascript-codemods-5a6686bb46fb) (plugins), which are doing transformation of js/jsx -> ts/tsx.

> **This is a maintained fork of [airbnb/ts-migrate](https://github.com/airbnb/ts-migrate), updated for TypeScript 5 and 6.** Original work © 2020 Airbnb (MIT).

> Most users should start with [`@obiemunoz/ts-migrate`](https://www.npmjs.com/package/@obiemunoz/ts-migrate), the CLI that drives these plugins. Install this package directly only if you're composing a custom migration pipeline.

*ts-migrate-plugins* was originally designed around Airbnb projects. Use at your own risk.


# Install

Install *@obiemunoz/ts-migrate-plugins* using [npm](https://www.npmjs.com):

`npm install --save-dev @obiemunoz/ts-migrate-plugins`

Or [pnpm](https://pnpm.io):

`pnpm add -D @obiemunoz/ts-migrate-plugins`


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
| [collect-global-assignments](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/utils/globalDeclarations.ts) | Read-only. Records every `window.x = ...`, `global.x = ...` and `globalThis.x = ...` in the project, at any nesting depth. Skips a property the environment already declares, and an assignment whose root an enclosing scope binds (an IIFE parameter named `window`, a local named `global`), since those properties are not globals. Created per run with `createGlobalDeclarations()` together with declare-globals. |
| [convert-commonjs](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/convert-commonjs.ts) | Rewrite top level `require` and `module.exports` into TypeScript module syntax, so imports carry types across files instead of `any`. Emits the interop pair `import x = require('m')` / `export = x` by default, and named exports (`import { a } from 'm'`, `export const a`) where a named import has to reach them. `{ esm: true }` forces `import x from 'm'` / `export default`, which is also what a file already using ESM gets; a `.cts`/`.cjs` file is CommonJS whatever its package says or its syntax already looks like. Dynamic, conditional and non top level forms are left alone. |
| [declare-empty-object-properties](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/declare-empty-object-properties.ts) | Type the accumulator idiom `const cache = {}; cache.total = 1;` from the values assigned to it, so one optional-property annotation replaces the cast add-conversions writes at every access site. Covers the same idiom on a class property, `foo = {}` written through `this.foo.x`, an instance or the class for a static, and on a `let` whose value arrives later, `let cache; cache = {};`, which reports only under `noImplicitAny`. Identifier and string-literal keys only; computed keys fall through. A value the checker types `any`, or one of the spellings it uses where it found nothing (`never[]`, `{}`, `null`), takes the any alias. The annotation is re-checked against the file and dropped when it introduces an error the file did not already have. Properties a class never declares belong to declare-missing-class-properties, which runs earlier, builds the same property list for the ones a constructor assigns the literal to, and writes no initializer, so the two never type the same property. |
| [declare-globals](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/utils/globalDeclarations.ts) | Writes what collect-global-assignments found to `types/ts-migrate-globals.d.ts` as one `declare global` block: an `interface Window` member per property assigned through `window`, a `var` for the ones assigned through `global` or `globalThis`. A property's type comes from its assigned expressions only where they say what they are, unioned across the project, and is the any alias otherwise. Placed before add-conversions, so those sites resolve instead of taking a cast. The file is rewritten from its own declarations each run, keeping a type that was narrowed by hand; a file at that path it cannot read back is never overwritten. |
| [declare-missing-class-properties](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/declare-missing-class-properties.ts) | Declare missing class properties. A declaration is left bare where the checker types it from the constructor assignments; a property the constructor assigns an empty object literal to is declared as the list of the keys written on it, `cache: { total?: number }`, the same annotation declare-empty-object-properties writes for the same idiom on a property that was declared. Anything else takes the any alias, and so does a declaration that introduces an error the file did not already have. |
| [eslint-fix](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/eslint-fix.ts) | Run eslint fix to fix any eslint violations that happened along the way. |
| [explicit-any](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/explicit-any.ts) | Annotate variables with `any` (`$TSFixMe`) in the case of an implicit any violation. |
| [hoist-arrow-functions](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/hoist-arrow-functions.ts) | Convert arrow functions that are referenced before their definition into hoisted function declarations. Arrow functions only used after their definition are left alone. |
| [hoist-class-statics](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/hoist-class-statics.ts) | Hoist static class members into the class body (vs. assigning them after the class definition). |
| [hoist-declarations](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/hoist-declarations.ts) | Move a top-level `const`/`let` above its first use when it is referenced before its definition and can't be converted into a hoisting function declaration (e.g. an HOC-wrapped component). Only relocates when it is provably safe. |
| [infer-types](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/infer-types.ts) | Annotate implicit anys with types TypeScript can infer from usage, so only the truly undeterminable ones fall through to explicit-any. |
| [jsdoc](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/jsdoc.ts) | Convert JSDoc types to TypeScript annotations: `@param`, `@type` on variables and class properties, `@template` on signatures and classes, and, with `{ annotateReturns: true }`, `@returns`. `@typedef` and `@callback` become type aliases, exported when the file is a module. Type parameters written on a class or a type alias are given an `any` default, so a reference that passes no type arguments keeps working. A tag that cannot be converted, because the name is qualified or the file already declares it, keeps its comment and its references are annotated with `any`. A converted name that resolves to nothing is written anyway and reported at the end of the run, grouped by name (see the suppression report in the CLI docs). |
| [member-accessibility](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/member-accessibility.ts) | Add accessibility modifiers (private, protected, or public) to class members according to naming conventions. |
| [react-class-lifecycle-methods](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-class-lifecycle-methods.ts) | Annotate React lifecycle method types. |
| [react-class-state](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-class-state.ts) | Declare React state type. |
| [react-default-props](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-default-props.ts) | Annotate React default props. With `{ modernizeDefaultProps: true }`, a function component's defaults move into its props destructuring instead, the defaulted props become optional, and the assignment is deleted (see "Function component defaultProps" below). Class components and the components that cannot be converted are typed instead: with `{ useDefaultPropsHelper: true }` through a `WithDefaultProps` helper type generated into each migrated file, otherwise through a `Props & typeof defaultProps` intersection. Defaults assigned inline onto a function declaration are read as `(typeof Component)["defaultProps"]`, which does not depend on the assignment sitting above the generated type. A component declared on a `const` takes its own type from that initializer, so its inline defaults are moved into a `const` of their own above it and read as `typeof ComponentDefaultProps` instead, or left untyped when moving them would put them above a binding they read. |
| [react-destructured-props](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-destructured-props.ts) | Name the props of a function component that destructures them and has no propTypes, which react-props skips and explicit-any would annotate as one `any` over the whole pattern. Emits an all-optional `Props` type from the destructured keys and types the members from single-file evidence only. |
| [react-hook-types](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-hook-types.ts) | Write the type argument a React hook call needs when its initializer infers nothing useful: `useState(null)`, `useState(undefined)`, `useState([])`, `useState({})`, `useRef(null)`, and `createContext` called with `null`, with `undefined` or with no argument at all. Only calls an existing error blames are touched. `useState` reads the arguments its setter is called with in the same file, `useRef` reads the intrinsic tag its ref is attached to, `createContext` reads the `value` prop of the Providers in the same file; an argument the checker types `any` is not evidence. A `createContext` type argument keeps the default value in the union, and a call written with no argument takes the `undefined` it already passes at runtime. The proposed argument is written only when re-checking the file with it in place reports no new error, and everything else takes `any` (`$TSFixMe`). |
| [react-inline-imported-prop-types](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-inline-imported-prop-types.ts) | Copy propTypes objects imported from other modules into the file that assigns them (including spreads of them), carrying over the imports the copied text needs, so react-props converts them structurally like colocated propTypes. Runs before the other React plugins. |
| [react-props](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-props.ts) | Convert React prop types to TypeScript type. Imported propTypes objects that react-inline-imported-prop-types could not copy (non-relative modules, non-literal exports, references to module-local values) are typed with `InferProps<typeof importedPropTypes>` instead. |
| [react-shape](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-shape.ts) | Convert prop types shapes to TypeScript type. |
| [retry-conversions](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/retry-conversions.ts) | Reconsider the `as any` assertions add-conversions inserted, once `@types` have landed or a neighboring directory has been migrated. Each one is dropped and the file re-checked; the ones the file still needs are then retyped to the tightest type the checker can name for them, so `f(raw as any)` reads `f(raw as Opts)`. Only the tool's own output is in scope: `as any`, and an assertion to a type alias declared as `any`. See "What retry-conversions will and will not write" below. |
| [strip-ts-ignore](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/strip-ts-ignore.ts) | Strip `// @ts-ignore`. comments |
| [detect-types-packages](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/utils/typesPackages.ts) | Read-only. Classifies the diagnostics ts-ignore is about to suppress into `@types` package recommendations (missing, not loaded, outdated, or redundant), reported at the end of the run. Created per run with `createTypesPackageDetector()` and placed immediately before ts-ignore. |
| [ts-ignore](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/ts-ignore.ts) | Add `// @ts-ignore` comments for the remaining errors. |
| [update-import-paths](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/update-import-paths.ts) | Re-point relative imports that still say `./foo.js`/`./foo.jsx` after the file was renamed to `.ts`/`.tsx`. Drops the extension by default; keeps a `.js` extension in ESM packages (`"type": "module"`) or with `{ extension: 'js' }`. A `.cts`/`.cjs` file keeps the extensionless form even there: it emits `.cjs`, which is CommonJS whatever the package says. Imports whose target still exists on disk are left alone. |
| [widen-annotations](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/widen-annotations.ts) | Union an annotation with the types the assignments in its own file give it, so `let x: number` later assigned null reads `number \| null` instead of taking a suppression. Covers variable, class property, interface member and return annotations; never parameters. `{ maxUnionMembers: n }` (default 4) caps how wide an annotation may get. |

## Function component defaultProps

React 18.3 warns on `defaultProps` for function components and React 19 ignores
it, so react-default-props rewrites

```jsx
function Button({ size, label }: Props) { ... }
Button.defaultProps = { size: 'md' };
```

into `function Button({ size = 'md', label }: Props)` with `size` optional in
`Props`, and deletes the assignment.

The two are the same for a prop that is omitted, passed as `undefined`, or
passed as `null`: React substitutes a default only for `undefined`, and so does
a default parameter. They are not the same for a value's identity, since a
default parameter is evaluated on every render, and not for anything that reads
the defaults through the element or off the component. A component is converted
only when all of the following hold, and keeps its assignment (and gets the
typing above) otherwise:

- Every default is a literal: a string, number, bigint, boolean, `null`,
  `undefined`, or a template with no substitutions. An object, array or
  function default would reach the component as a new value on every render
  where `defaultProps` shared one.
- The defaults are an object literal in the same file, either assigned inline or
  through a `const` that nothing else in the file reads.
- Nothing else in the file reads `Component.defaultProps`.
- The props parameter is destructured and binds every defaulted prop, so a
  defaulted prop cannot silently stop reaching a rest element.
- No defaulted prop already carries a different default.
- The props type is declared in full in the same file, as a type literal, a type
  alias to one, or an interface with no heritage clause, and it declares every
  defaulted prop.

Class components are left alone: `defaultProps` still works there in React 19.
A prop read through `React.createElement` results rather than through the
component, and a `Component.defaultProps` read from another file, are not
visible to the plugin; the assignments it keeps are reported at the end of the
run.

A kept assignment is typed by naming its defaults when the component is a
`const`:

```jsx
const Button = ({ size, onClick }: Props) => { ... }
Button.defaultProps = { size: 'md', onClick: () => {} };
```

becomes `const ButtonDefaultProps = { ... }` above the component, with
`Button.defaultProps = ButtonDefaultProps` and `typeof ButtonDefaultProps` in
the props type. Reading `typeof Button` there instead would be circular, since
`Button`'s type comes from the initializer the props type annotates.

The defaults move to where the props type goes, so they are named only when
everything they read is already initialized there: an import or a function
declaration anywhere in the file, or anything else declared above the
component. A component whose defaults read a name declared below it, including
a value under a function in the defaults, keeps its assignment untouched and
gets no defaults type, reported at the end of the run. Moving those defaults
would read a binding in its temporal dead zone, which is a `ReferenceError` at
module load rather than a type to fix later.

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

## What widen-annotations will and will not write

Same rule, one step later: the assignments a file makes are the truth about
what a declaration holds, and an annotation that contradicts them is the thing
that is wrong. `let x: number` assigned null becomes `number | null` rather
than a suppressed line.

- Nothing is written on the checker's word alone. Each widening is spliced
  into a copy of the file and kept only when the errors it was made for are
  gone and no new error appeared. A widening that only moves the problem, or
  that breaks a later use (`count * 2` once `count` can be null), is discarded
  and the annotation stays exactly as it was.
- Types are refused rather than guessed. A type that cannot be named without
  adding an import, an anonymous object or function shape, a generic that
  would need its type arguments spelled out, `any` and `unknown`, and a union
  wider than `maxUnionMembers` all leave the error for ts-ignore. A confidently
  wrong annotation type checks everywhere and misleads; the error it replaced
  was at least visible.
- Parameters are never widened, in either direction: not from a call that
  disagrees, and not from the body reassigning the parameter. That is the
  infer-types rule above, and widening here would undo it.
- A contradicting literal is unioned as its base type, so a `string` field that
  took `"a"` once reads `| string` and not `| "a"`.
- Widening a declaration other files can see (an exported interface member, a
  property of an exported class) tells them the truth about what it holds,
  which can turn consumers that assumed otherwise into errors of their own.
  Validation is per file and does not see those, the same way infer-types does
  not see the call sites it makes into errors. This is deliberate, and it is
  measured. Across 1759 files of webpack, ESLint, three.js and jira_clone
  (#238), 30 of the 32 widenings written were on declarations other files can
  see; they removed 45 suppressions in the files they changed and added 4 in
  files they did not. Skipping those declarations instead left 38 more
  suppressions than widening them. On JavaScript typed with JSDoc the split is
  not a tail: every `@typedef` becomes an exported type, so every member a
  widening can reach is one other files can see.

## What retry-conversions will and will not write

Removal comes first and a narrowing is only attempted where it failed, so an
assertion that can go entirely never gets retyped instead. The two never
compete for the same site.

- Two types are tried, in order: the operand's own type, and the type the
  position expects. The operand's type is what the checker already knows, so
  it claims the least; null and undefined are dropped from it, since an
  assertion the file still needs is one the code reads or passes the value
  through and the nullable union is what the removal just failed on.
  `(document.getElementById('root') as any).className` becomes
  `(document.getElementById('root') as HTMLElement).className`.
- The contextual type is tried second and is a claim rather than a
  restatement: `f(raw as Opts)` says the value is what `f` wants. It is sound
  only because converting between unrelated types is itself an error and the
  file is re-checked with the assertion in place.
- Types come from the same printer widen-annotations uses, so a type that
  cannot be named without adding an import, an anonymous object or function
  shape, a generic that would need its type arguments spelled out, and a union
  wider than four members are all refused and the site keeps its `any`.
- A narrowing is kept only when the re-checked file has no error it did not
  already have and the expression the assertion covers is no longer `any`. The
  second condition is not redundant: a printed name can resolve to a different
  declaration in the scope it is written into, and landing back on `any`
  produces no error to fail on. A narrowing that does not prove out is
  discarded and the assertion is restored byte for byte.
- Nothing here reads a user written `as SomeType`. The population is the tool's
  own output: `as any`, and an assertion to a type alias the project declares
  as `any`, resolved through the checker rather than matched by name.

## What react-destructured-props will and will not infer

A component's props come from its JSX call sites, and those are usually in
other files. This plugin reads one file at a time and checks its proposals
against a program built from that file alone, so it writes down only what the
file it is migrating proves:

- The prop names always come from the destructuring pattern. That is the
  component's own statement of what it reads, and TypeScript already treats it
  as a closed props type: a call site passing a prop the pattern never names is
  an error before this plugin runs as much as after. Naming the props keeps it
  that way instead of letting explicit-any widen the whole pattern to `any`.
- The default in the pattern types the prop it defaults. `({ start = 0 })`
  gives `start?: number`. A default of `null` or `undefined` proves nothing and
  the prop takes the any alias.
- A JSX attribute at a call site types a prop only for a component nothing
  outside the file can render, meaning every reference to it in the file is a
  JSX tag and the file does not export it. For an exported component an
  attribute seen here says nothing about the call sites elsewhere, so its props
  take the any alias.
- Evidence the checker resolves to `any` is discarded before anything is
  checked. `any` is assignable in both directions, so no later check would
  reject it and it would be written as if it had been proven.
- Call sites that disagree with each other, a spread attribute, and a prop read
  through a nested pattern all fall back to the any alias. A wrong prop type
  type-checks everywhere and misleads; the alias does not.
- Every member is optional, because whether a prop is always passed cannot be
  established from one file.
- A component whose pattern has a rest element is left alone. The props it
  forwards are not in the pattern, so no closed type describes them.
- Nothing is written unless the file already reports the pattern as untyped,
  and nothing is written that the file does not then still check clean. The
  props an error blames drop to the alias, and a file that fails even with
  every prop aliased is left as it was.


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

Because the point of that step is to make the migrated code pass *your* lint setup, and only your ESLint install knows your plugins, parser, and rule set. It auto-detects flat versus legacy configs (ESLint 9 included). The flip side: if your config can't parse TypeScript yet, the plugin can't fix those files. It warns once and leaves them unchanged rather than guessing. Unless your config is type-aware (`parserOptions.project`/`projectService`, which would multiply TypeScript's memory use per thread), fixes spread across a worker pool once there is enough lint work to repay spinning it up — set `TS_MIGRATE_ESLINT_FIX_WORKERS` to force a pool size, or `0` to always lint in-process.

> I have an issue with a specific plugin, what should I do?

Please file an [issue](https://github.com/ObieMunoz/ts-migrate/issues/new) with the smallest input file that reproduces it. Transform bugs get regression tests here, so a good reproduction usually stays fixed for good.


# Contributing

See the [Contributors Guide](https://github.com/ObieMunoz/ts-migrate/blob/master/CONTRIBUTING.md).
