# Plugin inventory & porting classification

Classification of all 14 built-in plugins by what they depend on, which
determines porting order and difficulty. Dependency facts below were verified
against `packages/ts-migrate-plugins/src/plugins/` (grep for
`getLanguageService`/`getSemanticDiagnostics` and `jscodeshift` imports).

Legend — **Deps:** `AST` = walks the TypeScript AST only; `LS` = calls
`getLanguageService().getSemanticDiagnostics()` (needs a real type checker);
`jscodeshift` = uses jscodeshift for the transform; `eslint` = invokes ESLint.

## Tier 1 — syntax-only, port first (Phase 2)

| Plugin | Deps | What it does | Port notes |
| --- | --- | --- | --- |
| `strip-ts-ignore` | AST | Removes `@ts-ignore` comments | Pure comment/trivia scan; smallest plugin; good first target to validate trivia handling in oxc |
| `hoist-class-statics` | AST | Hoists `Class.staticProp = …` assignments into `static` class members | Straightforward visitor + splices |
| `member-accessibility` | AST | Adds `private`/`protected`/`public` modifiers by naming convention | Simple visitor; options via JSON schema |
| `jsdoc` | AST | Converts JSDoc annotations (`@param {string}`) into TS type annotations | Heaviest trivia consumer — needs full JSDoc comment parsing. oxc has JSDoc span info but not a full JSDoc type-expression parser; may need a small hand-rolled parser for `{type}` expressions. Watch this one |
| `react-class-state` | AST | Adds a `State` type for `this.state`/`setState` usage | React quartet shares helper utils; port utils once |
| `react-class-lifecycle-methods` | AST | Annotates React lifecycle method signatures | See above |
| `react-default-props` | AST | Types `defaultProps` patterns | See above |
| `react-shape` | AST | Converts `PropTypes.shape` to type aliases | Largest of the React set; recursive PropTypes→type translation |
| `react-props` | AST | Converts `PropTypes` declarations to a `Props` type | Depends on `react-shape` machinery |

## Tier 2 — type-checker-dependent (Phase 3, needs `DiagnosticsProvider`)

| Plugin | Deps | What it does | Port notes |
| --- | --- | --- | --- |
| `ts-ignore` | AST + LS | Inserts `@ts-expect-error` / `@ts-ignore` comments (with error text) above every current semantic error | Consumes diagnostic `code`, `start`, `messageText`. Message *text* goes into the inserted comment — the one place where tsc-vs-tsgo wording differences leak into output; needs a DIVERGENCES.md entry or `--message-source` option |
| `explicit-any` | AST + LS + jscodeshift | Adds `: any` where diagnostics report implicit-any (codes 2683, 7006, 7008, 7019, 7031) | jscodeshift transform must be re-expressed as an oxc visitor; diagnostic-driven positions |
| `declare-missing-class-properties` | AST + LS + jscodeshift | Declares class properties reported by diagnostic 2339-family | Same shape as `explicit-any` |
| `add-conversions` | AST + LS | Wraps expressions in `$TSFixMe` conversions to silence assignment errors | Diagnostic-driven splices; filters on diagnostic codes only (verified — no message-text dependence) |

## Tier 3 — external-tool plugins (Phase 4)

| Plugin | Deps | What it does | Port notes |
| --- | --- | --- | --- |
| `eslint-fix` | eslint | Runs ESLint `--fix` over the migrated text | Do **not** reimplement: shell out to the project's own ESLint via stdin/stdout so the user's config and rule versions apply. Degrade to no-op with a warning when ESLint isn't resolvable |

## Shared utilities to port

| Utility | Notes |
| --- | --- |
| `updateSourceText` | The edit-application contract (insert/replace/delete at byte offsets, stable sort by index, overlap verification). Port exactly; property-test against the TS implementation |
| `validateOptions` (JSON-schema) | Use `jsonschema`/`schemars` crates; keep error messages close to current `PluginOptionsError` format |
| `type-guards`, `isNotNull` | Trivial / disappear into Rust's type system |
| `PerfTimer` | Trivial (`std::time::Instant`) |

## Engine surface to port (`ts-migrate-server`)

- `MigrationProject`: in-memory file overlay + (in Rust) parse cache keyed by
  file version; diagnostics delegated to `DiagnosticsProvider`
- `migrate()` loop: per-plugin, per-file iteration; files updated in memory,
  written once at the end; `-1` exit code on any plugin error (preserve)
- `MigrateConfig`: ordered plugin pipeline with per-plugin options

## CLI surface to port (`ts-migrate`)

| Command | Notes |
| --- | --- |
| `init` | Writes/updates `tsconfig.json` (JSON5-aware via `json5-writer` — Rust needs comment-preserving JSON5 editing; check `json5format` crate or preserve-by-splice) |
| `rename` | `.js/.jsx → .ts/.tsx` with JSX detection; easiest command, Phase 1 |
| `migrate` | Full pipeline with the standard plugin ordering |
| `reignore` | Re-runs ts-ignore across the project; currently parallelized via a jest-runner hack (`create-jest-runner`) — replace with rayon |
