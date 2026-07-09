# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

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
