# Change Log

All notable changes to this project will be documented in this file.
See [Conventional Commits](https://conventionalcommits.org) for commit guidelines.

## [0.20.2](https://github.com/ObieMunoz/ts-migrate/compare/v0.20.1...v0.20.2) (2026-08-25)


### Bug Fixes

* **ts-migrate-plugins:** leave a returned function's parameters for explicit-any ([#350](https://github.com/ObieMunoz/ts-migrate/issues/350)) ([98f128c](https://github.com/ObieMunoz/ts-migrate/commit/98f128cb18bf4695fb5196cdfdc1d74e2e8fe084))





## [0.20.1](https://github.com/ObieMunoz/ts-migrate/compare/v0.20.0...v0.20.1) (2026-08-07)


### Bug Fixes

* **ts-migrate-plugins:** import a name once where two modules declare it ([#349](https://github.com/ObieMunoz/ts-migrate/issues/349)) ([93460ae](https://github.com/ObieMunoz/ts-migrate/commit/93460aefe3dec6f1777cf091dfda24d6230435cd))
* **ts-migrate-plugins:** write nothing when the imports it adds would not compile ([#348](https://github.com/ObieMunoz/ts-migrate/issues/348)) ([7efa58f](https://github.com/ObieMunoz/ts-migrate/commit/7efa58fe3883cb74ba53f760bfe8a356269b45ca))





# [0.20.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.19.1...v0.20.0) (2026-08-06)


### Bug Fixes

* **ts-migrate-plugins:** write the imports the types it infers need ([#346](https://github.com/ObieMunoz/ts-migrate/issues/346)) ([728866c](https://github.com/ObieMunoz/ts-migrate/commit/728866cd286fcb1e6c049b04bc02f57b1b89c99a))


### Features

* **ts-migrate-plugins:** import the names a file uses instead of suppressing them ([#347](https://github.com/ObieMunoz/ts-migrate/issues/347)) ([0f0e146](https://github.com/ObieMunoz/ts-migrate/commit/0f0e14621ae6fd808238143f58354b359b5d4ecc))
* **ts-migrate-plugins:** strip an import path that names a TypeScript file ([#345](https://github.com/ObieMunoz/ts-migrate/issues/345)) ([596290f](https://github.com/ObieMunoz/ts-migrate/commit/596290ff88710abce819524841a97854d13976a7))





## [0.19.1](https://github.com/ObieMunoz/ts-migrate/compare/v0.19.0...v0.19.1) (2026-07-30)


### Bug Fixes

* **ts-migrate-plugins:** stop the type printer following an array back into itself ([#344](https://github.com/ObieMunoz/ts-migrate/issues/344)) ([808615c](https://github.com/ObieMunoz/ts-migrate/commit/808615ce9f2607922acdd75fb8ac1a2eb37d7821))





# [0.19.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.18.0...v0.19.0) (2026-07-30)


### Features

* **ts-migrate-plugins:** cast a mocked module export to jest.Mock instead of any ([#343](https://github.com/ObieMunoz/ts-migrate/issues/343)) ([fbab330](https://github.com/ObieMunoz/ts-migrate/commit/fbab3304a1be21fffdcab040eddb5d914c8037b6))
* **ts-migrate-plugins:** declare the props a component reads but does not say it takes ([#342](https://github.com/ObieMunoz/ts-migrate/issues/342)) ([bbd60cb](https://github.com/ObieMunoz/ts-migrate/commit/bbd60cbab05201a8b68fcaaf8293a37e9bf43995))





# [0.18.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.17.0...v0.18.0) (2026-07-30)


### Bug Fixes

* **ts-migrate-plugins:** build an object type from tags that name what a destructuring binds ([#331](https://github.com/ObieMunoz/ts-migrate/issues/331)) ([697472d](https://github.com/ObieMunoz/ts-migrate/commit/697472d6b8a275db0019b28beca7a9f66b43a5de))
* **ts-migrate-plugins:** keep the offset of a diagnostic inside a replaced span ([#335](https://github.com/ObieMunoz/ts-migrate/issues/335)) ([831b466](https://github.com/ObieMunoz/ts-migrate/commit/831b466336f4317af1d7af10ecbd929e5b443053))
* **ts-migrate-plugins:** re-point an absolute import left naming a renamed file ([#337](https://github.com/ObieMunoz/ts-migrate/issues/337)) ([c3778ed](https://github.com/ObieMunoz/ts-migrate/commit/c3778ed943b3af5f7144971ef5a15bc36d6e0ff1))
* **ts-migrate-plugins:** restore a value that was imported as a type instead of suppressing it ([#340](https://github.com/ObieMunoz/ts-migrate/issues/340)) ([60b32a8](https://github.com/ObieMunoz/ts-migrate/commit/60b32a8d7d54524e90f8447505197ad68e6e09cd))


### Features

* **ts-migrate-plugins:** declare the globals a project only reads ([#333](https://github.com/ObieMunoz/ts-migrate/issues/333)) ([115b193](https://github.com/ObieMunoz/ts-migrate/commit/115b1939490e541dfb1abd9327396cdf268e3ce9))
* **ts-migrate-plugins:** declare the props a component is passed but does not say it takes ([#336](https://github.com/ObieMunoz/ts-migrate/issues/336)) ([a20bd53](https://github.com/ObieMunoz/ts-migrate/commit/a20bd530d8cc60e6bdbdd8da46925b7ea716da2a))
* **ts-migrate-plugins:** mark a parameter optional where callers already omit it ([#330](https://github.com/ObieMunoz/ts-migrate/issues/330)) ([f3bd54c](https://github.com/ObieMunoz/ts-migrate/commit/f3bd54c6e7c755a1ed00ad988b207829d4acfec8))
* **ts-migrate-plugins:** relax an inferred parameter shape to what the project's calls support ([#334](https://github.com/ObieMunoz/ts-migrate/issues/334)) ([0d3c16f](https://github.com/ObieMunoz/ts-migrate/commit/0d3c16f4e957415965b388c70a649dd07f3d8c6d))
* **ts-migrate-plugins:** type the props a component forwards to the element it wraps ([#332](https://github.com/ObieMunoz/ts-migrate/issues/332)) ([e96e133](https://github.com/ObieMunoz/ts-migrate/commit/e96e13332f21d986f78aad62ad694917343ae938))
* **ts-migrate:** add a retype command that re-infers old any annotations ([#338](https://github.com/ObieMunoz/ts-migrate/issues/338)) ([262b496](https://github.com/ObieMunoz/ts-migrate/commit/262b496b140cb642ff339bf2530ac478a5baa436))
* **ts-migrate:** report the generated declarations the project's ESLint cannot parse ([#339](https://github.com/ObieMunoz/ts-migrate/issues/339)) ([6900ab1](https://github.com/ObieMunoz/ts-migrate/commit/6900ab15c26bed110f443ab5c196a646beffb4b1))





# [0.17.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.16.0...v0.17.0) (2026-07-29)


### Bug Fixes

* **ts-migrate-plugins:** annotate a JSDoc namepath type as any ([#325](https://github.com/ObieMunoz/ts-migrate/issues/325)) ([aa3980f](https://github.com/ObieMunoz/ts-migrate/commit/aa3980f4b1a9f2e0292ff53dd7d53c4a205655c2))
* **ts-migrate-plugins:** find an arrow's parentheses past the async keyword ([#318](https://github.com/ObieMunoz/ts-migrate/issues/318)) ([61a6873](https://github.com/ObieMunoz/ts-migrate/commit/61a68730183cf973c061135e645939db493e70cb))
* **ts-migrate-plugins:** gate the defaultProps helper on the intersection collapsing ([#314](https://github.com/ObieMunoz/ts-migrate/issues/314)) ([ff604fc](https://github.com/ObieMunoz/ts-migrate/commit/ff604fc61cb6564bea0b9f4c0cd333cb23b17d04))
* **ts-migrate-plugins:** keep the types a partly missing destructuring binds ([#329](https://github.com/ObieMunoz/ts-migrate/issues/329)) ([92dcd2b](https://github.com/ObieMunoz/ts-migrate/commit/92dcd2b6bc97acf607a2dfac142bb80324e180b8))
* **ts-migrate-plugins:** recommend [@types](https://github.com/types) for a runner a dependency installed ([#327](https://github.com/ObieMunoz/ts-migrate/issues/327)) ([ae055d8](https://github.com/ObieMunoz/ts-migrate/commit/ae055d85b3f5386bcf2a728c6ba664d74bf5d360))
* **ts-migrate-plugins:** stop add-conversions casting a JSX tag name ([#328](https://github.com/ObieMunoz/ts-migrate/issues/328)) ([b53a02c](https://github.com/ObieMunoz/ts-migrate/commit/b53a02c4aa94e4bb42331fff905dbb3d4f2705c3))
* **ts-migrate-plugins:** stop declaring a global whose name no var can have ([#322](https://github.com/ObieMunoz/ts-migrate/issues/322)) ([0174961](https://github.com/ObieMunoz/ts-migrate/commit/01749616d4e99e2110fa65959c922d05829d2d0f))
* **ts-migrate-plugins:** stop eslint-fix fixing a file forever ([#321](https://github.com/ObieMunoz/ts-migrate/issues/321)) ([4d1fcb5](https://github.com/ObieMunoz/ts-migrate/commit/4d1fcb59bc96b9686263432b60e1b9652cb0ba33))
* **ts-migrate-plugins:** stop jsdoc writing a type that does not parse ([#326](https://github.com/ObieMunoz/ts-migrate/issues/326)) ([385e160](https://github.com/ObieMunoz/ts-migrate/commit/385e16056151c83e6e410ba25e584c4810acb9e8))
* **ts-migrate-plugins:** stop react-shape redeclaring an array shape's type ([#323](https://github.com/ObieMunoz/ts-migrate/issues/323)) ([ac36371](https://github.com/ObieMunoz/ts-migrate/commit/ac363718f5e331a291be293d643842e815174989))


### Features

* **ts-migrate-plugins:** add react-props-from-usage plugin ([#70](https://github.com/ObieMunoz/ts-migrate/issues/70)) ([6ba6469](https://github.com/ObieMunoz/ts-migrate/commit/6ba64691b6be3afa5bc78b837a565edcda342f72))





# [0.16.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.15.0...v0.16.0) (2026-07-26)


### Features

* **cli:** settle the flag casing on camelCase and add a config file ([#299](https://github.com/ObieMunoz/ts-migrate/issues/299)) ([0e59302](https://github.com/ObieMunoz/ts-migrate/commit/0e59302686b9c65252f064809354030890f1c2bc))





# [0.15.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.14.0...v0.15.0) (2026-07-26)


### Bug Fixes

* **ts-migrate-plugins:** collapse the typescript-estree version banner to one line ([#296](https://github.com/ObieMunoz/ts-migrate/issues/296)) ([3797238](https://github.com/ObieMunoz/ts-migrate/commit/3797238c9ff164b035416bd9397d6d8b91b70575))
* **ts-migrate-plugins:** keep the types infer-types can write when one cannot be printed ([#287](https://github.com/ObieMunoz/ts-migrate/issues/287)) ([d824b92](https://github.com/ObieMunoz/ts-migrate/commit/d824b92d05c9237c0f3a198962929d56eaab5fb6))
* **ts-migrate-plugins:** reject overlapping source text updates ([#286](https://github.com/ObieMunoz/ts-migrate/issues/286)) ([f6c1ae0](https://github.com/ObieMunoz/ts-migrate/commit/f6c1ae092305a453f1eff60e5bbdcba79b0b100d))


### Features

* **ts-migrate-plugins:** mark the sites plugins leave for a person, and report them at the end of the run ([#283](https://github.com/ObieMunoz/ts-migrate/issues/283)) ([bf5a98f](https://github.com/ObieMunoz/ts-migrate/commit/bf5a98fb8feec76e533d063524d3aaf2ec0087a0))





# [0.14.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.13.0...v0.14.0) (2026-07-25)


### Bug Fixes

* **cli:** agree on which config files the tool recognizes ([#277](https://github.com/ObieMunoz/ts-migrate/issues/277)) ([bab2760](https://github.com/ObieMunoz/ts-migrate/commit/bab27609c07336e2c26be79f76735dc16bc9af69))
* **cli:** resolve alias declarations by scope rather than by text ([#254](https://github.com/ObieMunoz/ts-migrate/issues/254)) ([7280fd4](https://github.com/ObieMunoz/ts-migrate/commit/7280fd4ba6529559f28fa10a41fe46d0e838c191))
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
* **ts-migrate-plugins:** stop jsdoc writing a second return annotation ([#282](https://github.com/ObieMunoz/ts-migrate/issues/282)) ([d232f49](https://github.com/ObieMunoz/ts-migrate/commit/d232f497f54ae657595e67f1ea9f8cec75501609))


### Features

* **cli:** add the annotateReturns flag for the jsdoc plugin ([#195](https://github.com/ObieMunoz/ts-migrate/issues/195)) ([ed58f63](https://github.com/ObieMunoz/ts-migrate/commit/ed58f6376d6e387a545310bf604bce2a918427a3))
* **cli:** retry the any assertions add-conversions inserted ([#214](https://github.com/ObieMunoz/ts-migrate/issues/214)) ([bc356bf](https://github.com/ObieMunoz/ts-migrate/commit/bc356bfb7fa07c47572c15dc55703cce5d5a701c))
* **cli:** run the jsdoc plugin in the default pipeline ([#247](https://github.com/ObieMunoz/ts-migrate/issues/247)) ([37c0e67](https://github.com/ObieMunoz/ts-migrate/commit/37c0e6736d1753abf6f13d90ddbb144c8ba42c5d))
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

**Note:** Version bump only for package @obiemunoz/ts-migrate-plugins





# [0.12.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.11.1...v0.12.0) (2026-07-24)

**Note:** Version bump only for package @obiemunoz/ts-migrate-plugins





# [0.11.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.10.4...v0.11.0) (2026-07-24)


### Bug Fixes

* **hoist-class-statics:** expand the hoistable-globals whitelist ([#83](https://github.com/ObieMunoz/ts-migrate/issues/83)) ([4cb15b0](https://github.com/ObieMunoz/ts-migrate/commit/4cb15b0e8e1ea0145988aaaae7f3d8688be06745))
* **ts-ignore:** skip un-suppressible diagnostics instead of aborting the file ([#71](https://github.com/ObieMunoz/ts-migrate/issues/71)) ([1dc2423](https://github.com/ObieMunoz/ts-migrate/commit/1dc2423a337744257bcde89ca4cd3a9c8fca2d80))


### Features

* **explicit-any:** cover TS7005 declaration/use-site and TS7023/7024 circular-return implicit anys ([#72](https://github.com/ObieMunoz/ts-migrate/issues/72)) ([54f93db](https://github.com/ObieMunoz/ts-migrate/commit/54f93db83118ac960582bf9babc5570faa410634))





## [0.10.4](https://github.com/ObieMunoz/ts-migrate/compare/v0.10.3...v0.10.4) (2026-07-21)


### Bug Fixes

* **infer-types:** preserve body-derived annotations when a narrow dispatch parameter causes argument-mismatch errors ([#59](https://github.com/ObieMunoz/ts-migrate/issues/59)) ([e55fc82](https://github.com/ObieMunoz/ts-migrate/commit/e55fc8285977c1980b75af66d47cf322db60f5d6))





## [0.10.3](https://github.com/ObieMunoz/ts-migrate/compare/v0.10.2...v0.10.3) (2026-07-11)

### Bug Fixes

- keep migration output consistent with the project's own tsc check ([#56](https://github.com/ObieMunoz/ts-migrate/issues/56)) ([4d3adf7](https://github.com/ObieMunoz/ts-migrate/commit/4d3adf72db7da1eef64aa3427688a97a358eeb07))

## [0.10.2](https://github.com/ObieMunoz/ts-migrate/compare/v0.10.1...v0.10.2) (2026-07-11)

### Performance Improvements

- parallelize eslint-fix across an adaptive worker thread pool ([#52](https://github.com/ObieMunoz/ts-migrate/issues/52)) ([8a923e3](https://github.com/ObieMunoz/ts-migrate/commit/8a923e31170ba1e372be9321337da93c8460730b))

## [0.10.1](https://github.com/ObieMunoz/ts-migrate/compare/v0.10.0...v0.10.1) (2026-07-11)

**Note:** Version bump only for package @obiemunoz/ts-migrate-plugins

# [0.10.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.9.2...v0.10.0) (2026-07-11)

**Note:** Version bump only for package @obiemunoz/ts-migrate-plugins

## [0.9.2](https://github.com/ObieMunoz/ts-migrate/compare/v0.9.1...v0.9.2) (2026-07-11)

### Bug Fixes

- **ts-migrate:** surface [@types](https://github.com/types) recommendations at the end of ts-migrate-full ([#47](https://github.com/ObieMunoz/ts-migrate/issues/47)) ([7d98851](https://github.com/ObieMunoz/ts-migrate/commit/7d98851103192ad18969b51301dfb24122059c68))

## [0.9.1](https://github.com/ObieMunoz/ts-migrate/compare/v0.9.0...v0.9.1) (2026-07-11)

### Performance Improvements

- **ts-migrate:** share module resolution caches and memoized fs across programs ([#46](https://github.com/ObieMunoz/ts-migrate/issues/46)) ([ff643cf](https://github.com/ObieMunoz/ts-migrate/commit/ff643cfd056f78e00770a833498997b948ba66a6))

# [0.9.0](https://github.com/ObieMunoz/ts-migrate/compare/v0.8.0...v0.9.0) (2026-07-10)

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
