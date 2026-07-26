export class Foo {
  method1() {
    return foobar;
  }

  method2() {
    console.log(baz);

    // comment without ts ignore

    console.log("// @ts-ignore comment in string");

    const str = `
    ${
      dne
    }
    ${var2}
`);

    const result = Object.values(diffs).length
      ? Object.values(diffs)
          .reduce((x, y) => x + y)
          .toFixed(1)
      : 0;

    const str2 = `${var1} (${method.call(
      arg1,
    )} ${var3})`;

    const str3 = foo
      ?        bar
      : baz;
  }

  method3() {
  }

  render() {
    return (
      <div>
        <DNE/>

      </div>
    );
  }
}
