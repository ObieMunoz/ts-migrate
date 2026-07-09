# Rust Migration Plan for ts-migrate

Status: **Draft / proposal** — nothing in this document is implemented yet.
Owner: @ObieMunoz

This document plans a port of the ts-migrate monorepo from TypeScript/Node to
Rust. It covers the current architecture, the one hard constraint that shapes
the whole design, the proposed target architecture, a phased roadmap with exit
criteria, testing strategy, risks, and open questions.

A per-plugin porting classification lives in
[plugin-inventory.md](./plugin-inventory.md).

---

## 1. Why Rust

- **Startup + throughput.** ts-migrate runs over entire codebases, file by
  file, plugin by plugin. A native binary with parallel file processing
  (rayon) should cut wall-clock time dramatically for the syntax-only plugins
  and eliminate Node startup cost entirely.
- **Distribution.** A single static binary per platform (the
  esbuild/Biome-style npm wrapper pattern) removes the `node_modules` install
  step and the TypeScript peer-dependency matrix (`>=5.0 <7`) that this fork
  currently has to chase.
- **Longevity.** The Rust JS/TS tooling ecosystem (oxc, SWC, Biome) is mature
  for parsing and transformation, which is most of what ts-migrate does.

## 2. Current architecture (what we're porting)

Four packages, ~5.7k lines of non-test TypeScript:

| Package | Lines | Role |
| --- | --- | --- |
| `ts-migrate-server` | ~314 | Core engine: `MigrationProject` (in-memory project wrapping `ts.LanguageService`), `migrate()` loop that runs each plugin over each source file and writes results |
| `ts-migrate-plugins` | ~4,800 | 14 plugins + utils (`updateSourceText`, `validateOptions` JSON-schema validation) |
| `ts-migrate` | ~450 | CLI (yargs): `init`, `rename`, `migrate`, `reignore` (jest-runner-based parallel re-ignore) |
| `ts-migrate-example` | ~130 | Example/demo package |

Three properties of the design matter a lot for a port:

1. **Plugins are text-in/text-out.** A plugin receives
   `{ fileName, text, sourceFile, options, getLanguageService }` and returns a
   new string (or nothing). Edits are computed as position-based splices
   (`insert`/`replace`/`delete` at byte offsets) applied by
   `updateSourceText`. There is **no AST re-printing**, so a Rust port does
   not need a TS pretty-printer — it needs a parser whose node positions can
   be mapped to the same offsets.
2. **Four plugins need the real TypeScript type checker.** `ts-ignore`,
   `explicit-any`, `add-conversions`, and `declare-missing-class-properties`
   call `getLanguageService().getSemanticDiagnostics(fileName)` and key off
   specific diagnostic codes. No production-grade TypeScript type checker
   exists in Rust (stc is abandoned; Ezno is research-grade), and reimplementing
   one is out of scope. **The port must keep a real tsc-compatible checker in
   the loop.**
3. **The engine is stateful across plugins.** `MigrationProject` keeps updated
   file text in memory so that plugin N+1 sees plugin N's output, and
   diagnostics are recomputed incrementally. Whatever provides diagnostics in
   the Rust design must support in-memory (unsaved) file contents.

## 3. The central design decision: where do diagnostics come from?

Options considered:

| Option | Verdict |
| --- | --- |
| **A. `tsgo` (typescript-go, the native TS 7 compiler) as a sidecar process** | **Preferred.** Native binary, no Node runtime, same checker semantics as tsc going forward, actively developed by Microsoft. Drive it over its LSP interface (`textDocument/publishDiagnostics` with in-memory overlays) or its API server mode. |
| B. Node sidecar running `tsserver` (or a ~100-line helper script that loads `typescript` and emits diagnostics as JSON) | Fallback / compatibility mode. Keeps exact parity with whatever TS version the user has installed, at the cost of requiring Node. Cheap to build; useful during parity testing to diff A against B. |
| C. Reimplement the needed checks in Rust | Rejected. The diagnostic codes these plugins consume (2571, 7005, 7006, 2339, …) come from full type inference. This is a multi-year project on its own. |
| D. Wait for a Rust type checker | Rejected. Nothing production-ready exists or is on a credible timeline. |

**Proposal:** define a small internal `DiagnosticsProvider` trait; ship the
`tsgo` backend as the default and the Node-helper backend behind a flag.
Everything else in the system is pure Rust.

## 4. Target architecture

Cargo workspace living in this repo under `crates/` (same repo keeps the
golden-test corpus, issue history, and npm packages together during the
transition):

```
crates/
  ts-migrate-cli/       # clap-based CLI: init, rename, migrate, reignore
  ts-migrate-core/      # engine: project model, plugin loop, text-splice applier
  ts-migrate-plugins/   # built-in plugins as Rust implementations of a Plugin trait
  ts-migrate-diag/      # DiagnosticsProvider trait + tsgo/Node backends
  ts-migrate-testing/   # golden-corpus harness shared by all crates
```

Key choices:

- **Parser: oxc** (`oxc_parser` + `oxc_semantic` + `oxc_ast`). Fastest
  actively-developed Rust TS parser, precise byte spans, full TS + JSX
  support, comment/trivia access. SWC is the fallback if oxc span or trivia
  handling turns out to be a poor match for how plugins compute positions
  (see Risks).
- **Edit model: port `updateSourceText` exactly** — same
  insert/replace/delete records, same stable-sort-by-index semantics, same
  overlap verification. This is the contract that makes byte-for-byte parity
  testing possible.
- **Plugin trait** mirroring the TS interface:

  ```rust
  trait Plugin {
      fn name(&self) -> &str;
      fn validate(&self, options: &serde_json::Value) -> Result<(), OptionsError>;
      fn run(&self, params: PluginParams<'_>) -> Result<Option<String>, PluginError>;
  }
  ```

  `PluginParams` exposes the parsed oxc AST, source text, file name, options,
  and a lazy handle to the `DiagnosticsProvider`.
- **Parallelism:** the current engine is sequential per plugin. Syntax-only
  plugins are embarrassingly parallel across files (rayon). Checker-dependent
  plugins stay sequential per project (diagnostics depend on global state) but
  batch their diagnostic requests.
- **Distribution:** platform binaries published as npm
  `optionalDependencies` (`@obiemunoz/ts-migrate-{platform}`), plus a thin JS
  launcher so `npx ts-migrate` keeps working. GitHub Releases for direct
  download. Built via `cargo-dist` or a release workflow matrix.

### Explicit non-goals (v1)

- **Third-party JS plugin compatibility.** The npm `ts-migrate-server` API
  lets consumers pass arbitrary JS plugins; the Rust binary cannot load
  those. v1 ships the 14 built-in plugins only. If demand exists, a later
  version can add an external-plugin protocol (spawn a process, speak
  JSON-over-stdio with the same `PluginParams`/result shape). The npm
  packages remain published and maintained for programmatic users during the
  transition.
- Reimplementing ESLint or the TypeScript checker in Rust (`eslint-fix`
  shells out; diagnostics come from a sidecar — see plugin inventory).
- New features. The port is behavior-preserving; feature work continues on
  the TS packages until cutover.

## 5. Roadmap

Each phase has an exit criterion; a phase isn't done until its criterion is
verifiable in CI.

### Phase 0 — Freeze behavior, build the safety net
- Build a **golden corpus**: a set of fixture projects (seeded from the
  existing `tests/` fixtures in `ts-migrate-plugins` and
  `ts-migrate-server`, plus 2–3 realistic open-source JS codebases) with
  snapshotted output of the *current npm ts-migrate* for every plugin and
  every CLI command.
- Record a performance baseline (wall-clock per plugin on the corpus).
- **Exit:** `corpus run --impl=node` produces stable snapshots in CI.

### Phase 1 — Rust skeleton + non-parser commands
- Cargo workspace, clap CLI with all four subcommands stubbed.
- Port `updateSourceText` with property tests against the TS implementation.
- Port `rename` (`.js/.jsx → .ts/.tsx`, JSX detection) and `init`
  (tsconfig.json scaffolding, JSON5 handling).
- **Exit:** `rename` and `init` byte-identical to Node output on the corpus.

### Phase 2 — Syntax-only plugins on oxc
- Port the 8 checker-free plugins (see inventory), roughly easiest-first:
  `strip-ts-ignore`, `hoist-class-statics`, `member-accessibility`,
  `jsdoc`, then the four React plugins.
- This phase proves out the oxc↔TS position-mapping question early — if spans
  don't line up, we find out here, on the simplest plugins.
- **Exit:** each ported plugin passes golden tests byte-for-byte; corpus CI
  runs both implementations and diffs.

### Phase 3 — Diagnostics sidecar + checker-dependent plugins
- Implement `DiagnosticsProvider`: tsgo backend (LSP with in-memory
  overlays) and Node-helper backend.
- Port `ts-ignore`, `explicit-any`, `add-conversions`,
  `declare-missing-class-properties` (the last two also need their
  jscodeshift usage re-expressed as oxc visitors).
- Port `reignore` on top (it's the migrate engine with an ignore-only config,
  parallelized with rayon instead of the jest-runner hack).
- **Exit:** full `migrate` run on the corpus matches Node output; documented
  allowlist for any diagnostic-message-text differences between tsc and tsgo.

### Phase 4 — `eslint-fix`, polish, distribution
- `eslint-fix`: shell out to the project's own ESLint
  (`npx eslint --fix-dry-run --stdin`) rather than reimplementing rules;
  degrade gracefully when ESLint isn't installed.
- End-to-end `migrate` command with frontend config (plugin pipeline
  selection) matching current CLI flags.
- Binary releases + npm wrapper packages; README/docs updates.
- **Exit:** a user can `npx ts-migrate migrate .` and get the Rust binary
  with output matching v0.3.x, and a benchmark report vs the Phase 0
  baseline.

### Phase 5 — Burn-in and cutover
- Run both implementations side-by-side on real migrations; triage diffs.
- Mark npm TS packages as maintenance-mode; the CLI package's major bump
  ships the binary.

## 6. Testing strategy

- **Golden corpus is the contract.** Byte-for-byte output equality with the
  Node implementation is the default bar; any intentional divergence gets an
  entry in a `DIVERGENCES.md` with rationale.
- **Property tests** for `updateSourceText` (random edit sets applied by both
  implementations must agree).
- **Per-plugin unit fixtures** ported from the existing Jest tests
  (`packages/ts-migrate-plugins/tests`).
- **Cross-backend diffing** in Phase 3: tsgo backend vs Node backend on the
  same corpus, to isolate "Rust port bug" from "tsc vs tsgo difference".

## 7. Risks

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| **oxc spans don't map cleanly to TS AST positions** (TS `getStart()` skips leading trivia; plugins splice at exact offsets; `jsdoc` plugin reads comment trivia) | Medium | Phase 2 tackles this first on trivial plugins; build a small position-mapping test suite; fall back to SWC or to hand-rolled trivia scanning where needed |
| **tsgo diagnostics differ from tsc** (codes stable, message text / ordering may differ; tsgo still maturing) | Medium | `DiagnosticsProvider` abstraction + Node fallback backend; match on diagnostic *codes* not message text wherever possible (current `ts-ignore` puts message text into comments — those strings may legitimately differ; document in DIVERGENCES.md) |
| **jscodeshift semantics** in `declare-missing-class-properties` / `explicit-any` don't translate 1:1 to oxc visitors | Medium | These are last in the plugin queue; golden tests catch behavior drift |
| **Third-party plugin users broken** | Certain (by design) | Non-goal for v1; npm packages stay maintained; external-plugin protocol as future work |
| Scope creep / two implementations drifting during the (long) transition | Medium | Behavior freeze: feature PRs to TS packages must add corpus fixtures, which the Rust port must then match |

## 8. Open questions

1. **tsgo readiness** — validate early (Phase 0 spike) that tsgo's LSP
   supports unsaved-buffer diagnostics well enough for `MigrationProject`
   semantics. If not, the Node helper becomes the default and tsgo the flag.
2. **Repo layout** — this plan assumes `crates/` in this monorepo. A separate
   repo is cleaner for release automation but loses the shared corpus. Leaning
   same-repo.
3. **Naming/versioning** — does the Rust CLI ship as
   `@obiemunoz/ts-migrate@1.0` (major bump, binary under the hood) or as a new
   package name? Leaning major bump.
4. **`eslint-fix` long-term** — shell-out is the v1 answer; is dropping the
   plugin (in favor of telling users to run their own formatter) acceptable
   later?
