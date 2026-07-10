# @obiemunoz/ts-migrate-server

`ts-migrate-server` is a package that contains the main migration runner.

> **This is a maintained fork of [airbnb/ts-migrate](https://github.com/airbnb/ts-migrate), updated for TypeScript 5 and 6.** Original work © 2020 Airbnb (MIT).

> Most users should start with [`@obiemunoz/ts-migrate`](https://www.npmjs.com/package/@obiemunoz/ts-migrate), the CLI that drives this package. Install this package directly only if you're composing a custom migration pipeline.

`ts-migrate-server` was originally designed around Airbnb projects. Use at your own risk.

# Install

Install *@obiemunoz/ts-migrate-server* using [npm](https://www.npmjs.com):

`npm install --save-dev @obiemunoz/ts-migrate-server`

Or [yarn](https://yarnpkg.com):

`yarn add --dev @obiemunoz/ts-migrate-server`


# Usage

```typescript
import path from 'path';
import { migrate, MigrateConfig } from '@obiemunoz/ts-migrate-server';

// get input files folder
const inputDir = path.resolve(__dirname, 'input');

// create new migration config. You can add your plugins there
const config = new MigrateConfig();

// run migration
const { exitCode } = await migrate({ rootDir: inputDir, config });

process.exit(exitCode);
```

# FAQ

> How can I use *ts-migrate-server*?

The [basic usage example](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-example/src/index.ts#L2) is the quickest way in. After that, the best reference is the [source of the ts-migrate CLI](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate/cli.ts) itself, since the CLI is just a consumer of this package: it builds a `MigrateConfig` out of plugins and hands it to `migrate`.

> Why a server instead of standalone codemods?

Standalone codemods each pay their own setup cost: parse the project, build a program, apply changes, repeat. The server does that once and shares it. Plugins get the parsed `SourceFile` and a language service backed by one shared program, updates are applied in memory between plugins, and files only hit disk at the end. That's what makes a 19-plugin pipeline practical; the plugins that need type information (like type inference against usage) would be far too slow re-creating a program per plugin per file.

> Which TypeScript versions does it work with?

The peer range is `>=5.0 <7`, same as the rest of the fork. The compiler is a peer dependency on purpose: the program it builds should be the one your project compiles with, not whatever happened to be bundled here. Version-skew between "the compiler that parses" and "the compiler that reads the AST" is a class of bug I've been bitten by once already, and once was plenty.

> I have an issue, what should I do?

Please file an [issue](https://github.com/ObieMunoz/ts-migrate/issues/new) with the smallest reproduction you can manage.

# Contributing

See the [Contributors Guide](https://github.com/ObieMunoz/ts-migrate/blob/master/CONTRIBUTING.md).
