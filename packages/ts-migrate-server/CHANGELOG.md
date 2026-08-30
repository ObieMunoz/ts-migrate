# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.20.3](https://github.com/ObieMunoz/ts-migrate/compare/v0.20.2...v0.20.3) (2026-08-30)


### Bug Fixes

* **ts-migrate-plugins:** drop the inert mutationsPreserveTypes on declare-globals ([#467](https://github.com/ObieMunoz/ts-migrate/issues/467)) ([b4dab43](https://github.com/ObieMunoz/ts-migrate/commit/b4dab4331c96f3376e2ede2cdc2bd5601743ad02))





# [0.20.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.19.1...v0.20.0) (2026-08-06)


### Features

* **ts-migrate-plugins:** import the names a file uses instead of suppressing them ([#347](https://github.com/ObieMunoz/ts-migrate/issues/347)) ([0f0e146](https://github.com/ObieMunoz/ts-migrate/commit/0f0e14621ae6fd808238143f58354b359b5d4ecc))





# [0.19.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.18.0...v0.19.0) (2026-07-30)

**Note:** Version bump only for package @obiemunoz/ts-migrate-server





# [0.18.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.17.0...v0.18.0) (2026-07-30)


### Bug Fixes

* **ts-migrate-plugins:** re-point an absolute import left naming a renamed file ([#337](https://github.com/ObieMunoz/ts-migrate/issues/337)) ([c3778ed](https://github.com/ObieMunoz/ts-migrate/commit/c3778ed943b3af5f7144971ef5a15bc36d6e0ff1))





# [0.17.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.16.0...v0.17.0) (2026-07-29)


### Bug Fixes

* report a file migrate and reignore cannot write instead of printing the help screen ([#315](https://github.com/ObieMunoz/ts-migrate/issues/315)) ([033b6eb](https://github.com/ObieMunoz/ts-migrate/commit/033b6eb564f29ec427d3223e3f5b65fd04095b27))
* **ts-migrate-server:** give namespace re-exports a dirty-file dependency edge ([#319](https://github.com/ObieMunoz/ts-migrate/issues/319)) ([ceeff9b](https://github.com/ObieMunoz/ts-migrate/commit/ceeff9b69636d3860d6a875b710a9361218ac413))





# [0.16.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.15.0...v0.16.0) (2026-07-26)

**Note:** Version bump only for package @obiemunoz/ts-migrate-server





# [0.15.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.14.0...v0.15.0) (2026-07-26)


### Bug Fixes

* **ts-migrate-server:** skip files a plugin already failed on in later passes ([#285](https://github.com/ObieMunoz/ts-migrate/issues/285)) ([ab9e5f6](https://github.com/ObieMunoz/ts-migrate/commit/ab9e5f61d513516a0836ab1dd535fa5c5119df4c))


### Features

* **ts-migrate-plugins:** mark the sites plugins leave for a person, and report them at the end of the run ([#283](https://github.com/ObieMunoz/ts-migrate/issues/283)) ([bf5a98f](https://github.com/ObieMunoz/ts-migrate/commit/bf5a98fb8feec76e533d063524d3aaf2ec0087a0))





# [0.14.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.13.0...v0.14.0) (2026-07-25)


### Bug Fixes

* **cli:** report the failures that reached no summary ([#261](https://github.com/ObieMunoz/ts-migrate/issues/261)) ([3176b05](https://github.com/ObieMunoz/ts-migrate/commit/3176b05b1a797d74b4d578d2e0b5cb5917ad4918))
* **errors:** report failures that were reaching users as silence or a bare stack ([#183](https://github.com/ObieMunoz/ts-migrate/issues/183)) ([6964de4](https://github.com/ObieMunoz/ts-migrate/commit/6964de4be2a1109bf2919601633c37d7b7d6bdcd))
* **eslint-fix:** report lint failures once per cause instead of once per file ([#155](https://github.com/ObieMunoz/ts-migrate/issues/155)) ([ddf5f18](https://github.com/ObieMunoz/ts-migrate/commit/ddf5f188b3ab69c4cbc49d57be2cdd1e22827e0e))
* **server:** keep .d.mts and .d.cts out of the migration set ([#209](https://github.com/ObieMunoz/ts-migrate/issues/209)) ([a719b1a](https://github.com/ObieMunoz/ts-migrate/commit/a719b1a75016aa3ee665197ae8c6bdbe49d3dd79))
* **server:** keep javascript files out of the migration set ([#182](https://github.com/ObieMunoz/ts-migrate/issues/182)) ([608a18c](https://github.com/ObieMunoz/ts-migrate/commit/608a18cbdf9fd839121eee3c2c69c4924d2ec8d1))
* **server:** report passes and convergence truthfully during a migration ([#222](https://github.com/ObieMunoz/ts-migrate/issues/222)) ([d842dd2](https://github.com/ObieMunoz/ts-migrate/commit/d842dd26a403b1dab26d154feabdec5b4d5b2971))





# [0.13.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.12.1...v0.13.0) (2026-07-24)


### Features

* **cli:** run the project's TypeScript instead of the one npx resolves ([#129](https://github.com/ObieMunoz/ts-migrate/issues/129)) ([2f9872b](https://github.com/ObieMunoz/ts-migrate/commit/2f9872b6b57f506cd7461e3bc1058c4de2351bc0))
* **plugins:** declare modules with no type definitions available ([#139](https://github.com/ObieMunoz/ts-migrate/issues/139)) ([eaf2a5d](https://github.com/ObieMunoz/ts-migrate/commit/eaf2a5d9efafd88a34021edd3df1d8112574f66b))





## [0.12.1](https://github.com/ObieMunoz/ts-migrate/compare/v0.12.0...v0.12.1) (2026-07-24)


### Features

* **cli:** skip gitignored files by default ([#118](https://github.com/ObieMunoz/ts-migrate/issues/118)) ([9fa8a85](https://github.com/ObieMunoz/ts-migrate/commit/9fa8a8597487dfea3e10b0e5f9e3ed3328ed92c4))





# [0.12.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.11.1...v0.12.0) (2026-07-24)


### Features

* **cli:** add --dry-run to rename, migrate, and reignore ([#111](https://github.com/ObieMunoz/ts-migrate/issues/111)) ([25dfc68](https://github.com/ObieMunoz/ts-migrate/commit/25dfc68fb5fa8b6edaa9febf96bb9d657b9fb3fc))
* **cli:** write a machine-readable run summary with --jsonSummary ([#108](https://github.com/ObieMunoz/ts-migrate/issues/108)) ([ce3d91d](https://github.com/ObieMunoz/ts-migrate/commit/ce3d91deb6e661d8e66a1fc34cc48c29aac1fc66))
* **migrate:** retain ambient .d.ts files when --sources is used ([#90](https://github.com/ObieMunoz/ts-migrate/issues/90)) ([9aa9d55](https://github.com/ObieMunoz/ts-migrate/commit/9aa9d55c5e77fb522ebaa94c45f3f6639c276e71))
* **server:** show progress during long plugin passes ([#112](https://github.com/ObieMunoz/ts-migrate/issues/112)) ([a6ece3d](https://github.com/ObieMunoz/ts-migrate/commit/a6ece3df1bfc47f70eb6dedfea297ec88d6a4c85))





# [0.11.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.10.4...v0.11.0) (2026-07-24)

**Note:** Version bump only for package @obiemunoz/ts-migrate-server





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
