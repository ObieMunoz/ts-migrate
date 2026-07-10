import { realPluginParams } from '../test-utils';
import hoistDeclarationsPlugin from '../../src/plugins/hoist-declarations';

describe('hoist-declarations plugin', () => {
  it('relocates an HOC-wrapped component used before it is defined', async () => {
    const text = `import React from 'react';
import Widget from './Widget';
import { connect } from './store';

const Panel = ({ items }) => {
  return (
    <div>
      <ConnectedWidget items={items} />
    </div>
  );
};

const ConnectedWidget = connect(Widget, (state) => ({
  total: state.total,
  visible: state.visible,
}));

export default Panel;
`;

    const result = await hoistDeclarationsPlugin.run(
      await realPluginParams({ text, fileName: 'file.tsx' }),
    );

    expect(result).toBe(`import React from 'react';
import Widget from './Widget';
import { connect } from './store';

const ConnectedWidget = connect(Widget, (state) => ({
  total: state.total,
  visible: state.visible,
}));

const Panel = ({ items }) => {
  return (
    <div>
      <ConnectedWidget items={items} />
    </div>
  );
};

export default Panel;
`);
  });

  it('carries a comment glued directly above the declaration', async () => {
    const text = `import React from 'react';

function App() {
  return <ConnectedWidget />;
}

// connects the widget to the store
const ConnectedWidget = connect(Widget);

export default App;
`;

    const result = await hoistDeclarationsPlugin.run(
      await realPluginParams({ text, fileName: 'file.tsx' }),
    );

    expect(result).toBe(`import React from 'react';

// connects the widget to the store
const ConnectedWidget = connect(Widget);

function App() {
  return <ConnectedWidget />;
}

export default App;
`);
  });

  it('leaves declarations that are only used after their definition', async () => {
    const text = `const ConnectedWidget = connect(Widget);

const Panel = () => <ConnectedWidget />;
`;

    const result = await hoistDeclarationsPlugin.run(
      await realPluginParams({ text, fileName: 'file.tsx' }),
    );

    expect(result).toBe(text);
  });

  it('skips relocation that would cross one of its own dependencies', async () => {
    const text = `function render() {
  return build();
}

const config = { size: 1 };

const build = () => config.size;
`;

    const result = await hoistDeclarationsPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(text);
  });

  it('skips multi-declarator statements', async () => {
    const text = `const consumer = () => a + b;

const a = 1,
  b = 2;
`;

    const result = await hoistDeclarationsPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(text);
  });

  it('skips var, which is function-scoped and hoists on its own', async () => {
    const text = `function run() {
  return cb();
}

var cb = createCallback();
`;

    const result = await hoistDeclarationsPlugin.run(await realPluginParams({ text }));

    // No candidates at all: the plugin short-circuits with undefined (no change).
    expect(result ?? text).toBe(text);
  });

  it('does not treat a shadowing parameter as a use', async () => {
    const text = `function render(ConnectedWidget: unknown) {
  return ConnectedWidget;
}

const ConnectedWidget = connect(Widget);
`;

    const result = await hoistDeclarationsPlugin.run(
      await realPluginParams({ text, fileName: 'file.tsx' }),
    );

    expect(result).toBe(text);
  });

  it('should be idempotent', async () => {
    const text = `const Panel = ({ items }) => {
  return <ConnectedWidget items={items} />;
};

const ConnectedWidget = connect(Widget, (state) => state);

export default Panel;
`;

    const firstResult = await hoistDeclarationsPlugin.run(
      await realPluginParams({ text, fileName: 'file.tsx' }),
    );
    const secondResult = await hoistDeclarationsPlugin.run(
      await realPluginParams({ text: firstResult || '', fileName: 'file.tsx' }),
    );

    expect(secondResult).toBe(firstResult);
  });
});
