import { realPluginRunner } from '../test-utils';
import reactClassStatePlugin from '../../src/plugins/react-class-state';

/**
 * The checker-backed half of react-class-state. The syntactic half is covered
 * by react-class-state.test.ts, whose mock params hand the plugin no program:
 * everything here is a case that has nothing but `any` to say without one.
 */
const runPlugin = realPluginRunner(reactClassStatePlugin, {
  fileName: 'Foo.tsx',
  compilerOptions: { jsx: 2 /* React */ },
  options: { anyAlias: '$TSFixMe' },
});

describe('react-class-state plugin, what the checker resolves', () => {
  it('resolves a member initialized by a call', async () => {
    const result = await runPlugin(`import React from 'react';

function getTags(id: number): string[] {
  return [String(id)];
}

class Foo extends React.Component {
  state = { tags: getTags(1) };

  render() {
    return <div>{this.state.tags.length}</div>;
  }
}

export default Foo;
`);

    expect(result).toContain('tags: string[]');
  });

  it('enumerates a state initializer that is not an object literal', async () => {
    const result = await runPlugin(`import React from 'react';

function getStateFromProps(): { mins: string; secs: string } {
  return { mins: '0', secs: '0' };
}

class Foo extends React.Component {
  constructor(props: object) {
    super(props);
    this.state = getStateFromProps();
  }

  render() {
    return <div>{this.state.mins}</div>;
  }
}

export default Foo;
`);

    expect(result).toContain('mins: string;');
    expect(result).toContain('secs: string;');
    // Everything the initializer sets is set on every path, so nothing is optional.
    expect(result).not.toContain('?:');
  });

  it('reads a this.state.key assignment, and does not mark it optional', async () => {
    const result = await runPlugin(`import React from 'react';

function makeTimer(): number {
  return 0;
}

class Foo extends React.Component {
  state = { open: false };

  componentDidMount() {
    this.state.timer = makeTimer();
  }

  render() {
    return <div>{this.state.open}</div>;
  }
}

export default Foo;
`);

    expect(result).toContain('open: boolean;');
    expect(result).toContain('timer: number;');
  });

  it('keeps the initial type of a member a setState shorthand observes as any', async () => {
    // At migrate time the source has only just stopped being .jsx, so the
    // parameter the shorthand names is still implicitly any. The `string` the
    // initial state proves has to survive that.
    const result = await runPlugin(
      `import React from 'react';

class Foo extends React.Component {
  state = { mins: '0' };

  updateMins(mins) {
    this.setState({ mins });
  }

  render() {
    return <div>{this.state.mins}</div>;
  }
}

export default Foo;
`,
      {
        fileName: 'Foo.tsx',
        compilerOptions: { jsx: 2, strict: false },
        options: { anyAlias: '$TSFixMe' },
      },
    );

    expect(result).toContain('mins: string;');
  });

  it('resolves a shorthand naming a typed binding', async () => {
    const result = await runPlugin(`import React from 'react';

class Foo extends React.Component {
  updateMins(mins: string) {
    this.setState({ mins });
  }

  render() {
    return <div>{this.state.mins}</div>;
  }
}

export default Foo;
`);

    expect(result).toContain('mins: string;');
  });

  it('imports the names a resolved member type spells', async () => {
    const lib = `
export type Timer = { id: number };
export declare function makeTimer(): Timer;
`;
    const result = await runPlugin(
      `import React from 'react';
import { makeTimer } from '/lib';

class Foo extends React.Component {
  state = { timer: makeTimer() };

  render() {
    return <div>{this.state.timer.id}</div>;
  }
}

export default Foo;
`,
      {
        fileName: 'Foo.tsx',
        compilerOptions: { jsx: 2 },
        options: { anyAlias: '$TSFixMe' },
        extraFiles: { 'lib.ts': lib },
      },
    );

    expect(result).toContain('timer: Timer;');
    expect(result).toMatch(/import \{ Timer \} from ["'].*lib["']/);
  });

  it('falls back to the any alias for a type too large to print', async () => {
    // typeToString truncates a wide union with `...`, which is not syntax. The
    // member has to read as the alias rather than be spliced in as text.
    const members = Array.from({ length: 40 }, (_, i) => `  m${i}: '${i}';`).join('\n');
    const result = await runPlugin(`import React from 'react';

type Wide = {
${members}
};

declare function makeWide(): Wide[keyof Wide];

class Foo extends React.Component {
  state = { value: makeWide() };

  render() {
    return <div>{this.state.value}</div>;
  }
}

export default Foo;
`);

    expect(result).not.toContain('...');
    expect(result).toContain('value: ');
  });
});
