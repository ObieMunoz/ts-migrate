# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.10.2](https://github.com/ObieMunoz/ts-migrate/compare/v0.10.1...v0.10.2) (2026-07-11)

### Bug Fixes

- use the ts-migrate bin name as the yargs scriptName ([#53](https://github.com/ObieMunoz/ts-migrate/issues/53)) ([1969aca](https://github.com/ObieMunoz/ts-migrate/commit/1969aca421d82f3e3fb0bf62958b3bfebac9ef08))

### Performance Improvements

- parallelize eslint-fix across an adaptive worker thread pool ([#52](https://github.com/ObieMunoz/ts-migrate/issues/52)) ([8a923e3](https://github.com/ObieMunoz/ts-migrate/commit/8a923e31170ba1e372be9321337da93c8460730b))

## [0.10.1](https://github.com/ObieMunoz/ts-migrate/compare/v0.10.0...v0.10.1) (2026-07-11)

**Note:** Version bump only for package ts-migrate

# [0.10.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.9.2...v0.10.0) (2026-07-11)

### Features

- **ts-migrate:** add agent playbook command and non-interactive ts-migrate-full flags ([#48](https://github.com/ObieMunoz/ts-migrate/issues/48)) ([9b9fc9a](https://github.com/ObieMunoz/ts-migrate/commit/9b9fc9adafae1558e1951f0f3bc93287d2d35122))

## [0.9.2](https://github.com/ObieMunoz/ts-migrate/compare/v0.9.1...v0.9.2) (2026-07-11)

### Bug Fixes

- **ts-migrate:** surface [@types](https://github.com/types) recommendations at the end of ts-migrate-full ([#47](https://github.com/ObieMunoz/ts-migrate/issues/47)) ([7d98851](https://github.com/ObieMunoz/ts-migrate/commit/7d98851103192ad18969b51301dfb24122059c68))

## [0.9.1](https://github.com/ObieMunoz/ts-migrate/compare/v0.9.0...v0.9.1) (2026-07-11)

### Performance Improvements

- **ts-migrate:** share module resolution caches and memoized fs across programs ([#46](https://github.com/ObieMunoz/ts-migrate/issues/46)) ([ff643cf](https://github.com/ObieMunoz/ts-migrate/commit/ff643cfd056f78e00770a833498997b948ba66a6))

# [0.9.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.8.0...v0.9.0) (2026-07-10)

### Bug Fixes

- **ts-migrate:** pick JSX transform from React version, check with esnext lib ([#44](https://github.com/ObieMunoz/ts-migrate/issues/44)) ([bab87b8](https://github.com/ObieMunoz/ts-migrate/commit/bab87b84c21f7ba69f7630953df5d2c51941b589))

### Features

- **ts-migrate:** recommend [@types](https://github.com/types) packages from migration diagnostics ([#45](https://github.com/ObieMunoz/ts-migrate/issues/45)) ([3acff75](https://github.com/ObieMunoz/ts-migrate/commit/3acff752adb43dd39f2bc7a6601961f0dba9f3f3))

# [0.8.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.6.0...v0.8.0) (2026-07-10)

### Bug Fixes

- **deps:** resolve all Dependabot advisories via resolutions (0 regressions) ([#33](https://github.com/ObieMunoz/ts-migrate/issues/33)) ([512c35e](https://github.com/ObieMunoz/ts-migrate/commit/512c35ef93a0876fff99fc5ceccb4b7565e94014))
- **example:** repair yarn example and smoke-test it in CI ([#36](https://github.com/ObieMunoz/ts-migrate/issues/36)) ([c44c417](https://github.com/ObieMunoz/ts-migrate/commit/c44c4172f99532ba43be2f6403a82f74de6d6ccc))
- **ts-migrate:** keep stale build output from failing prepack with TS5055 ([#40](https://github.com/ObieMunoz/ts-migrate/issues/40)) ([1476e46](https://github.com/ObieMunoz/ts-migrate/commit/1476e46f17920ac40a8f88a3db35374477646be7))

### Features

- **plugins:** add update-import-paths plugin for renamed .js/.jsx imports ([#37](https://github.com/ObieMunoz/ts-migrate/issues/37)) ([b80a69b](https://github.com/ObieMunoz/ts-migrate/commit/b80a69b6c2ef6237b0670fe05e688c1ef420019a))
- **ts-migrate-plugins:** convert imported propTypes objects (inline-into-consumer + InferProps fallback) ([#38](https://github.com/ObieMunoz/ts-migrate/issues/38)) ([a795d26](https://github.com/ObieMunoz/ts-migrate/commit/a795d26c411f3c311833bb1d093818d1f5375c4a))

### Performance Improvements

- **ci:** cache node_modules and consolidate test runs into one jest process ([#34](https://github.com/ObieMunoz/ts-migrate/issues/34)) ([44f2a5a](https://github.com/ObieMunoz/ts-migrate/commit/44f2a5a73e34b4779bd958fe4e61970e0377263c))
- **ts-migrate:** replace json5-writer with comment-preserving JSON5 text splices ([#35](https://github.com/ObieMunoz/ts-migrate/issues/35)) ([d6d6ef0](https://github.com/ObieMunoz/ts-migrate/commit/d6d6ef0586c170810f34e777a5e7228b5aee65a7))

# [0.7.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.6.0...v0.7.0) (2026-07-10)

### Bug Fixes

- **deps:** resolve all Dependabot advisories via resolutions (0 regressions) ([#33](https://github.com/ObieMunoz/ts-migrate/issues/33)) ([512c35e](https://github.com/ObieMunoz/ts-migrate/commit/512c35ef93a0876fff99fc5ceccb4b7565e94014))
- **example:** repair yarn example and smoke-test it in CI ([#36](https://github.com/ObieMunoz/ts-migrate/issues/36)) ([c44c417](https://github.com/ObieMunoz/ts-migrate/commit/c44c4172f99532ba43be2f6403a82f74de6d6ccc))

### Features

- **plugins:** add update-import-paths plugin for renamed .js/.jsx imports ([#37](https://github.com/ObieMunoz/ts-migrate/issues/37)) ([b80a69b](https://github.com/ObieMunoz/ts-migrate/commit/b80a69b6c2ef6237b0670fe05e688c1ef420019a))
- **ts-migrate-plugins:** convert imported propTypes objects (inline-into-consumer + InferProps fallback) ([#38](https://github.com/ObieMunoz/ts-migrate/issues/38)) ([a795d26](https://github.com/ObieMunoz/ts-migrate/commit/a795d26c411f3c311833bb1d093818d1f5375c4a))

### Performance Improvements

- **ci:** cache node_modules and consolidate test runs into one jest process ([#34](https://github.com/ObieMunoz/ts-migrate/issues/34)) ([44f2a5a](https://github.com/ObieMunoz/ts-migrate/commit/44f2a5a73e34b4779bd958fe4e61970e0377263c))
- **ts-migrate:** replace json5-writer with comment-preserving JSON5 text splices ([#35](https://github.com/ObieMunoz/ts-migrate/issues/35)) ([d6d6ef0](https://github.com/ObieMunoz/ts-migrate/commit/d6d6ef0586c170810f34e777a5e7228b5aee65a7))

# [0.6.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.5.1...v0.6.0) (2026-07-10)

### Bug Fixes

- **infer-types:** rewrite no-evidence {} and never[]/undefined[] inferences to any ([#29](https://github.com/ObieMunoz/ts-migrate/issues/29)) ([874b9ae](https://github.com/ObieMunoz/ts-migrate/commit/874b9ae8f96f6f32f85ffbf20ee039e5308a2f54))

### Features

- **plugins:** add hoist-declarations plugin for use-before-define consts ([#26](https://github.com/ObieMunoz/ts-migrate/issues/26)) ([1055667](https://github.com/ObieMunoz/ts-migrate/commit/1055667245ba363e50c7c699b9771092dd8f71b0))

### Performance Improvements

- cut redundant type-checks and suggestion scans in infer-types (up to 1.7x) ([#23](https://github.com/ObieMunoz/ts-migrate/issues/23)) ([753a2ab](https://github.com/ObieMunoz/ts-migrate/commit/753a2ab5db532d3e9046e20518af569126f2682f))
- run ts-ignore against one warm program via mutationsPreserveTypes ([#24](https://github.com/ObieMunoz/ts-migrate/issues/24)) ([af8cfe9](https://github.com/ObieMunoz/ts-migrate/commit/af8cfe998262529708e2878a83ca4a9ebdbabf30))
- single-pass reference scan in hoist-arrow-functions (up to 9.5x) ([#27](https://github.com/ObieMunoz/ts-migrate/issues/27)) ([6c3aa5c](https://github.com/ObieMunoz/ts-migrate/commit/6c3aa5c62484e2b3e9b573684ebce09bfd818fee))
- skip re-linting unchanged files in the second eslint-fix pass ([#25](https://github.com/ObieMunoz/ts-migrate/issues/25)) ([fce7e5c](https://github.com/ObieMunoz/ts-migrate/commit/fce7e5cbc297ab68310f7cfe27e9dad48c6a7f90))

## [0.5.1](https://github.com/ObieMunoz/ts-migrate/compare/v0.5.0...v0.5.1) (2026-07-10)

### Performance Improvements

- speed up infer-types 3.5-5x with shared caches and incremental passes ([#22](https://github.com/ObieMunoz/ts-migrate/issues/22)) ([1ee81c2](https://github.com/ObieMunoz/ts-migrate/commit/1ee81c2f95cec9f501ca5e9c27caac0b20e65bf8))

# [0.5.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.4.0...v0.5.0) (2026-07-09)

### Bug Fixes

- **plugins:** rewrite explicit-any and declare-missing-class-properties on the TypeScript AST ([#20](https://github.com/ObieMunoz/ts-migrate/issues/20)) ([adf8dcf](https://github.com/ObieMunoz/ts-migrate/commit/adf8dcf47beec976dcd4866c420a6b7d95f6b233))

### Features

- **plugins:** infer types from usage before falling back to any ([#19](https://github.com/ObieMunoz/ts-migrate/issues/19)) ([5dd7f0f](https://github.com/ObieMunoz/ts-migrate/commit/5dd7f0f77c9e28371018197f65a11e61530b89f1))

# [0.4.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.3.0...v0.4.0) (2026-07-09)

### Bug Fixes

- harden migration against JS edge cases ([eb94833](https://github.com/ObieMunoz/ts-migrate/commit/eb94833bdb483a6a3a04021dbc7a92686dcf7b23))
- **plugins:** use object instead of {} for prop-less class component props ([4d45cb3](https://github.com/ObieMunoz/ts-migrate/commit/4d45cb38aac35a87f4c0f415689f68dac4bc89d1))
- **tests:** make rename require('react') fixture props-free to satisfy react lint rules ([1cd3771](https://github.com/ObieMunoz/ts-migrate/commit/1cd3771a640ee32a2d6930168fa426dc5909882a))

### Features

- add hoist-arrow-functions plugin ([a755c29](https://github.com/ObieMunoz/ts-migrate/commit/a755c29ffb4412bec96a86c8a4f69cd13784ede5))

# [0.3.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.2.5...v0.3.0) (2026-07-08)

### Bug Fixes

- **tests:** set explicit rootDir for ts-jest so 6.0 doesn't emit TS5011 ([368c9c6](https://github.com/ObieMunoz/ts-migrate/commit/368c9c63bf8c8c1c97cc5fc5622c81d95bad4b85))

### Features

- support TypeScript 6.x ([6a05fa5](https://github.com/ObieMunoz/ts-migrate/commit/6a05fa5714eaeb57a8c17ae95c754a46dc738328))

## [0.2.5](https://github.com/ObieMunoz/ts-migrate/compare/v0.2.4...v0.2.5) (2026-07-08)

### Bug Fixes

- **hoist-class-statics:** indent hoisted statics to match class members ([e4846f4](https://github.com/ObieMunoz/ts-migrate/commit/e4846f40b3790e548bce2b819982de3ec2992704)), closes [airbnb/ts-migrate#120](https://github.com/airbnb/ts-migrate/issues/120)
- **jsdoc:** stop replaceNodes from swallowing $n in printed nodes ([51c4537](https://github.com/ObieMunoz/ts-migrate/commit/51c45379151a0eefc466820f7ac8af37b354c100))
- **plugins:** guard jscodeshift parse against strict-mode SyntaxErrors ([fa7cb9e](https://github.com/ObieMunoz/ts-migrate/commit/fa7cb9e3f6eb5db0f88632071f48dd725d39aca4)), closes [#63](https://github.com/ObieMunoz/ts-migrate/issues/63) [#153](https://github.com/ObieMunoz/ts-migrate/issues/153) [#153](https://github.com/ObieMunoz/ts-migrate/issues/153) [#63](https://github.com/ObieMunoz/ts-migrate/issues/63)
- **react-shape:** locate export keyword via AST, not substring ([fe9ffc2](https://github.com/ObieMunoz/ts-migrate/commit/fe9ffc25b1961ade4e2fbc56fe28f3a74fbf0ecb))

## [0.2.4](https://github.com/ObieMunoz/ts-migrate/compare/v0.2.3...v0.2.4) (2026-07-08)

### Bug Fixes

- **add-conversions:** hoist nested replacements to the outermost replaced range ([ec8dfe1](https://github.com/ObieMunoz/ts-migrate/commit/ec8dfe154ee946c3ae4dd466a182a7707c0dcea3))

## [0.2.3](https://github.com/ObieMunoz/ts-migrate/compare/v0.2.2...v0.2.3) (2026-07-08)

### Bug Fixes

- **cli:** resolve bundled CLI from ts-migrate-full.sh's own location; docs: correct npx usage ([8ec6349](https://github.com/ObieMunoz/ts-migrate/commit/8ec6349bbfbcdd5836fbf616be53c480bad9b3f2))
- **server:** parse projects with the host TypeScript instance ([add8b01](https://github.com/ObieMunoz/ts-migrate/commit/add8b01785236c653e67aaca39ecaa25f93e0139))

## [0.2.2](https://github.com/ObieMunoz/ts-migrate/compare/v0.2.1...v0.2.2) (2026-07-08)

### Bug Fixes

- **deps:** cap the typescript peer dependency below 6 ([aebcc70](https://github.com/ObieMunoz/ts-migrate/commit/aebcc70b83973d8f31f629f2985ffc117d9bc177))

## [0.2.1](https://github.com/ObieMunoz/ts-migrate/compare/v0.2.0...v0.2.1) (2026-07-08)

### Bug Fixes

- **plugins:** guard statement replacements against ASI merging ([b08e5ab](https://github.com/ObieMunoz/ts-migrate/commit/b08e5abb7abd34fc4c2ff33f0be91ce95a82fa40))
