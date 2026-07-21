# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.10.4](https://github.com/ObieMunoz/ts-migrate/compare/v0.10.3...v0.10.4) (2026-07-21)

**Note:** Version bump only for package @obiemunoz/ts-migrate-server





## [0.10.3](https://github.com/ObieMunoz/ts-migrate/compare/v0.10.2...v0.10.3) (2026-07-11)

### Bug Fixes

- keep migration output consistent with the project's own tsc check ([#56](https://github.com/ObieMunoz/ts-migrate/issues/56)) ([4d3adf7](https://github.com/ObieMunoz/ts-migrate/commit/4d3adf72db7da1eef64aa3427688a97a358eeb07))

## [0.10.2](https://github.com/ObieMunoz/ts-migrate/compare/v0.10.1...v0.10.2) (2026-07-11)

### Performance Improvements

- parallelize eslint-fix across an adaptive worker thread pool ([#52](https://github.com/ObieMunoz/ts-migrate/issues/52)) ([8a923e3](https://github.com/ObieMunoz/ts-migrate/commit/8a923e31170ba1e372be9321337da93c8460730b))

## [0.10.1](https://github.com/ObieMunoz/ts-migrate/compare/v0.10.0...v0.10.1) (2026-07-11)

**Note:** Version bump only for package @obiemunoz/ts-migrate-server

# [0.10.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.9.2...v0.10.0) (2026-07-11)

**Note:** Version bump only for package @obiemunoz/ts-migrate-server

## [0.9.1](https://github.com/ObieMunoz/ts-migrate/compare/v0.9.0...v0.9.1) (2026-07-11)

### Performance Improvements

- **ts-migrate:** share module resolution caches and memoized fs across programs ([#46](https://github.com/ObieMunoz/ts-migrate/issues/46)) ([ff643cf](https://github.com/ObieMunoz/ts-migrate/commit/ff643cfd056f78e00770a833498997b948ba66a6))

# [0.9.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.8.0...v0.9.0) (2026-07-10)

**Note:** Version bump only for package @obiemunoz/ts-migrate-server

# [0.8.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.6.0...v0.8.0) (2026-07-10)

### Bug Fixes

- **ts-migrate:** keep stale build output from failing prepack with TS5055 ([#40](https://github.com/ObieMunoz/ts-migrate/issues/40)) ([1476e46](https://github.com/ObieMunoz/ts-migrate/commit/1476e46f17920ac40a8f88a3db35374477646be7))

# [0.7.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.6.0...v0.7.0) (2026-07-10)

**Note:** Version bump only for package @obiemunoz/ts-migrate-server

# [0.6.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.5.1...v0.6.0) (2026-07-10)

### Performance Improvements

- run ts-ignore against one warm program via mutationsPreserveTypes ([#24](https://github.com/ObieMunoz/ts-migrate/issues/24)) ([af8cfe9](https://github.com/ObieMunoz/ts-migrate/commit/af8cfe998262529708e2878a83ca4a9ebdbabf30))

## [0.5.1](https://github.com/ObieMunoz/ts-migrate/compare/v0.5.0...v0.5.1) (2026-07-10)

### Performance Improvements

- speed up infer-types 3.5-5x with shared caches and incremental passes ([#22](https://github.com/ObieMunoz/ts-migrate/issues/22)) ([1ee81c2](https://github.com/ObieMunoz/ts-migrate/commit/1ee81c2f95cec9f501ca5e9c27caac0b20e65bf8))

# [0.5.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.4.0...v0.5.0) (2026-07-09)

### Features

- **plugins:** infer types from usage before falling back to any ([#19](https://github.com/ObieMunoz/ts-migrate/issues/19)) ([5dd7f0f](https://github.com/ObieMunoz/ts-migrate/commit/5dd7f0f77c9e28371018197f65a11e61530b89f1))

# [0.4.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.3.0...v0.4.0) (2026-07-09)

### Bug Fixes

- harden migration against JS edge cases ([eb94833](https://github.com/ObieMunoz/ts-migrate/commit/eb94833bdb483a6a3a04021dbc7a92686dcf7b23))

# [0.3.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.2.5...v0.3.0) (2026-07-08)

### Bug Fixes

- **tests:** set explicit rootDir for ts-jest so 6.0 doesn't emit TS5011 ([368c9c6](https://github.com/ObieMunoz/ts-migrate/commit/368c9c63bf8c8c1c97cc5fc5622c81d95bad4b85))

### Features

- support TypeScript 6.x ([6a05fa5](https://github.com/ObieMunoz/ts-migrate/commit/6a05fa5714eaeb57a8c17ae95c754a46dc738328))

## [0.2.3](https://github.com/ObieMunoz/ts-migrate/compare/v0.2.2...v0.2.3) (2026-07-08)

### Bug Fixes

- **cli:** resolve bundled CLI from ts-migrate-full.sh's own location; docs: correct npx usage ([8ec6349](https://github.com/ObieMunoz/ts-migrate/commit/8ec6349bbfbcdd5836fbf616be53c480bad9b3f2))
- **server:** parse projects with the host TypeScript instance ([add8b01](https://github.com/ObieMunoz/ts-migrate/commit/add8b01785236c653e67aaca39ecaa25f93e0139))

## [0.2.2](https://github.com/ObieMunoz/ts-migrate/compare/v0.2.1...v0.2.2) (2026-07-08)

### Bug Fixes

- **deps:** cap the typescript peer dependency below 6 ([aebcc70](https://github.com/ObieMunoz/ts-migrate/commit/aebcc70b83973d8f31f629f2985ffc117d9bc177))

## [0.2.1](https://github.com/ObieMunoz/ts-migrate/compare/v0.2.0...v0.2.1) (2026-07-08)

**Note:** Version bump only for package @obiemunoz/ts-migrate-server
