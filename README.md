# @obiemunoz/ts-migrate

> **A maintained fork of [airbnb/ts-migrate](https://github.com/airbnb/ts-migrate), updated for TypeScript 5 and 6.**
> Maintained by [Obie Munoz](https://github.com/ObieMunoz). Original work © 2020 Airbnb (MIT) — see [Credits](#credits).

*ts-migrate* is a tool for helping migrate code to TypeScript.
It takes a JavaScript, or a partial TypeScript, project in and gives a compiling TypeScript project out.

*ts-migrate* is intended to accelerate the TypeScript migration process. The resulting code will pass the build, but a followup is required to improve type safety. There will be lots of `// @ts-expect-error`, and `any` that will need to be fixed over time. In general, it is a lot nicer than starting from scratch.

*ts-migrate* is designed as a set of plugins so that it can be pretty customizable for different use-cases. Potentially, more plugins can be added for addressing things like improvements of type quality or libraries-related things (like prop-types in React).

Plugins are combined into migration configs. We currently have two main migration configs:

* for the main JavaScript → TypeScript migration
* for the reignore command

These configs can be moved out of the default script, and people can add custom configs with a different set of plugins for their needs.

You can find instructions on how to install and run ts-migrate in the [main package](./packages/ts-migrate/). If you find any [issues](https://github.com/ObieMunoz/ts-migrate/issues) or have ideas for improvements, we welcome your [contributions](https://github.com/ObieMunoz/ts-migrate/blob/master/CONTRIBUTING.md)!

Check out Airbnb's original [blog post](https://medium.com/airbnb-engineering/ts-migrate-a-tool-for-migrating-to-typescript-at-scale-cd23bfeb5cc) about ts-migrate!


# What's different in this fork

* TypeScript 5.x and 6.x support (upstream tops out at TypeScript 4)
* Plugin internals migrated to the TypeScript 5 node factory API
* ESLint 9 flat config support (with legacy fallback)
* Works on plain JS projects out of the box: no local TypeScript install required, and `init` writes a migration-friendly tsconfig instead of shelling out to `tsc --init`
* Agent-ready: `ts-migrate agents` prints a usage playbook for AI coding agents, `ts-migrate-full --yes --no-commit` runs the whole pipeline non-interactively without touching git, and `--jsonSummary` writes a machine-readable summary of what a run changed
* Updated toolchain (Jest 29, modern dependencies)

Upstream airbnb/ts-migrate has been unmaintained since 2022; this fork exists to keep the tool working on current TypeScript.


# Published Packages

| Folder | Package |
| ------ | ------- |
| [packages/ts-migrate](./packages/ts-migrate/) | [@obiemunoz/ts-migrate](https://www.npmjs.com/package/@obiemunoz/ts-migrate) |
| [packages/ts-migrate-plugins](./packages/ts-migrate-plugins/) | [@obiemunoz/ts-migrate-plugins](https://www.npmjs.com/package/@obiemunoz/ts-migrate-plugins) |
| [packages/ts-migrate-server](./packages/ts-migrate-server/) | [@obiemunoz/ts-migrate-server](https://www.npmjs.com/package/@obiemunoz/ts-migrate-server) |

# Unpublished Packages

| Folder | Description |
| ------ | -----------|
| [packages/ts-migrate-example](./packages/ts-migrate-example/) | basic example of usage of the ts-migrate-server with a writing a custom simple plugin |


# Maintainer

<table>
  <tbody>
    <tr>
      <td align="center" valign="top">
        <img width="100" height="100" src="https://github.com/ObieMunoz.png?s=150">
        <br>
        <a href="https://github.com/ObieMunoz">Obie Munoz</a>
      </td>
    </tr>
  </tbody>
</table>


# Credits

*ts-migrate* was created at [Airbnb](https://github.com/airbnb) and released under the MIT license. This fork builds on the work of the original authors:

<table>
  <tbody>
    <tr>
      <td align="center" valign="top">
        <img width="100" height="100" src="https://github.com/brieb.png?s=150">
        <br>
        <a href="https://github.com/brieb">Brie Bunge</a>
      </td>
      <td align="center" valign="top">
        <img width="100" height="100" src="https://github.com/Rudeg.png?s=150">
        <br>
        <a href="https://github.com/Rudeg">Sergii Rudenko</a>
      </td>
      <td align="center" width="20%" valign="top">
        <img width="100" height="100" src="https://github.com/jjjjhhhhhh.png?s=150">
        <br>
        <a href="https://github.com/jjjjhhhhhh">John Haytko</a>
      </td>
      <td align="center" valign="top">
        <img width="100" height="100" src="https://github.com/elliotsa.png?s=150">
        <br>
        <a href="https://github.com/elliotsa">Elliot Sachs</a>
      </td>
      <td align="center" valign="top">
        <img width="100" height="100" src="https://github.com/lencioni.png?s=150">
        <br>
        <a href="https://github.com/lencioni">Joe Lencioni</a>
     </tr>
  </tbody>
</table>


# License

MIT, see [LICENSE](./LICENSE) for details. Original work copyright © 2020 Airbnb; modifications copyright © 2026 Obie Munoz.
