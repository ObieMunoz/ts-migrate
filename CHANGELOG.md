# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

# [0.16.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.15.0...v0.16.0) (2026-07-26)


### Features

* **cli:** settle the flag casing on camelCase and add a config file ([#299](https://github.com/ObieMunoz/ts-migrate/issues/299)) ([0e59302](https://github.com/ObieMunoz/ts-migrate/commit/0e59302686b9c65252f064809354030890f1c2bc))





# [0.15.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.14.0...v0.15.0) (2026-07-26)


### Bug Fixes

* **ts-migrate-plugins:** collapse the typescript-estree version banner to one line ([#296](https://github.com/ObieMunoz/ts-migrate/issues/296)) ([3797238](https://github.com/ObieMunoz/ts-migrate/commit/3797238c9ff164b035416bd9397d6d8b91b70575))
* **ts-migrate-plugins:** keep the types infer-types can write when one cannot be printed ([#287](https://github.com/ObieMunoz/ts-migrate/issues/287)) ([d824b92](https://github.com/ObieMunoz/ts-migrate/commit/d824b92d05c9237c0f3a198962929d56eaab5fb6))
* **ts-migrate-plugins:** reject overlapping source text updates ([#286](https://github.com/ObieMunoz/ts-migrate/issues/286)) ([f6c1ae0](https://github.com/ObieMunoz/ts-migrate/commit/f6c1ae092305a453f1eff60e5bbdcba79b0b100d))
* **ts-migrate-server:** skip files a plugin already failed on in later passes ([#285](https://github.com/ObieMunoz/ts-migrate/issues/285)) ([ab9e5f6](https://github.com/ObieMunoz/ts-migrate/commit/ab9e5f61d513516a0836ab1dd535fa5c5119df4c))


### Features

* **cli:** keep the generated declarations in the project tsconfig ([#284](https://github.com/ObieMunoz/ts-migrate/issues/284)) ([fb2dbc1](https://github.com/ObieMunoz/ts-migrate/commit/fb2dbc151e42b4ef413c61f192c3f64001ecc5b6))
* **cli:** make ts-migrate full a first-class command instead of a shell script ([#288](https://github.com/ObieMunoz/ts-migrate/issues/288)) ([bd9a9c2](https://github.com/ObieMunoz/ts-migrate/commit/bd9a9c26e7a000adbabc5b70881a189fe0c3b331))
* **ts-migrate-plugins:** mark the sites plugins leave for a person, and report them at the end of the run ([#283](https://github.com/ObieMunoz/ts-migrate/issues/283)) ([bf5a98f](https://github.com/ObieMunoz/ts-migrate/commit/bf5a98fb8feec76e533d063524d3aaf2ec0087a0))





# [0.14.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.13.0...v0.14.0) (2026-07-25)


### Bug Fixes

* **cli:** agree on which config files the tool recognizes ([#277](https://github.com/ObieMunoz/ts-migrate/issues/277)) ([bab2760](https://github.com/ObieMunoz/ts-migrate/commit/bab27609c07336e2c26be79f76735dc16bc9af69))
* **cli:** agree on which extensions are build system files ([#244](https://github.com/ObieMunoz/ts-migrate/issues/244)) ([20496f0](https://github.com/ObieMunoz/ts-migrate/commit/20496f05a4ee6ebf50a0b5488ea5c23129ae5a6f))
* **cli:** fail when the target folder does not exist ([#271](https://github.com/ObieMunoz/ts-migrate/issues/271)) ([dac2bfe](https://github.com/ObieMunoz/ts-migrate/commit/dac2bfe7410de80689e9fc5ccb6b1b0edddf4453))
* **cli:** find alias declarations in .d.mts and .d.cts files ([#216](https://github.com/ObieMunoz/ts-migrate/issues/216)) ([5ef7c8f](https://github.com/ObieMunoz/ts-migrate/commit/5ef7c8f1cb7e85aa8087614039806c6fcec24f91))
* **cli:** guard the ts-migrate-full steps and keep the types report on failure ([#269](https://github.com/ObieMunoz/ts-migrate/issues/269)) ([6ba99c0](https://github.com/ObieMunoz/ts-migrate/commit/6ba99c0ea1f2fea669274da44aaecfbf99266591))
* **cli:** pass plugin options through the --plugin path ([#199](https://github.com/ObieMunoz/ts-migrate/issues/199)) ([272c960](https://github.com/ObieMunoz/ts-migrate/commit/272c9606aaf78bf2b75e679250274e3eb3d831a5))
* **cli:** reject unknown commands and wrap help output when piped ([#231](https://github.com/ObieMunoz/ts-migrate/issues/231)) ([41f26cb](https://github.com/ObieMunoz/ts-migrate/commit/41f26cb30dc908eb2c1349668f3fe570ae561083))
* **cli:** remove stray backslash from ts-migrate-full rename banner ([#151](https://github.com/ObieMunoz/ts-migrate/issues/151)) ([fe5f1d0](https://github.com/ObieMunoz/ts-migrate/commit/fe5f1d054633698c350fd91a2ca7d58b692ee91b)), closes [#127](https://github.com/ObieMunoz/ts-migrate/issues/127)
* **cli:** report the failures that reached no summary ([#261](https://github.com/ObieMunoz/ts-migrate/issues/261)) ([3176b05](https://github.com/ObieMunoz/ts-migrate/commit/3176b05b1a797d74b4d578d2e0b5cb5917ad4918))
* **cli:** resolve alias declarations by scope rather than by text ([#254](https://github.com/ObieMunoz/ts-migrate/issues/254)) ([7280fd4](https://github.com/ObieMunoz/ts-migrate/commit/7280fd4ba6529559f28fa10a41fe46d0e838c191))
* **cli:** stop the options placeholder from swallowing a stray argument ([#248](https://github.com/ObieMunoz/ts-migrate/issues/248)) ([0395146](https://github.com/ObieMunoz/ts-migrate/commit/039514676ef03f73345b4f268bb7884c746a20f5))
* **errors:** report failures that were reaching users as silence or a bare stack ([#183](https://github.com/ObieMunoz/ts-migrate/issues/183)) ([6964de4](https://github.com/ObieMunoz/ts-migrate/commit/6964de4be2a1109bf2919601633c37d7b7d6bdcd))
* **eslint-fix:** report lint failures once per cause instead of once per file ([#155](https://github.com/ObieMunoz/ts-migrate/issues/155)) ([ddf5f18](https://github.com/ObieMunoz/ts-migrate/commit/ddf5f188b3ab69c4cbc49d57be2cdd1e22827e0e))
* **eslint-fix:** resolve the ESLint config from the migration root, not the working directory ([#153](https://github.com/ObieMunoz/ts-migrate/issues/153)) ([d76aefe](https://github.com/ObieMunoz/ts-migrate/commit/d76aefe592899ebc1af65f33b24382346976714f))
* **eslint-fix:** write the run banner through updatable-log ([#158](https://github.com/ObieMunoz/ts-migrate/issues/158)) ([7022d65](https://github.com/ObieMunoz/ts-migrate/commit/7022d65646b4618510c12155f624437fb12b5eee))
* **plugins:** break lockfile ties by pin, workspace file, then mtime ([#161](https://github.com/ObieMunoz/ts-migrate/issues/161)) ([3c24b76](https://github.com/ObieMunoz/ts-migrate/commit/3c24b76eebe6284ac2266d36771f9cef63d30bb3))
* **plugins:** convert arrow component default props without a circular type ([#258](https://github.com/ObieMunoz/ts-migrate/issues/258)) ([e28a6ff](https://github.com/ObieMunoz/ts-migrate/commit/e28a6ffc19018f54c72b2fa8132f97332cff1fc1)), closes [#246](https://github.com/ObieMunoz/ts-migrate/issues/246)
* **plugins:** emit the default props alias where it can be read ([#246](https://github.com/ObieMunoz/ts-migrate/issues/246)) ([3bd6d8a](https://github.com/ObieMunoz/ts-migrate/commit/3bd6d8a071bc5965d21351cf39b13300742c9a7b))
* **plugins:** keep extensionless specifiers in .cts files ([#243](https://github.com/ObieMunoz/ts-migrate/issues/243)) ([ec66001](https://github.com/ObieMunoz/ts-migrate/commit/ec66001f9e775d2a7faf124dc66ce8676025437e))
* **plugins:** keep the space before a renamed props annotation ([#275](https://github.com/ObieMunoz/ts-migrate/issues/275)) ([a760e83](https://github.com/ObieMunoz/ts-migrate/commit/a760e83a6fe06b841faa50252757d3f46947a88b))
* **plugins:** refuse to print void in a widened annotation ([#276](https://github.com/ObieMunoz/ts-migrate/issues/276)) ([0ed769b](https://github.com/ObieMunoz/ts-migrate/commit/0ed769b15c7c79b109bf001a131c391e9d765bb2))
* **plugins:** say project tsconfig rather than generated in the types report ([#266](https://github.com/ObieMunoz/ts-migrate/issues/266)) ([41f5ae9](https://github.com/ObieMunoz/ts-migrate/commit/41f5ae9e61c3689ac6236940ad6989dd677b4a02))
* **plugins:** stop the lockfile search at the project root ([#157](https://github.com/ObieMunoz/ts-migrate/issues/157)) ([c598c7e](https://github.com/ObieMunoz/ts-migrate/commit/c598c7ecbaee600945163a8cb4788bfa3ba4e5ce)), closes [#132](https://github.com/ObieMunoz/ts-migrate/issues/132)
* **plugins:** type a constructor assignment to an empty object literal ([#264](https://github.com/ObieMunoz/ts-migrate/issues/264)) ([d9080f6](https://github.com/ObieMunoz/ts-migrate/commit/d9080f6530369ba39ce6c7353113298a1ffe8069))
* **plugins:** validate infer-types candidates against current dependency text ([#228](https://github.com/ObieMunoz/ts-migrate/issues/228)) ([3577374](https://github.com/ObieMunoz/ts-migrate/commit/357737469f9cc6d8ab5971df21d5a438a7a71778))
* **server:** keep .d.mts and .d.cts out of the migration set ([#209](https://github.com/ObieMunoz/ts-migrate/issues/209)) ([a719b1a](https://github.com/ObieMunoz/ts-migrate/commit/a719b1a75016aa3ee665197ae8c6bdbe49d3dd79))
* **server:** keep javascript files out of the migration set ([#182](https://github.com/ObieMunoz/ts-migrate/issues/182)) ([608a18c](https://github.com/ObieMunoz/ts-migrate/commit/608a18cbdf9fd839121eee3c2c69c4924d2ec8d1))
* **server:** report passes and convergence truthfully during a migration ([#222](https://github.com/ObieMunoz/ts-migrate/issues/222)) ([d842dd2](https://github.com/ObieMunoz/ts-migrate/commit/d842dd26a403b1dab26d154feabdec5b4d5b2971))
* **ts-migrate-plugins:** stop jsdoc writing a second return annotation ([#282](https://github.com/ObieMunoz/ts-migrate/issues/282)) ([d232f49](https://github.com/ObieMunoz/ts-migrate/commit/d232f497f54ae657595e67f1ea9f8cec75501609))
* **ts-migrate:** commit each step through git -C instead of a cd pair ([#165](https://github.com/ObieMunoz/ts-migrate/issues/165)) ([5cbea43](https://github.com/ObieMunoz/ts-migrate/commit/5cbea430e9ef11163a67c24b7429bebde0f7905a))
* **ts-migrate:** compare compilers below the major and check the pair before Step 1 ([#163](https://github.com/ObieMunoz/ts-migrate/issues/163)) ([347e974](https://github.com/ObieMunoz/ts-migrate/commit/347e974a3dfdfa37f273778555ee606dd9c23470))


### Features

* **cli:** add the annotateReturns flag for the jsdoc plugin ([#195](https://github.com/ObieMunoz/ts-migrate/issues/195)) ([ed58f63](https://github.com/ObieMunoz/ts-migrate/commit/ed58f6376d6e387a545310bf604bce2a918427a3))
* **cli:** declare wildcard asset modules for bundler projects ([#224](https://github.com/ObieMunoz/ts-migrate/issues/224)) ([9485af9](https://github.com/ObieMunoz/ts-migrate/commit/9485af9cac0458c27d79c22a53885a1d6f70d887))
* **cli:** detect vite and webpack when generating the tsconfig ([#194](https://github.com/ObieMunoz/ts-migrate/issues/194)) ([828e95c](https://github.com/ObieMunoz/ts-migrate/commit/828e95c37b6845427f27d487351ff1475b8d5c6e))
* **cli:** enable allowJs in the generated tsconfig ([#196](https://github.com/ObieMunoz/ts-migrate/issues/196)) ([0c5c0e0](https://github.com/ObieMunoz/ts-migrate/commit/0c5c0e00c07fb3edb14f2e4be332c0bad60a8a55))
* **cli:** enable resolveJsonModule in the generated tsconfig ([#174](https://github.com/ObieMunoz/ts-migrate/issues/174)) ([72719a3](https://github.com/ObieMunoz/ts-migrate/commit/72719a3dff2cfc14e130e81c1cb31b1013ca6d3e)), closes [#82](https://github.com/ObieMunoz/ts-migrate/issues/82)
* **cli:** retry the any assertions add-conversions inserted ([#214](https://github.com/ObieMunoz/ts-migrate/issues/214)) ([bc356bf](https://github.com/ObieMunoz/ts-migrate/commit/bc356bfb7fa07c47572c15dc55703cce5d5a701c))
* **cli:** run the jsdoc plugin in the default pipeline ([#247](https://github.com/ObieMunoz/ts-migrate/issues/247)) ([37c0e67](https://github.com/ObieMunoz/ts-migrate/commit/37c0e6736d1753abf6f13d90ddbb144c8ba42c5d))
* **cli:** run the type package preflight before migrate and reignore ([#259](https://github.com/ObieMunoz/ts-migrate/issues/259)) ([f2c5fa6](https://github.com/ObieMunoz/ts-migrate/commit/f2c5fa648abd7908395db99f700bfa7c30177806))
* **cli:** translate webpack module resolution into tsconfig paths ([#267](https://github.com/ObieMunoz/ts-migrate/issues/267)) ([b4e2db4](https://github.com/ObieMunoz/ts-migrate/commit/b4e2db4d2c6ad7afaa6bdf49d3e3e312066be8be))
* **cli:** update package.json scripts and test globs after rename ([#176](https://github.com/ObieMunoz/ts-migrate/issues/176)) ([7b6498e](https://github.com/ObieMunoz/ts-migrate/commit/7b6498e290dab5acb42a02c787ef2fcf0b61893e))
* **cli:** warn about missing type packages before the migration runs ([#251](https://github.com/ObieMunoz/ts-migrate/issues/251)) ([a950c85](https://github.com/ObieMunoz/ts-migrate/commit/a950c851cd51476ede11f32716c7251ab285e976))
* **plugins:** add type arguments to createContext calls ([#257](https://github.com/ObieMunoz/ts-migrate/issues/257)) ([68ab4e7](https://github.com/ObieMunoz/ts-migrate/commit/68ab4e7271e61bab6024c4b4398d051f3fda063a))
* **plugins:** add type arguments to react hook calls ([#227](https://github.com/ObieMunoz/ts-migrate/issues/227)) ([367fa79](https://github.com/ObieMunoz/ts-migrate/commit/367fa7934c7e0f472d61dff60d6b5f6cf3111caa))
* **plugins:** collect global assignments into a generated declare global ([#230](https://github.com/ObieMunoz/ts-migrate/issues/230)) ([200f16b](https://github.com/ObieMunoz/ts-migrate/commit/200f16bc888843855ce5d2c5f97056b5486f7242))
* **plugins:** convert commonjs exports and requires to typescript module syntax ([#201](https://github.com/ObieMunoz/ts-migrate/issues/201)) ([9cd9fa8](https://github.com/ObieMunoz/ts-migrate/commit/9cd9fa882ad330f5c880458d62a2e8de3231e244))
* **plugins:** convert function component defaultProps to default parameters ([#233](https://github.com/ObieMunoz/ts-migrate/issues/233)) ([a1c7fb5](https://github.com/ObieMunoz/ts-migrate/commit/a1c7fb5acb24320d0949ea9c813c0898958dfbf2))
* **plugins:** convert inline jsdoc type casts to as expressions ([#280](https://github.com/ObieMunoz/ts-migrate/issues/280)) ([8edc502](https://github.com/ObieMunoz/ts-migrate/commit/8edc50277cdf2c61ae3be474224822b08977b070))
* **plugins:** convert jsdoc template tags on classes ([#213](https://github.com/ObieMunoz/ts-migrate/issues/213)) ([15d28c9](https://github.com/ObieMunoz/ts-migrate/commit/15d28c9adb829b44ad9591445e8b457c97c2c47e))
* **plugins:** convert jsdoc typedef, callback and template into type aliases ([#179](https://github.com/ObieMunoz/ts-migrate/issues/179)) ([ff05da0](https://github.com/ObieMunoz/ts-migrate/commit/ff05da083062a4568010a1b4d05d498cce2d78f0))
* **plugins:** detect memo and function-expression components in react-props ([#184](https://github.com/ObieMunoz/ts-migrate/issues/184)) ([fb96c78](https://github.com/ObieMunoz/ts-migrate/commit/fb96c78938d6ae2db133b4a8d11676860f0396c1)), closes [#76](https://github.com/ObieMunoz/ts-migrate/issues/76) [#81](https://github.com/ObieMunoz/ts-migrate/issues/81)
* **plugins:** generate props types for components without propTypes ([#240](https://github.com/ObieMunoz/ts-migrate/issues/240)) ([82a7c33](https://github.com/ObieMunoz/ts-migrate/commit/82a7c3345fb6de4d92d20483eb15f6b2833df875))
* **plugins:** infer class property types instead of declaring any ([#202](https://github.com/ObieMunoz/ts-migrate/issues/202)) ([9429321](https://github.com/ObieMunoz/ts-migrate/commit/94293219f83323f422ebda9d6714db5aafe26609))
* **plugins:** narrow the any assertions that survive the retry ([#262](https://github.com/ObieMunoz/ts-migrate/issues/262)) ([3b62949](https://github.com/ObieMunoz/ts-migrate/commit/3b629497e9b3430a053581c15e5ff9ca5c32a716))
* **plugins:** read the packageManager pin before searching for a lockfile ([#160](https://github.com/ObieMunoz/ts-migrate/issues/160)) ([230fd8e](https://github.com/ObieMunoz/ts-migrate/commit/230fd8e07c4da9bcfd014b6ff95d1616ed3ec3af))
* **plugins:** record the diagnostic evidence suppressions discard ([#203](https://github.com/ObieMunoz/ts-migrate/issues/203)) ([9372aa2](https://github.com/ObieMunoz/ts-migrate/commit/9372aa286bec9f77a1dfe5f4b6d176150c5c850a))
* **plugins:** report the documented type names that resolve to nothing ([#263](https://github.com/ObieMunoz/ts-migrate/issues/263)) ([ff9a25c](https://github.com/ObieMunoz/ts-migrate/commit/ff9a25c6a35065d347b791eaf99e588ab6d01c18))
* **plugins:** type empty object literals from their property assignments ([#239](https://github.com/ObieMunoz/ts-migrate/issues/239)) ([3f1f81f](https://github.com/ObieMunoz/ts-migrate/commit/3f1f81fd4df13042beded744c08e2b025d4523a7))
* **plugins:** type empty object literals on class properties and deferred assignments ([#253](https://github.com/ObieMunoz/ts-migrate/issues/253)) ([4c6cc2b](https://github.com/ObieMunoz/ts-migrate/commit/4c6cc2bfc0279c028029cd565357bed59a58d22f))
* **plugins:** widen annotations that assignments contradict ([#237](https://github.com/ObieMunoz/ts-migrate/issues/237)) ([1177254](https://github.com/ObieMunoz/ts-migrate/commit/117725442c5c70663934fd44e86f0403615de3c8))
* **types-packages:** add the workspace root flag to the install command ([#162](https://github.com/ObieMunoz/ts-migrate/issues/162)) ([6c0e00a](https://github.com/ObieMunoz/ts-migrate/commit/6c0e00aa4b594196f545f8f96bcb6ac691917e15))





# [0.13.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.12.1...v0.13.0) (2026-07-24)


### Bug Fixes

* **eslint-fix:** run the project's ESLint instead of the bundled copy ([#137](https://github.com/ObieMunoz/ts-migrate/issues/137)) ([19f4701](https://github.com/ObieMunoz/ts-migrate/commit/19f4701ebf72f5670380a83bfd8328980f864da9))


### Features

* **cli:** handle .mjs and .cjs files in rename ([#140](https://github.com/ObieMunoz/ts-migrate/issues/140)) ([1f25141](https://github.com/ObieMunoz/ts-migrate/commit/1f25141dff832dd163326a8943c6f7382f480687))
* **cli:** run the project's TypeScript instead of the one npx resolves ([#129](https://github.com/ObieMunoz/ts-migrate/issues/129)) ([2f9872b](https://github.com/ObieMunoz/ts-migrate/commit/2f9872b6b57f506cd7461e3bc1058c4de2351bc0))
* **cli:** skip build system files by default ([#128](https://github.com/ObieMunoz/ts-migrate/issues/128)) ([2792827](https://github.com/ObieMunoz/ts-migrate/commit/2792827dc60b384341aa2766cafdba59df2c460b))
* **plugins:** annotate the newer React class lifecycle methods ([#131](https://github.com/ObieMunoz/ts-migrate/issues/131)) ([08e5583](https://github.com/ObieMunoz/ts-migrate/commit/08e558388a37aa31ce9b078755695c036d5018c8))
* **plugins:** declare modules with no type definitions available ([#139](https://github.com/ObieMunoz/ts-migrate/issues/139)) ([eaf2a5d](https://github.com/ObieMunoz/ts-migrate/commit/eaf2a5d9efafd88a34021edd3df1d8112574f66b))
* **plugins:** repair implicit-any index access in add-conversions ([#141](https://github.com/ObieMunoz/ts-migrate/issues/141)) ([ee6a2d3](https://github.com/ObieMunoz/ts-migrate/commit/ee6a2d3826eb93ccd568cfebbb47dbfc59e40376))
* **ts-migrate-plugins:** derive the react-class-state State type from state usage ([#142](https://github.com/ObieMunoz/ts-migrate/issues/142)) ([3b3fa7e](https://github.com/ObieMunoz/ts-migrate/commit/3b3fa7e17b77660e9d0cae0373bcd91d3738dba7))
* **ts-migrate-plugins:** map instanceOf, exact, elementType, and more oneOf shapes ([#130](https://github.com/ObieMunoz/ts-migrate/issues/130)) ([9390365](https://github.com/ObieMunoz/ts-migrate/commit/93903656244f25b2c5a2ab1f12955695d0328475))





## [0.12.1](https://github.com/ObieMunoz/ts-migrate/compare/v0.12.0...v0.12.1) (2026-07-24)


### Features

* **cli:** skip gitignored files by default ([#118](https://github.com/ObieMunoz/ts-migrate/issues/118)) ([9fa8a85](https://github.com/ObieMunoz/ts-migrate/commit/9fa8a8597487dfea3e10b0e5f9e3ed3328ed92c4))





# [0.12.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.11.1...v0.12.0) (2026-07-24)


### Features

* **cli:** add --dry-run to rename, migrate, and reignore ([#111](https://github.com/ObieMunoz/ts-migrate/issues/111)) ([25dfc68](https://github.com/ObieMunoz/ts-migrate/commit/25dfc68fb5fa8b6edaa9febf96bb9d657b9fb3fc))
* **cli:** add repeatable --exclude-plugin for the default pipeline ([#94](https://github.com/ObieMunoz/ts-migrate/issues/94)) ([758af61](https://github.com/ObieMunoz/ts-migrate/commit/758af61d6d120a9465557711fba90211a6fc8118))
* **cli:** add report and check commands for suppression and any counts ([#105](https://github.com/ObieMunoz/ts-migrate/issues/105)) ([1a4d4e5](https://github.com/ObieMunoz/ts-migrate/commit/1a4d4e52fed0aed15aa4cc91381c32c5d4557021)), closes [#73](https://github.com/ObieMunoz/ts-migrate/issues/73)
* **cli:** cap the report per-file listing at the 10 worst files ([#106](https://github.com/ObieMunoz/ts-migrate/issues/106)) ([2a199ec](https://github.com/ObieMunoz/ts-migrate/commit/2a199ec2ae0f5642b0bfa63f9fb3ef8ef7044fa4))
* **cli:** write a machine-readable run summary with --jsonSummary ([#108](https://github.com/ObieMunoz/ts-migrate/issues/108)) ([ce3d91d](https://github.com/ObieMunoz/ts-migrate/commit/ce3d91deb6e661d8e66a1fc34cc48c29aac1fc66))
* **migrate:** retain ambient .d.ts files when --sources is used ([#90](https://github.com/ObieMunoz/ts-migrate/issues/90)) ([9aa9d55](https://github.com/ObieMunoz/ts-migrate/commit/9aa9d55c5e77fb522ebaa94c45f3f6639c276e71))
* **server:** show progress during long plugin passes ([#112](https://github.com/ObieMunoz/ts-migrate/issues/112)) ([a6ece3d](https://github.com/ObieMunoz/ts-migrate/commit/a6ece3df1bfc47f70eb6dedfea297ec88d6a4c85))
* **ts-migrate:** add --version and -v to the CLI and ts-migrate-full ([#93](https://github.com/ObieMunoz/ts-migrate/issues/93)) ([8b65214](https://github.com/ObieMunoz/ts-migrate/commit/8b65214b54d64f990335ad3329c05b893667ff19))





## [0.11.1](https://github.com/ObieMunoz/ts-migrate/compare/v0.11.0...v0.11.1) (2026-07-24)

**Note:** Version bump only for package ts-migrate





# [0.11.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.10.4...v0.11.0) (2026-07-24)


### Bug Fixes

* **hoist-class-statics:** expand the hoistable-globals whitelist ([#83](https://github.com/ObieMunoz/ts-migrate/issues/83)) ([4cb15b0](https://github.com/ObieMunoz/ts-migrate/commit/4cb15b0e8e1ea0145988aaaae7f3d8688be06745))
* **ts-ignore:** skip un-suppressible diagnostics instead of aborting the file ([#71](https://github.com/ObieMunoz/ts-migrate/issues/71)) ([1dc2423](https://github.com/ObieMunoz/ts-migrate/commit/1dc2423a337744257bcde89ca4cd3a9c8fca2d80))


### Features

* **explicit-any:** cover TS7005 declaration/use-site and TS7023/7024 circular-return implicit anys ([#72](https://github.com/ObieMunoz/ts-migrate/issues/72)) ([54f93db](https://github.com/ObieMunoz/ts-migrate/commit/54f93db83118ac960582bf9babc5570faa410634))
* **reignore:** support --sources for scoped/staged migrations ([#87](https://github.com/ObieMunoz/ts-migrate/issues/87)) ([62837a9](https://github.com/ObieMunoz/ts-migrate/commit/62837a9171efa240f9d53cbe02cebe9da365d9ce))





## [0.10.4](https://github.com/ObieMunoz/ts-migrate/compare/v0.10.3...v0.10.4) (2026-07-21)


### Bug Fixes

* **infer-types:** preserve body-derived annotations when a narrow dispatch parameter causes argument-mismatch errors ([#59](https://github.com/ObieMunoz/ts-migrate/issues/59)) ([e55fc82](https://github.com/ObieMunoz/ts-migrate/commit/e55fc8285977c1980b75af66d47cf322db60f5d6))





## [0.10.3](https://github.com/ObieMunoz/ts-migrate/compare/v0.10.2...v0.10.3) (2026-07-11)

### Bug Fixes

- keep migration output consistent with the project's own tsc check ([#56](https://github.com/ObieMunoz/ts-migrate/issues/56)) ([4d3adf7](https://github.com/ObieMunoz/ts-migrate/commit/4d3adf72db7da1eef64aa3427688a97a358eeb07))

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
