# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.12.1](https://github.com/ObieMunoz/ts-migrate/compare/v0.12.0...v0.12.1) (2026-07-24)


### Features

* **cli:** skip gitignored files by default ([#118](https://github.com/ObieMunoz/ts-migrate/issues/118)) ([9fa8a85](https://github.com/ObieMunoz/ts-migrate/commit/9fa8a8597487dfea3e10b0e5f9e3ed3328ed92c4))





# [0.12.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.11.1...v0.12.0) (2026-07-24)


### Bug Fixes

* **cli:** declare hidden migrate flags and generate the anyAlias ambient declaration ([#100](https://github.com/ObieMunoz/ts-migrate/issues/100)) ([618af08](https://github.com/ObieMunoz/ts-migrate/commit/618af08d56ebe2d3f29e6b7e24277e382779d8ee))
* **react-default-props:** emit a self-contained WithDefaultProps helper ([#102](https://github.com/ObieMunoz/ts-migrate/issues/102)) ([51e7677](https://github.com/ObieMunoz/ts-migrate/commit/51e7677917eb08fce9bcdf889312d479698ffd06))


### Features

* **cli:** add --dry-run to rename, migrate, and reignore ([#111](https://github.com/ObieMunoz/ts-migrate/issues/111)) ([25dfc68](https://github.com/ObieMunoz/ts-migrate/commit/25dfc68fb5fa8b6edaa9febf96bb9d657b9fb3fc))
* **cli:** add repeatable --exclude-plugin for the default pipeline ([#94](https://github.com/ObieMunoz/ts-migrate/issues/94)) ([758af61](https://github.com/ObieMunoz/ts-migrate/commit/758af61d6d120a9465557711fba90211a6fc8118))
* **cli:** add report and check commands for suppression and any counts ([#105](https://github.com/ObieMunoz/ts-migrate/issues/105)) ([1a4d4e5](https://github.com/ObieMunoz/ts-migrate/commit/1a4d4e52fed0aed15aa4cc91381c32c5d4557021)), closes [#73](https://github.com/ObieMunoz/ts-migrate/issues/73)
* **cli:** cap the report per-file listing at the 10 worst files ([#106](https://github.com/ObieMunoz/ts-migrate/issues/106)) ([2a199ec](https://github.com/ObieMunoz/ts-migrate/commit/2a199ec2ae0f5642b0bfa63f9fb3ef8ef7044fa4))
* **cli:** write a machine-readable run summary with --jsonSummary ([#108](https://github.com/ObieMunoz/ts-migrate/issues/108)) ([ce3d91d](https://github.com/ObieMunoz/ts-migrate/commit/ce3d91deb6e661d8e66a1fc34cc48c29aac1fc66))
* **migrate:** retain ambient .d.ts files when --sources is used ([#90](https://github.com/ObieMunoz/ts-migrate/issues/90)) ([9aa9d55](https://github.com/ObieMunoz/ts-migrate/commit/9aa9d55c5e77fb522ebaa94c45f3f6639c276e71))
* **server:** show progress during long plugin passes ([#112](https://github.com/ObieMunoz/ts-migrate/issues/112)) ([a6ece3d](https://github.com/ObieMunoz/ts-migrate/commit/a6ece3df1bfc47f70eb6dedfea297ec88d6a4c85))
* **ts-migrate:** add --version and -v to the CLI and ts-migrate-full ([#93](https://github.com/ObieMunoz/ts-migrate/issues/93)) ([8b65214](https://github.com/ObieMunoz/ts-migrate/commit/8b65214b54d64f990335ad3329c05b893667ff19))
* **ts-migrate-full:** print .git-blame-ignore-revs guidance (opt-in write) ([#103](https://github.com/ObieMunoz/ts-migrate/issues/103)) ([9dfdb06](https://github.com/ObieMunoz/ts-migrate/commit/9dfdb06e70a12f571bbdcc8a902b22dec04f0adc))





# [0.11.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.10.4...v0.11.0) (2026-07-24)


### Features

* **reignore:** support --sources for scoped/staged migrations ([#87](https://github.com/ObieMunoz/ts-migrate/issues/87)) ([62837a9](https://github.com/ObieMunoz/ts-migrate/commit/62837a9171efa240f9d53cbe02cebe9da365d9ce))





## [0.10.4](https://github.com/ObieMunoz/ts-migrate/compare/v0.10.3...v0.10.4) (2026-07-21)

**Note:** Version bump only for package @obiemunoz/ts-migrate





## [0.10.3](https://github.com/ObieMunoz/ts-migrate/compare/v0.10.2...v0.10.3) (2026-07-11)

### Bug Fixes

- keep migration output consistent with the project's own tsc check ([#56](https://github.com/ObieMunoz/ts-migrate/issues/56)) ([4d3adf7](https://github.com/ObieMunoz/ts-migrate/commit/4d3adf72db7da1eef64aa3427688a97a358eeb07))

## [0.10.2](https://github.com/ObieMunoz/ts-migrate/compare/v0.10.1...v0.10.2) (2026-07-11)

### Bug Fixes

- use the ts-migrate bin name as the yargs scriptName ([#53](https://github.com/ObieMunoz/ts-migrate/issues/53)) ([1969aca](https://github.com/ObieMunoz/ts-migrate/commit/1969aca421d82f3e3fb0bf62958b3bfebac9ef08))

### Performance Improvements

- parallelize eslint-fix across an adaptive worker thread pool ([#52](https://github.com/ObieMunoz/ts-migrate/issues/52)) ([8a923e3](https://github.com/ObieMunoz/ts-migrate/commit/8a923e31170ba1e372be9321337da93c8460730b))

## [0.10.1](https://github.com/ObieMunoz/ts-migrate/compare/v0.10.0...v0.10.1) (2026-07-11)

**Note:** Version bump only for package @obiemunoz/ts-migrate

# [0.10.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.9.2...v0.10.0) (2026-07-11)

### Features

- **ts-migrate:** add agent playbook command and non-interactive ts-migrate-full flags ([#48](https://github.com/ObieMunoz/ts-migrate/issues/48)) ([9b9fc9a](https://github.com/ObieMunoz/ts-migrate/commit/9b9fc9adafae1558e1951f0f3bc93287d2d35122))

## [0.9.2](https://github.com/ObieMunoz/ts-migrate/compare/v0.9.1...v0.9.2) (2026-07-11)

### Bug Fixes

- **ts-migrate:** surface [@types](https://github.com/types) recommendations at the end of ts-migrate-full ([#47](https://github.com/ObieMunoz/ts-migrate/issues/47)) ([7d98851](https://github.com/ObieMunoz/ts-migrate/commit/7d98851103192ad18969b51301dfb24122059c68))

## [0.9.1](https://github.com/ObieMunoz/ts-migrate/compare/v0.9.0...v0.9.1) (2026-07-11)

**Note:** Version bump only for package @obiemunoz/ts-migrate

# [0.9.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.8.0...v0.9.0) (2026-07-10)

### Bug Fixes

- work out of the box on plain JS projects ([#42](https://github.com/ObieMunoz/ts-migrate/issues/42)) ([1296cad](https://github.com/ObieMunoz/ts-migrate/commit/1296cad46d78fb035316820a664c87afdd8bacd4))
- **ts-migrate:** pick JSX transform from React version, check with esnext lib ([#44](https://github.com/ObieMunoz/ts-migrate/issues/44)) ([bab87b8](https://github.com/ObieMunoz/ts-migrate/commit/bab87b84c21f7ba69f7630953df5d2c51941b589))

### Features

- **ts-migrate:** recommend [@types](https://github.com/types) packages from migration diagnostics ([#45](https://github.com/ObieMunoz/ts-migrate/issues/45)) ([3acff75](https://github.com/ObieMunoz/ts-migrate/commit/3acff752adb43dd39f2bc7a6601961f0dba9f3f3))

# [0.8.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.6.0...v0.8.0) (2026-07-10)

### Bug Fixes

- **ts-migrate:** keep stale build output from failing prepack with TS5055 ([#40](https://github.com/ObieMunoz/ts-migrate/issues/40)) ([1476e46](https://github.com/ObieMunoz/ts-migrate/commit/1476e46f17920ac40a8f88a3db35374477646be7))

### Features

- **plugins:** add update-import-paths plugin for renamed .js/.jsx imports ([#37](https://github.com/ObieMunoz/ts-migrate/issues/37)) ([b80a69b](https://github.com/ObieMunoz/ts-migrate/commit/b80a69b6c2ef6237b0670fe05e688c1ef420019a))
- **ts-migrate-plugins:** convert imported propTypes objects (inline-into-consumer + InferProps fallback) ([#38](https://github.com/ObieMunoz/ts-migrate/issues/38)) ([a795d26](https://github.com/ObieMunoz/ts-migrate/commit/a795d26c411f3c311833bb1d093818d1f5375c4a))

### Performance Improvements

- **ts-migrate:** replace json5-writer with comment-preserving JSON5 text splices ([#35](https://github.com/ObieMunoz/ts-migrate/issues/35)) ([d6d6ef0](https://github.com/ObieMunoz/ts-migrate/commit/d6d6ef0586c170810f34e777a5e7228b5aee65a7))

# [0.7.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.6.0...v0.7.0) (2026-07-10)

### Features

- **plugins:** add update-import-paths plugin for renamed .js/.jsx imports ([#37](https://github.com/ObieMunoz/ts-migrate/issues/37)) ([b80a69b](https://github.com/ObieMunoz/ts-migrate/commit/b80a69b6c2ef6237b0670fe05e688c1ef420019a))
- **ts-migrate-plugins:** convert imported propTypes objects (inline-into-consumer + InferProps fallback) ([#38](https://github.com/ObieMunoz/ts-migrate/issues/38)) ([a795d26](https://github.com/ObieMunoz/ts-migrate/commit/a795d26c411f3c311833bb1d093818d1f5375c4a))

### Performance Improvements

- **ts-migrate:** replace json5-writer with comment-preserving JSON5 text splices ([#35](https://github.com/ObieMunoz/ts-migrate/issues/35)) ([d6d6ef0](https://github.com/ObieMunoz/ts-migrate/commit/d6d6ef0586c170810f34e777a5e7228b5aee65a7))

# [0.6.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.5.1...v0.6.0) (2026-07-10)

### Features

- **plugins:** add hoist-declarations plugin for use-before-define consts ([#26](https://github.com/ObieMunoz/ts-migrate/issues/26)) ([1055667](https://github.com/ObieMunoz/ts-migrate/commit/1055667245ba363e50c7c699b9771092dd8f71b0))

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
- **tests:** make rename require('react') fixture props-free to satisfy react lint rules ([1cd3771](https://github.com/ObieMunoz/ts-migrate/commit/1cd3771a640ee32a2d6930168fa426dc5909882a))

### Features

- add hoist-arrow-functions plugin ([a755c29](https://github.com/ObieMunoz/ts-migrate/commit/a755c29ffb4412bec96a86c8a4f69cd13784ede5))

# [0.3.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.2.5...v0.3.0) (2026-07-08)

### Bug Fixes

- **tests:** set explicit rootDir for ts-jest so 6.0 doesn't emit TS5011 ([368c9c6](https://github.com/ObieMunoz/ts-migrate/commit/368c9c63bf8c8c1c97cc5fc5622c81d95bad4b85))

### Features

- support TypeScript 6.x ([6a05fa5](https://github.com/ObieMunoz/ts-migrate/commit/6a05fa5714eaeb57a8c17ae95c754a46dc738328))

## [0.2.5](https://github.com/ObieMunoz/ts-migrate/compare/v0.2.4...v0.2.5) (2026-07-08)

**Note:** Version bump only for package @obiemunoz/ts-migrate

## [0.2.4](https://github.com/ObieMunoz/ts-migrate/compare/v0.2.3...v0.2.4) (2026-07-08)

**Note:** Version bump only for package @obiemunoz/ts-migrate

## [0.2.3](https://github.com/ObieMunoz/ts-migrate/compare/v0.2.2...v0.2.3) (2026-07-08)

### Bug Fixes

- **cli:** resolve bundled CLI from ts-migrate-full.sh's own location; docs: correct npx usage ([8ec6349](https://github.com/ObieMunoz/ts-migrate/commit/8ec6349bbfbcdd5836fbf616be53c480bad9b3f2))

## [0.2.2](https://github.com/ObieMunoz/ts-migrate/compare/v0.2.1...v0.2.2) (2026-07-08)

### Bug Fixes

- **deps:** cap the typescript peer dependency below 6 ([aebcc70](https://github.com/ObieMunoz/ts-migrate/commit/aebcc70b83973d8f31f629f2985ffc117d9bc177))

## [0.2.1](https://github.com/ObieMunoz/ts-migrate/compare/v0.2.0...v0.2.1) (2026-07-08)

**Note:** Version bump only for package @obiemunoz/ts-migrate
