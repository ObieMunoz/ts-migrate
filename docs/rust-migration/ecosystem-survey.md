# Rust/native ecosystem survey: what we reuse vs what we build

Surveyed July 2026. Conclusion up front: **we do not need to hand-build a
parser, a type checker, a linter, or a transform infrastructure.** The only
thing nobody ships is ts-migrate's actual value-add — the 14 migration
transforms and the orchestration engine. That is the part we write.

## Parsers (solved — reuse)

| Project | Status (mid-2026) | Fit for us |
| --- | --- | --- |
| **[oxc](https://github.com/oxc-project/oxc)** (`oxc_parser`, `oxc_ast`, `oxc_semantic`, `oxc_traverse`) | Production. Passes 100% of Test262 and ~99% of the TypeScript parser test suite; [3x faster than SWC, 5x faster than Biome's parser](https://github.com/oxc-project/bench-javascript-parser-written-in-rust). Oxlint 1.0 (built on it) is [stable since Aug 2025](https://voidzero.dev/posts/announcing-oxlint-1-stable) and used in production at Shopify, Airbnb, Mercedes-Benz. | **Primary choice.** Full TS + JSX, precise byte spans, semantic analysis (scopes/symbols/references), visitor infrastructure. Everything the syntax-only plugins need. |
| **[SWC](https://swc.rs)** | Mature, huge ecosystem (Next.js, jest transforms). | Fallback if oxc spans/trivia don't map well to how our plugins compute positions. |
| **[Biome](https://biomejs.dev)** parser | Production, but produces a **CST** (lossless, trivia-preserving) rather than an AST. | Interesting for the trivia-heavy plugins (`jsdoc`, `strip-ts-ignore`, `ts-ignore` all live in comments) — a CST makes comment manipulation natural. Worth a Phase 2 spike if oxc trivia handling gets awkward. |
| tree-sitter (`tree-sitter-typescript`) | Stable, error-tolerant. | Not needed — we don't require incremental or error-tolerant parsing; oxc is faster and gives real semantics. |

## Type checking (solved — sidecar, never build)

| Project | Status (mid-2026) | Fit |
| --- | --- | --- |
| **[TypeScript 7 / typescript-go](https://github.com/microsoft/typescript-go)** | **Release Candidate as of June 18, 2026**, GA expected within ~a month ([Visual Studio Magazine](https://visualstudiomagazine.com/articles/2026/06/22/typescript-7-0-rc-moves-microsofts-go-rewrite-into-the-mainline-compiler.aspx)). ~10x faster type-checking than 6.0. The RC ships as the standard `tsc` binary via `npm install -D typescript@rc`. Caveat: **no stable programmatic API until at least TS 7.1** — the LSP surface is the integration point for now. | **Default `DiagnosticsProvider` backend.** Native binary, same checker semantics as tsc. Precedent: [oxlint already drives tsgo for its type-aware rules](https://oxc.rs/) — exactly the architecture this plan proposes. |
| [stc](https://github.com/dudykr/stc) (Rust) | **Abandoned** (~mid-2024). | Confirms "don't build/adopt a Rust checker". |
| [Ezno](https://github.com/kaleidawave/ezno) (Rust) | Active research project; by its own README "does not currently support enough features to check existing projects". No longer integrated with oxc. | Not viable for diagnostic parity. Revisit in years, not phases. |

Implication for the plan: the checker sidecar speaks **LSP** (`tsgo --lsp` /
TS 7 `tsc` LSP mode) with in-memory document overlays, since the programmatic
API won't be stable before TS 7.1. When the 7.1 API lands, evaluate replacing
LSP with the API server for lower overhead.

## Linting (`eslint-fix` plugin)

| Project | Fit |
| --- | --- |
| Shell out to the project's own ESLint | **v1 answer** — the plugin's job is "apply the *user's* lint config", so their ESLint is the only correct implementation. |
| [Oxlint](https://oxc.rs/docs/guide/usage/linter.html) (`--fix`) | Optional future fast-path (50–100x faster than ESLint, 500+ rules, ESLint-compat focus) for users without an ESLint setup. Not a semantic match for arbitrary user configs, so opt-in only. |
| Biome | Same story as oxlint; more opinionated ruleset. |

## Codemod/transform infrastructure (replaces jscodeshift)

- `oxc_traverse` / `oxc_semantic` visitors + our ported `updateSourceText`
  splice engine cover what `jscodeshift` does for the two plugins that use it
  (`explicit-any`, `declare-missing-class-properties`). The codemod ecosystem
  is already building on oxc ([projects using oxc](https://oxc.rs/docs/guide/projects)).
- [ast-grep](https://ast-grep.github.io) (Rust, tree-sitter-based structural
  search/rewrite) — handy for prototyping transforms, but its pattern model
  doesn't reach type-driven edits; not a core dependency.

## What has no off-the-shelf answer (the actual work)

1. The 14 plugin transforms themselves (the domain logic).
2. The migration engine (`MigrationProject` in-memory overlay + plugin loop).
3. The tsc↔oxc **position-mapping conventions** (TS `getStart()` skips leading
   trivia; oxc spans are trivia-exclusive by default — need a verified mapping
   layer, exercised by the golden corpus).
4. The `DiagnosticsProvider` LSP client with overlay support.
5. JSON5 comment-preserving `tsconfig.json` editing for `init`
   (candidates: `json5format`; else splice-based editing like the rest of
   the tool).

## Sources

- [oxc — The JavaScript Oxidation Compiler](https://oxc.rs/)
- [oxc parser benchmark vs SWC vs Biome](https://github.com/oxc-project/bench-javascript-parser-written-in-rust)
- [Announcing Oxlint 1.0 (VoidZero)](https://voidzero.dev/posts/announcing-oxlint-1-stable)
- [microsoft/typescript-go](https://github.com/microsoft/typescript-go)
- [TypeScript 7.0 RC coverage (Visual Studio Magazine)](https://visualstudiomagazine.com/articles/2026/06/22/typescript-7-0-rc-moves-microsofts-go-rewrite-into-the-mainline-compiler.aspx)
- [Progress on TypeScript 7 — December 2025 (TypeScript blog)](https://devblogs.microsoft.com/typescript/progress-on-typescript-7-december-2025/)
- [Ezno checker preview](https://kaleidawave.github.io/posts/a-preview-of-the-checker/) / [kaleidawave/ezno](https://github.com/kaleidawave/ezno)
- [Oxc vs SWC comparison (PkgPulse)](https://www.pkgpulse.com/guides/oxc-vs-swc-rust-javascript-toolchain-2026)
