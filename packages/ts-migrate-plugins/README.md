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
| [add-conversions](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/add-conversions.ts) | Add conversions to `any` (`$TSFixMe`) in the case of type errors. Two kinds of site take a type the checker can name instead. An implicit-any element access is keyed by `keyof typeof obj` where that assertion still checks, keeping the element's value type. And a member access that failed on a jest mock method (`mockReturnValue`, `mockImplementation`, and the rest) is cast to `jest.Mock`, since a test that replaces a module reads its exports as mock functions while the checker resolves the import to the real declaration; the mock method stays checked instead of the whole access being suppressed. The member name is the only evidence used, so an automocked module read through a local alias is covered as well as a `jest.mock` factory assigning `jest.fn()`. Falls back to the any cast where the assertion would not compile: without `@types/jest` there is no `jest` namespace to name, a project on `@jest/globals` has `jest` as a value only, and `Mock` does not overlap an export that is a plain object or a function carrying properties of its own the way node's `setTimeout` does. |
| [collect-global-assignments](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/utils/globalDeclarations.ts) | Read-only. Records every `window.x`, `global.x` and `globalThis.x` in the project, written or read, at any nesting depth. A read is the only evidence there is of a global a third-party script tag sets and nothing in the project assigns, and every read of an undeclared property is an error whether or not the code assigns it too. Skips a property the environment already declares, and a use whose root an enclosing scope binds (an IIFE parameter named `window`, a local named `global`), since those properties are not globals. Created per run with `createGlobalDeclarations()` together with declare-globals. |
| [convert-commonjs](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/convert-commonjs.ts) | Rewrite top level `require` and `module.exports` into TypeScript module syntax, so imports carry types across files instead of `any`. Emits the interop pair `import x = require('m')` / `export = x` by default, and named exports (`import { a } from 'm'`, `export const a`) where a named import has to reach them. `{ esm: true }` forces `import x from 'm'` / `export default`, which is also what a file already using ESM gets; a `.cts`/`.cjs` file is CommonJS whatever its package says or its syntax already looks like. Dynamic, conditional and non top level forms are left alone. A file whose exports it cannot convert keeps them and is marked at the first assignment (see "Follow-up markers"). |
| [declare-empty-object-properties](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/declare-empty-object-properties.ts) | Type the accumulator idiom `const cache = {}; cache.total = 1;` from the values assigned to it, so one optional-property annotation replaces the cast add-conversions writes at every access site. Covers the same idiom on a class property, `foo = {}` written through `this.foo.x`, an instance or the class for a static, and on a `let` whose value arrives later, `let cache; cache = {};`, which reports only under `noImplicitAny`. Identifier and string-literal keys only; computed keys fall through. A value the checker types `any`, or one of the spellings it uses where it found nothing (`never[]`, `{}`, `null`), takes the any alias. The annotation is re-checked against the file and dropped when it introduces an error the file did not already have. Properties a class never declares belong to declare-missing-class-properties, which runs earlier, builds the same property list for the ones a constructor assigns the literal to, and writes no initializer, so the two never type the same property. |
| [declare-globals](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/utils/globalDeclarations.ts) | Writes what collect-global-assignments found to `types/ts-migrate-globals.d.ts` as one `declare global` block: an `interface Window` member per property used through `window`, a `var` for the ones used through `global` or `globalThis`. A property whose name is a reserved word keeps its cast when it is used that way, since no `var` can be declared with that name. A property's type comes from its assigned expressions only where they say what they are, unioned across the project, and is the any alias otherwise. A read never contributes a type, only the property: it says the property is expected to exist and nothing about what it holds, so a property the code only reads gets the any alias and one the assignments typed keeps that type. Placed before add-conversions, so those sites resolve instead of taking a cast. The file is rewritten from its own declarations each run, keeping a type that was narrowed by hand; a file at that path it cannot read back is never overwritten. |
| [declare-missing-class-properties](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/declare-missing-class-properties.ts) | Declare missing class properties. A declaration is left bare where the checker types it from the constructor assignments; a property the constructor assigns an empty object literal to is declared as the list of the keys written on it, `cache: { total?: number }`, the same annotation declare-empty-object-properties writes for the same idiom on a property that was declared. Anything else takes the any alias, and so does a declaration that introduces an error the file did not already have. |
| [eslint-fix](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/eslint-fix.ts) | Run eslint fix to fix any eslint violations that happened along the way. |
| [explicit-any](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/explicit-any.ts) | Annotate variables with `any` (`$TSFixMe`) in the case of an implicit any violation. |
| [hoist-arrow-functions](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/hoist-arrow-functions.ts) | Convert arrow functions that are referenced before their definition into hoisted function declarations. Arrow functions only used after their definition are left alone. |
| [hoist-class-statics](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/hoist-class-statics.ts) | Hoist static class members into the class body (vs. assigning them after the class definition). |
| [hoist-declarations](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/hoist-declarations.ts) | Move a top-level `const`/`let` above its first use when it is referenced before its definition and can't be converted into a hoisting function declaration (e.g. an HOC-wrapped component). Only relocates when it is provably safe. |
| [infer-types](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/infer-types.ts) | Annotate implicit anys with types TypeScript can infer from usage, so only the truly undeterminable ones fall through to explicit-any. |
| [jsdoc](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/jsdoc.ts) | Convert JSDoc types to TypeScript annotations: `@param`, `@type` on variables and class properties, `@template` on signatures and classes, and, with `{ annotateReturns: true }`, `@returns`. A `@type` written on a parenthesized expression is a cast, which the checker reads only in a JavaScript file, so it becomes `(expr as T)` and the comment goes; a cast that is assigned to, or that `delete` takes, keeps its comment and is marked (see "Follow-up markers"). `@typedef` and `@callback` become type aliases, exported when the file is a module. Type parameters written on a class or a type alias are given an `any` default, so a reference that passes no type arguments keeps working. A tag that cannot be converted, because the name is qualified or the file already declares it, keeps its comment, is marked, and its references are annotated with `any`. A converted name that resolves to nothing is written anyway and reported at the end of the run, grouped by name (see the suppression report in the CLI docs). |
| [member-accessibility](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/member-accessibility.ts) | Add accessibility modifiers (private, protected, or public) to class members according to naming conventions. |
| [optional-parameters](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/optional-parameters.ts) | Mark a parameter optional where the project already calls the function without it, so a parameter that was optional in JavaScript is not made required by the migration. The evidence is the calls themselves, gathered across the whole project because they are rarely in the file that declares the function: a parameter is marked only from the position the fewest arguments any call passes, and only when re-checking the declaring file reports no new error. Overloads, binding patterns (which TypeScript refuses to make optional), and functions declared outside the project are left alone. |
| [react-class-lifecycle-methods](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-class-lifecycle-methods.ts) | Annotate React lifecycle method types. |
| [react-class-state](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-class-state.ts) | Declare React state type. |
| [react-default-props](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-default-props.ts) | Annotate React default props. With `{ modernizeDefaultProps: true }`, a function component's defaults move into its props destructuring instead, the defaulted props become optional, and the assignment is deleted (see "Function component defaultProps" below). Class components and the components that cannot be converted are typed instead: with `{ useDefaultPropsHelper: true }` through a `WithDefaultProps` helper type generated into each migrated file, otherwise through a `Props & typeof defaultProps` intersection. Defaults assigned inline onto a function declaration are read as `(typeof Component)["defaultProps"]`, which does not depend on the assignment sitting above the generated type. A component declared on a `const` takes its own type from that initializer, so its inline defaults are moved into a `const` of their own above it and read as `typeof ComponentDefaultProps` instead, or left untyped when moving them would put them above a binding they read. |
| [react-destructured-props](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-destructured-props.ts) | Name the props of a function component that destructures them and has no propTypes, which react-props skips and explicit-any would annotate as one `any` over the whole pattern. Emits an all-optional `Props` type from the destructured keys and types the members from single-file evidence only. |
| [react-forwarded-props](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-forwarded-props.ts) | Widen the props of a function component that spreads a rest element onto another element, so the props of that element are part of its own: `({ name, ...rest }: Props) => <Icon {...rest} />` becomes `Props & Omit<Partial<React.ComponentProps<typeof Icon>>, 'name'>`. propTypes describe what a component reads, not what it passes on, so without this every forwarded prop is rejected at every call site. The forwarded half is `Partial`, since the component supplies some of those props itself, and omits what the pattern binds, so a prop the component declares keeps its own type instead of intersecting with the target's. Only a rest element spread onto a single element is evidence; the widening is written only when re-checking the file with it in place reports no new error. |
| [react-hook-types](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-hook-types.ts) | Write the type argument a React hook call needs when its initializer infers nothing useful: `useState(null)`, `useState(undefined)`, `useState([])`, `useState({})`, `useRef(null)`, and `createContext` called with `null`, with `undefined` or with no argument at all. Only calls an existing error blames are touched. `useState` reads the arguments its setter is called with in the same file, `useRef` reads the intrinsic tag its ref is attached to, `createContext` reads the `value` prop of the Providers in the same file; an argument the checker types `any` is not evidence. A `createContext` type argument keeps the default value in the union, and a call written with no argument takes the `undefined` it already passes at runtime. The proposed argument is written only when re-checking the file with it in place reports no new error, and everything else takes `any` (`$TSFixMe`). |
| [react-inline-imported-prop-types](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-inline-imported-prop-types.ts) | Copy propTypes objects imported from other modules into the file that assigns them (including spreads of them), carrying over the imports the copied text needs, so react-props converts them structurally like colocated propTypes. Runs before the other React plugins. |
| [react-passed-props](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-passed-props.ts) | Declare the props a component is passed but does not say it takes, so a prop callers have always handed it does not cost a suppression at every call site. propTypes describe what a component validates, not everything it is given, and JSX in JavaScript checks neither. The evidence is the project's own JSX, gathered across the whole project because it is rarely in the file that declares the component: a prop is added only where the props type has no member of that name, typed from what the call sites pass (a literal attribute from the syntax, everything else through the shared type printer, `any` where nothing prints), and only when re-checking the declaring file reports no new error. Each prop is proven on its own, so a component that forwards its rest onto an element with a stricter idea of one of them keeps the others. Wrappers that pass props on (`memo`, `forwardRef`, a `connect()` application) are followed to the component underneath. `any` props types, index signatures, components with no props annotation, and `key`/`ref` are left alone. |
| [react-props](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-props.ts) | Convert React prop types to TypeScript type. Imported propTypes objects that react-inline-imported-prop-types could not copy (non-relative modules, non-literal exports, references to module-local values) are typed with `InferProps<typeof importedPropTypes>` instead. |
| [react-props-from-usage](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-props-from-usage.ts) | Infer a class component's `Props` type from usage when it has no `propTypes` to convert. Gathers evidence from JSX call sites across the project (via `findReferences`) and from `this.props` reads in the class body, then emits a generated props type. Best-effort — review the output. Runs right after react-props to fill the components it left untyped. See ["react-props-from-usage: inferring props from usage"](#react-props-from-usage-inferring-props-from-usage) below. |
| [react-read-props](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-read-props.ts) | Declare the props a component reads but does not say it takes, so a prop that only ever arrives through a spread, a wrapper or a container does not cost a suppression at every read of it. propTypes describe what callers are expected to pass, and a prop passed by spreading an object is never checked against them, so the props type built from them has no member for it. The reads are the evidence the prop exists; a prop is declared only where the project also proves a type for it: the value a call site passes, the member of an object a call site spreads, the element the component spreads it onto (`Partial<React.ComponentProps<typeof Icon>>`), or the parameter it is handed to. A prop whose type nothing proves keeps its suppression rather than being declared `any`: an `any` member invents a contract every future call site is held to and gives up the excess-property error those call sites report today, while the suppression withdraws itself (`TS2578`) the day something declares the prop. Reaches `this.props` reads, `props.x` reads, the names a parameter pattern binds, and a component typed on its variable as `React.FC<Props>`. Each prop is proven on its own against the declaring file, as react-passed-props does. A read TypeScript has a near-miss suggestion for (`TS2551`) is left alone: a name one letter off a declared one is a typo, and declaring it would bury the defect. `any` props types, index signatures, components with no props annotation, and functions the project renders nowhere are left alone. |
| [react-shape](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/react-shape.ts) | Convert prop types shapes to TypeScript type. |
| [relax-parameter-shapes](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/relax-parameter-shapes.ts) | Relax an object type written inline on a parameter to the shape the project's own calls support. A shape inferred from one function body is a guess about every caller, and the callers are in other files, so each disagreement costs a suppression at the call site. A member no argument carries becomes optional, a member whose type the arguments contradict becomes `any` (`$TSFixMe`), and a shape whose last required member the calls refute is dropped for `any`, since a type of nothing but optional members rejects an argument sharing no property with it and would trade one error for another. Evidence is gathered across the whole project; overloads, declarations with no body, and functions declared outside the project are left alone, and a relaxation the declaring file gains a new error from is dropped. |
| [retry-conversions](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/retry-conversions.ts) | Reconsider the `as any` assertions add-conversions inserted, once `@types` have landed or a neighboring directory has been migrated. Each one is dropped and the file re-checked; the ones the file still needs are then retyped to the tightest type the checker can name for them, so `f(raw as any)` reads `f(raw as Opts)`. Only the tool's own output is in scope: `as any`, and an assertion to a type alias declared as `any`. See "What retry-conversions will and will not write" below. |
| [strip-ts-ignore](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/strip-ts-ignore.ts) | Strip `// @ts-ignore`. comments |
| [detect-types-packages](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/utils/typesPackages.ts) | Read-only. Classifies the diagnostics ts-ignore is about to suppress into `@types` package recommendations (missing, not loaded, outdated, or redundant), reported at the end of the run. Created per run with `createTypesPackageDetector()` and placed immediately before ts-ignore. |
| [ts-ignore](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/ts-ignore.ts) | Add `// @ts-ignore` comments for the remaining errors. A diagnostic inside a multiline string, template, or comment cannot take one, so the statement around it is marked instead (see "Follow-up markers"). A value that is imported with `import type` and then used as a value (`TS1361`) is repaired rather than suppressed: the `type` modifier is dropped, since a type-only import is erased when TypeScript emits and suppressing the use would leave the value undefined at run time. See ["Values imported as types"](#values-imported-as-types) below. |
| [update-import-paths](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-plugins/src/plugins/update-import-paths.ts) | Re-point imports that still say `./foo.js`/`./foo.jsx` after the file was renamed to `.ts`/`.tsx`. Drops the extension by default; keeps a `.js` extension in ESM packages (`"type": "module"`) or with `{ extension: 'js' }`. A `.cts`/`.cjs` file keeps the extensionless form even there: it emits `.cjs`, which is CommonJS whatever the package says. Imports whose target still exists on disk are left alone. Absolute imports the project maps through tsconfig `paths`, like `selectors/Address.js`, are re-pointed using the project's own module resolution; one the tsconfig cannot resolve is left alone. |
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
visible to the plugin.

Every assignment the plugin keeps gets a follow-up marker above it (see below).

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

## Follow-up markers

A plugin that recognizes something and leaves it for a person writes a comment
at the site, naming what to do and why it was left, so the work is in the file
it has to happen in rather than in a run log that scrolls past:

```jsx
// TODO(ts-migrate): React 19 ignores defaultProps on function components. Convert to
// destructured parameter defaults by hand.
// Left defaultProps in place: a default value is not a literal.
Chip.defaultProps = { tone: TONE };
```

`grep -rn "TODO(ts-migrate)"` is the worklist. The plugins that write them:

| Plugin | Marked when |
| --- | --- |
| react-default-props | A function component's `defaultProps` cannot be moved into the props destructuring, so React 19 ignores it. |
| jsdoc | A `@type` cast, a `@template` on an unnamed class, or a `@typedef`/`@callback` stays a comment. |
| convert-commonjs | A file's `module.exports`/`exports.<name>` cannot become ES module exports. |
| ts-ignore | A diagnostic inside a multiline string, template, or comment cannot take a suppression comment. |

A marker goes above the whole statement, above its doc comment when it has one,
and never where a line comment would run into code beside it. Re-running does
not stack them: a site already carrying one is left as it is, and still
reported, since the work is outstanding either way. One site gets one marker
however many causes land on it.

The end of the run prints how many files and causes there were, and
`--jsonSummary` records them under `pluginNotices`. A cause with nowhere to
write a marker, such as a diagnostic that falls inside a comment, is reported
with `"marked": false` and the run leaves the `grep` line off.

## Values imported as types

A migrated file can end up importing a function as a type and then calling it:

```ts
import type { connect } from 'react-redux';

// @ts-expect-error TS(1361): 'connect' cannot be used as a value because it was...
export default connect(mapStateToProps, mapDispatchToProps)(CqTag);
```

That suppression is worse than the error it hides. A type-only import is erased
when TypeScript emits, so the file compiles and then throws for an undefined
binding at run time. `ts-ignore` therefore repairs `TS1361` instead of
suppressing it, by dropping the `type` modifier the way TypeScript's own
"Remove 'type' from import declaration" fix does. A name that has no value to
import is a different diagnostic (`TS2693`, with no such fix) and is still
suppressed.

No plugin writes `import type`. What does is the project's own lint config,
which `eslint-fix` runs inside the migration:
`@typescript-eslint/consistent-type-imports` rewrites a value import as
type-only when it cannot see a value use, and older versions of that rule miss
uses that a current one keeps. Nothing in a migration can stop the project's
rule from firing, so the repair runs after it.

A project migrated before this landed still has the suppressions, and
`ts-migrate reignore <folder>` clears them: the old comments are stripped, the
imports are repaired, and only the diagnostics that are still real are
suppressed again. `grep -rn "TS(1361)"` finds the files first.

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
- A type TypeScript cannot print costs that one annotation, not the file.
  The compiler produces a file's annotations as a single edit, and asserts
  while printing some inferred types (a React component with both a props
  type and `propTypes` is one). The plugin then asks for them one position
  at a time, writes the ones that come back, and the run reports at the end
  that the file got fewer types than it asked for.

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
  would need its type arguments spelled out, `any`, `unknown`, `never`,
  `void`, and a union wider than `maxUnionMembers` all leave the error for
  ts-ignore. A confidently wrong annotation type checks everywhere and
  misleads; the error it replaced was at least visible.
- `void` is refused wherever it appears, in a union as much as on its own.
  It reaches an annotation from an abstract method stub that throws, which
  types as `void` unless its `@returns` is written out, so a member assigned
  from one would read `string | void`. Nothing but `undefined` is assignable
  to `void`, so that member is harder to use than it was before it was
  widened and says something about the declaration that is not true. A
  declaration that can really be missing gets `| undefined`, which stays
  printable.
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
  (#238, re-run once `void` was refused), 20 of the 22 widenings written were
  on declarations other files can see; they removed 35 suppressions in the
  files they changed and added 4 in files they did not. All 4 are in one
  webpack consumer and trace to `/** @type {EXPECTED_ANY} */ (null)` in the
  file the widening changed: the cast stops working when the file is renamed
  (#273) and the type it names is not one the published package ships, so the
  compiler reads a real null and the widening records it. Skipping those
  declarations instead left 28 more suppressions than widening them. On
  JavaScript typed with JSDoc the split is not a tail: every `@typedef`
  becomes an exported type, so every member a widening can reach is one other
  files can see.

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
  shape, a generic that would need its type arguments spelled out, `void`,
  and a union wider than four members are all refused and the site keeps its
  `any`. `void` is refused here on the contextual type: dropping null and
  undefined from an operand typed `void` already leaves `never`, which the
  printer refuses too.
- A narrowing is kept only when the re-checked file has no error it did not
  already have and the expression the assertion covers is no longer `any`. The
  second condition is not redundant: a printed name can resolve to a different
  declaration in the scope it is written into, and landing back on `any`
  produces no error to fail on. A narrowing that does not prove out is
  discarded and the assertion is restored byte for byte.
- Nothing here reads a user written `as SomeType`. The population is the tool's
  own output: `as any`, and an assertion to a type alias the project declares
  as `any`, resolved through the checker rather than matched by name. The
  `jest.Mock` assertion add-conversions writes for a mocked module export is
  therefore left alone as well: it names a type, so it is not debt to retry.

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


## react-props-from-usage: inferring props from usage

`react-props` can only convert a component that has a `propTypes` static. When
a class component has none, it is left with a missing/`any`/empty props type.
`react-props-from-usage` fills that gap by inferring the `Props` type from how
the component is actually used, and runs immediately after `react-props` in the
`reactProps` pipeline so it only touches the components `react-props` left
untyped.

It gathers evidence from two sources and merges them into a generated
`type <Name>Props = { ... }` alias (named `Props` for a single component, or
`${ComponentName}Props` when a file has several):

- **JSX call sites** across the project, discovered with the language service's
  `findReferences`. Attribute values contribute types: `name="x"` → `string`,
  `count={expr}` → the checker's type of `expr`, boolean shorthand
  `<Foo disabled />` → `boolean`. A prop present at every call site is
  required; one present at only some is optional (`?`).
- **`this.props` reads** in the class body (`this.props.x`,
  `const { a, b } = this.props`). These register prop names the component
  relies on even when no visible call site passes them, and optional-access
  patterns (`this.props.x?.`, default destructuring `{ x = 5 }`) hint at
  optionality.

Observed literals are always widened to their base type (`"sm"` → `string`,
`42` → `number`, `true` → `boolean`), and genuinely differing base types are
unioned (`string | number`). When no usable type can be resolved, the prop
falls back to `any` (honoring `anyAlias`). Missing imports for referenced prop
types are injected automatically.

Options:

| Option | Default | Meaning |
| --- | --- | --- |
| `includeChildren` | `true` | Add `children?: React.ReactNode` when children are used. |
| `defaultOptional` | `false` | Treat all inferred props as optional. |
| `skipOnSpread` | `true` | Bail out of a component whose call sites use `{...spread}` attributes (props can't be enumerated). |
| `useThisPropsUsage` | `true` | Include `this.props` body analysis as an evidence source. |
| `anyAlias` / `anyFunctionAlias` | — | Shared alias handling for `any` fallbacks. |

This is **best-effort inference — review the output.** Because it reasons from
observed usage rather than a declared contract, it can only see call sites in
the analyzed source set (consumers in other repos contribute nothing), it skips
components used only through spreads or HOC wrappers, and a prop the component
reads dynamically (`this.props[key]`) can't be enumerated. A component with no
usages and no `this.props` reads is left untouched.


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

Because the point of that step is to make the migrated code pass *your* lint setup, and only your ESLint install knows your plugins, parser, and rule set. It auto-detects flat versus legacy configs (ESLint 9 included). The flip side: if your config can't parse TypeScript yet, the plugin can't fix those files. It warns once and leaves them unchanged rather than guessing. A config whose rules undo one another's fixes gets the same treatment, since there is no fixed point to stop at: fixing is capped at ten rounds per file, and a file still changing at the cap keeps the text it came in with and tells you which of your rules to look at. Unless your config is type-aware (`parserOptions.project`/`projectService`, which would multiply TypeScript's memory use per thread), fixes spread across a worker pool once there is enough lint work to repay spinning it up — set `TS_MIGRATE_ESLINT_FIX_WORKERS` to force a pool size, or `0` to always lint in-process. Output from inside ESLint is routed too: typescript-estree's banner about an unsupported TypeScript version collapses to one line naming both versions, and anything else a rule or parser prints still reaches you, just not drawn over the progress counter.

> I have an issue with a specific plugin, what should I do?

Please file an [issue](https://github.com/ObieMunoz/ts-migrate/issues/new) with the smallest input file that reproduces it. Transform bugs get regression tests here, so a good reproduction usually stays fixed for good.


# Contributing

See the [Contributors Guide](https://github.com/ObieMunoz/ts-migrate/blob/master/CONTRIBUTING.md).
