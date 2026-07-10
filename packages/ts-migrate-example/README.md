# ts-migrate-example

`ts-migrate-example` is a basic example of usage of the [ts-migrate-server](https://github.com/ObieMunoz/ts-migrate/tree/master/packages/ts-migrate-server) with writing a custom plugin.

### We have examples of the two categories of plugins:

- [example-plugin-text](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-example/src/example-plugin-text.ts) will add a `console.log` before each return statement.

- [example-plugin-ts](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-example/src/example-plugin-ts.ts) is a simple TypeScript AST-based plugin, which shows how we can add simple types to the JavaScript code with the usage of [TypeScript compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API).

We're using the following input:

```javascript
function mult(first, second) {
    return first * second;
}
```

and with a [config of 2 simple plugins](https://github.com/ObieMunoz/ts-migrate/blob/master/packages/ts-migrate-example/src/index.ts#L11), produce the output:

```typescript
function mult(first: number, second: number): number {
    console.log(`args: ${arguments}`)
return first * second;
}
```

You can read about codemods [here](https://medium.com/@cpojer/effective-javascript-codemods-5a6686bb46fb) and browse [ts-migrate repository](https://github.com/ObieMunoz/ts-migrate) for additional examples and tests.

# I have an issue, what should I do?

Please file the issue [here](https://github.com/ObieMunoz/ts-migrate/issues/new).

# Contributing

See the [Contributors Guide](https://github.com/ObieMunoz/ts-migrate/blob/master/CONTRIBUTING.md).
