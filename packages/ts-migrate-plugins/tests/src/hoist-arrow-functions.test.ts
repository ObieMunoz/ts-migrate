import { realPluginParams } from '../test-utils';
import hoistArrowFunctionsPlugin from '../../src/plugins/hoist-arrow-functions';

describe('hoist-arrow-functions plugin', () => {
  it('converts arrow functions used before they are defined', async () => {
    const text = `function init() {
  handleClick();
}

const handleClick = () => {
  console.log('click');
};

const notHoisted = () => {
  console.log('later');
};

notHoisted();
`;

    const result = await hoistArrowFunctionsPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`function init() {
  handleClick();
}

function handleClick() {
  console.log('click');
}

const notHoisted = () => {
  console.log('later');
};

notHoisted();
`);
  });

  it('preserves export, async, and type annotations', async () => {
    const text = `export function run() {
  return fetchData('x');
}

export const fetchData = async (id: string): Promise<string> => {
  return id;
};
`;

    const result = await hoistArrowFunctionsPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`export function run() {
  return fetchData('x');
}

export async function fetchData(id: string): Promise<string> {
  return id;
}
`);
  });

  it('converts expression bodies into return statements', async () => {
    const text = `const double = (values: number[]) => values.map(toDouble);

const toDouble = (n: number) => n * 2;
`;

    const result = await hoistArrowFunctionsPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`const double = (values: number[]) => values.map(toDouble);

function toDouble(n: number) {
  return n * 2;
}
`);
  });

  it('parenthesizes single unparenthesized parameters', async () => {
    const text = `logAll();

function logAll() {
  [1, 2].forEach((n) => log(n));
}

const log = n => console.log(n);
`;

    const result = await hoistArrowFunctionsPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`logAll();

function logAll() {
  [1, 2].forEach((n) => log(n));
}

function log(n) {
  return console.log(n);
}
`);
  });

  it('converts components used in JSX before definition', async () => {
    const text = `import React from 'react';

function App() {
  return <Header title="hi" />;
}

const Header = ({ title }: { title: string }) => <h1>{title}</h1>;
`;

    const result = await hoistArrowFunctionsPlugin.run(
      await realPluginParams({ text, fileName: 'file.tsx' }),
    );

    expect(result).toBe(`import React from 'react';

function App() {
  return <Header title="hi" />;
}

function Header({ title }: { title: string }) {
  return <h1>{title}</h1>;
}
`);
  });

  it('converts within nested scopes', async () => {
    const text = `function outer() {
  attach();

  const attach = () => {
    console.log('attached');
  };
}
`;

    const result = await hoistArrowFunctionsPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`function outer() {
  attach();

  function attach() {
    console.log('attached');
  }
}
`);
  });

  it('skips arrows capturing this and variables with type annotations', async () => {
    const text = `function run() {
  helper();
  tracker();
}

const helper: () => void = () => {};

const tracker = () => this.track();
`;

    const result = await hoistArrowFunctionsPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(text);
  });

  it('does not treat shadowing identifiers as uses', async () => {
    const text = `function greet(format: (s: string) => string) {
  return format('hi');
}

const format = (s: string) => s.toUpperCase();
`;

    const result = await hoistArrowFunctionsPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(text);
  });

  it('skips multi-declarator statements', async () => {
    const text = `function run() {
  first();
  second();
}

const first = () => {},
  second = () => {};
`;

    const result = await hoistArrowFunctionsPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(text);
  });

  it('skips block-scoped vars referenced outside the block', async () => {
    const text = `function run() {
  cb();
  if (true) {
    var cb = () => {};
  }
}
`;

    const result = await hoistArrowFunctionsPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(text);
  });

  it('should be idempotent', async () => {
    const text = `function init() {
  handleClick();
}

const handleClick = () => {
  console.log('click');
};
`;

    const firstResult = await hoistArrowFunctionsPlugin.run(await realPluginParams({ text }));
    const secondResult = await hoistArrowFunctionsPlugin.run(
      await realPluginParams({ text: firstResult || '' }),
    );

    expect(secondResult).toBe(firstResult);
  });
});
