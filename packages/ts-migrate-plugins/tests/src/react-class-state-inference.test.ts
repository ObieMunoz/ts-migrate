import ts from 'typescript';
import { realPluginRunner } from '../test-utils';
import reactClassStatePlugin from '../../src/plugins/react-class-state';

/**
 * The checker-backed half of react-class-state: every case here is one the
 * plugin has nothing but `any` to say about from the syntax alone. What the
 * plugin does with and without a program is covered case for case by
 * react-class-state.test.ts, which runs each of its inputs through both.
 */
const runPlugin = realPluginRunner(reactClassStatePlugin, {
  fileName: 'Foo.tsx',
  // A target whose lib declares what a component of this era uses, so that a
  // name the checker prints is a name the file is entitled to write.
  compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
  options: { anyAlias: '$TSFixMe' },
});

/**
 * The state alias out of the file the plugin returned. Asserting on the whole
 * of it is what catches a member the input gave no reason to write.
 */
function stateAlias(result: string | undefined): string {
  return /^type \w*State\d* = (?:\{[\s\S]*?\n\}|[^\n{]+);$/m.exec(result ?? '')?.[0] ?? '';
}

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

    expect(stateAlias(result)).toBe(`type State = {
    tags: string[];
};`);
  });

  it('parenthesizes an array element two observations disagree about', async () => {
    const result = await runPlugin(`import React from 'react';

declare function makeError(): Error;
declare function makeDate(): Date;

class Foo extends React.Component {
  state = { entries: [makeError(), makeDate()] };

  render() {
    return <div>{this.state.entries.length}</div>;
  }
}

export default Foo;
`);

    // The union is the element type, not the member type: written unparenthesized
    // the member would be `Error` or an array of `Date`.
    expect(stateAlias(result)).toBe(`type State = {
    entries: (Error | Date)[];
};`);
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

    // Everything the initializer sets is set on every path, so nothing is optional.
    expect(stateAlias(result)).toBe(`type State = {
    mins: string;
    secs: string;
};`);
  });

  it('reads the properties of a non-literal state initializer, not its methods', async () => {
    const result = await runPlugin(`import React from 'react';

class StateBag {
  open = false;

  toggle() {
    this.open = !this.open;
  }
}

class Foo extends React.Component {
  constructor(props: object) {
    super(props);
    this.state = new StateBag();
  }

  render() {
    return <div>{this.state.open}</div>;
  }
}

export default Foo;
`);

    // `toggle` is what the component calls, not something it holds.
    expect(stateAlias(result)).toBe(`type State = {
    open: boolean;
};`);
  });

  it('leaves a member optional that the state the initializer returns does not set', async () => {
    const result = await runPlugin(`import React from 'react';

function getStateFromProps(): { mins: string; secs?: string } {
  return { mins: '0' };
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

    // Written required, `secs` would reject the very assignment it was read
    // from. The `?` says what the checker's `| undefined` says, so only one of
    // the two is written.
    expect(stateAlias(result)).toBe(`type State = {
    mins: string;
    secs?: string;
};`);
  });

  it('reads a this.state.key assignment, and marks it optional outside the constructor', async () => {
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

    // The write is the only evidence of the type, but it has not run yet at the
    // point the initializer sets everything else.
    expect(stateAlias(result)).toBe(`type State = {
    open: boolean;
    timer?: number;
};`);
  });

  it('does not mark a conditional constructor write as always set', async () => {
    const result = await runPlugin(`import React from 'react';

function makeTimer(): number {
  return 0;
}

class Foo extends React.Component {
  constructor(props: { withTimer: boolean }) {
    super(props);
    this.state = { open: false };
    if (props.withTimer) {
      this.state.timer = makeTimer();
    }
  }

  render() {
    return <div>{this.state.open}</div>;
  }
}

export default Foo;
`);

    expect(stateAlias(result)).toBe(`type State = {
    open: boolean;
    timer?: number;
};`);
  });

  it('marks an unconditional constructor write as always set', async () => {
    const result = await runPlugin(`import React from 'react';

function makeTimer(): number {
  return 0;
}

class Foo extends React.Component {
  constructor(props: object) {
    super(props);
    this.state = { open: false };
    this.state.timer = makeTimer();
  }

  render() {
    return <div>{this.state.open}</div>;
  }
}

export default Foo;
`);

    expect(stateAlias(result)).toBe(`type State = {
    open: boolean;
    timer: number;
};`);
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
      { compilerOptions: { jsx: ts.JsxEmit.React, strict: false } },
    );

    expect(stateAlias(result)).toBe(`type State = {
    mins: string;
};`);
  });

  it('keeps that initial type when there is no any alias to spell it with', async () => {
    // The alias is not configured unless the run asks for it, and a member the
    // checker cannot type is the checker saying nothing either way.
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
        compilerOptions: { jsx: ts.JsxEmit.React, strict: false },
        options: {},
      },
    );

    expect(stateAlias(result)).toBe(`type State = {
    mins: string;
};`);
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

    expect(stateAlias(result)).toBe(`type State = {
    mins: string;
};`);
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
      { extraFiles: { 'lib.ts': lib } },
    );

    expect(stateAlias(result)).toBe(`type State = {
    timer: Timer;
};`);
    expect(result).toMatch(/import \{ Timer \} from ["'].*lib["']/);
  });

  it('writes a member type the file already has a name for', async () => {
    const lib = `export default class Notification {
  level = 0;
}
export declare function makeNotification(): Notification;
`;
    const result = await runPlugin(
      `import React from 'react';
import Notification, { makeNotification } from '/lib';

class Foo extends React.Component {
  state = { note: makeNotification() };

  render() {
    return <div>{this.state.note.level}</div>;
  }
}

export default Foo;
`,
      { extraFiles: { 'lib.ts': lib } },
    );

    expect(stateAlias(result)).toBe(`type State = {
    note: Notification;
};`);
    // The default import the file already has is the name, and a named import
    // of it would not be.
    expect(result).not.toContain('{ Notification }');
  });

  it('refuses a member whose type only shares a name with what the file has', async () => {
    // Written `Timer`, the member would read as the file's own Timer, and the
    // import that would make it the other one cannot be added beside it.
    const lib = `export type Timer = { id: number };
export declare function makeTimer(): Timer;
`;
    const result = await runPlugin(
      `import React from 'react';
import { makeTimer } from '/lib';

type Timer = { tag: string };

class Foo extends React.Component {
  state = { timer: makeTimer() };

  render() {
    return <div>{this.state.timer.id}</div>;
  }
}

export default Foo;
`,
      { extraFiles: { 'lib.ts': lib } },
    );

    expect(stateAlias(result)).toBe(`type State = {
    timer: ReturnType<typeof makeTimer>;
};`);
  });

  it('refuses a member whose type shares a name with one an earlier member imported', async () => {
    const lib = `export type Timer = { id: number };
export declare function makeTimer(): Timer;
`;
    const other = `export function makeOtherTimer() {
  interface Timer {
    tag: string;
  }
  const timer: Timer = { tag: '' };
  return timer;
}
`;
    const result = await runPlugin(
      `import React from 'react';
import { makeTimer } from '/lib';
import { makeOtherTimer } from '/other';

class Foo extends React.Component {
  state = { timer: makeTimer(), other: makeOtherTimer() };

  render() {
    return <div>{this.state.timer.id}{this.state.other.tag}</div>;
  }
}

export default Foo;
`,
      { extraFiles: { 'lib.ts': lib, 'other.ts': other } },
    );

    // `other` is a different Timer, and the import the first member added is
    // not a name for it.
    expect(stateAlias(result)).toBe(`type State = {
    timer: Timer;
    other: ReturnType<typeof makeOtherTimer>;
};`);
  });

  it('names the alias around an import a member needed', async () => {
    const lib = `export type State = { id: number };
export declare function makeState(): State;
`;
    const result = await runPlugin(
      `import React from 'react';
import { makeState } from '/lib';

class Foo extends React.Component {
  state = { value: makeState() };

  render() {
    return <div>{this.state.value.id}</div>;
  }
}

export default Foo;
`,
      { extraFiles: { 'lib.ts': lib } },
    );

    // The import is added after the file's identifiers were read, so the alias
    // has to be named around it or the two collide.
    expect(stateAlias(result)).toBe(`type State1 = {
    value: State;
};`);
    expect(result).toMatch(/import \{ State \} from ["'].*lib["']/);
  });

  it('refuses a member type the file has no way to name', async () => {
    // A type declared inside a function is not exported from anywhere, so
    // nothing can be imported for it. Written out, the member would spell a
    // name the file does not have.
    const lib = `export function makeTimer() {
  interface Timer {
    id: number;
  }
  const timer: Timer = { id: 0 };
  return timer;
}
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
      { extraFiles: { 'lib.ts': lib } },
    );

    // The call the type came out of is still a name this file has.
    expect(stateAlias(result)).toBe(`type State = {
    timer: ReturnType<typeof makeTimer>;
};`);
    expect(result).not.toContain('{ Timer }');
  });

  it('writes any where the type cannot be named and neither can the expression', async () => {
    const lib = `export function makeTimer() {
  interface Timer {
    id: number;
  }
  const timer: Timer = { id: 0 };
  return timer;
}
`;
    const result = await runPlugin(
      `import React from 'react';
import { makeTimer } from '/lib';

class Foo extends React.Component {
  state = { open: false };

  componentDidMount() {
    const timer = makeTimer();
    this.state.timer = timer;
  }

  render() {
    return <div>{this.state.open}</div>;
  }
}

export default Foo;
`,
      { extraFiles: { 'lib.ts': lib } },
    );

    expect(stateAlias(result)).toBe(`type State = {
    open: boolean;
    timer?: $TSFixMe;
};`);
  });

  it('writes a union too wide for typeToString to print by default', async () => {
    // Left to its default flags typeToString cuts this off with `... N more ...`,
    // which is not syntax. The length is a display limit, not a limit on what
    // the checker can say, so the member is written out in full.
    const names = Array.from({ length: 30 }, (_, i) => `Member${i}`);
    const lib = `${names.map((name) => `export type ${name} = { ${name}: number };`).join('\n')}
export declare function makeWide(): ${names.join(' | ')};
`;
    const result = await runPlugin(
      `import React from 'react';
import { makeWide } from '/lib';

class Foo extends React.Component {
  state = { value: makeWide() };

  render() {
    return <div>{this.state.value}</div>;
  }
}

export default Foo;
`,
      { extraFiles: { 'lib.ts': lib } },
    );

    expect(result).not.toContain('...');
    names.forEach((name) => expect(result).toContain(name));
  });

  it('names a call whose type cannot be written as ReturnType of the callee', async () => {
    // An anonymous object type is not something buildTypeNode reconstructs at
    // any length, but the function it came out of is in scope in this file.
    const result = await runPlugin(`import React from 'react';

declare function makeConfig(): { retries: number; onError: (e: Error) => void };

class Foo extends React.Component {
  state = { config: makeConfig() };

  render() {
    return <div>{this.state.config.retries}</div>;
  }
}

export default Foo;
`);

    expect(stateAlias(result)).toBe(`type State = {
    config: ReturnType<typeof makeConfig>;
};`);
  });

  it('names a module-scoped binding whose type cannot be written', async () => {
    const result = await runPlugin(`import React from 'react';

declare const defaultConfig: { retries: number; onError: (e: Error) => void };

class Foo extends React.Component {
  state = { config: defaultConfig };

  render() {
    return <div>{this.state.config.retries}</div>;
  }
}

export default Foo;
`);

    expect(stateAlias(result)).toBe(`type State = {
    config: typeof defaultConfig;
};`);
  });

  it('keeps a string literal type whose text is the any keyword', async () => {
    // The keyword is rewritten to the alias so that a checker-produced `any[]`
    // dedupes against the `$TSFixMe[]` an empty array literal derives. Inside a
    // literal it is a string the component compares against, not a type.
    const result = await runPlugin(`import React from 'react';

declare function getModes(): Set<'any' | 'all'>;

class Foo extends React.Component {
  state = { modes: getModes() };

  render() {
    return <div>{this.state.modes.size}</div>;
  }
}

export default Foo;
`);

    expect(stateAlias(result)).toBe(`type State = {
    modes: Set<"any" | "all">;
};`);
  });

  it('leaves a name the state alias cannot see as the any alias', async () => {
    // `local` is a name only the method body has, and the alias is written at
    // the top of the file, so there is nothing to query.
    const result = await runPlugin(`import React from 'react';

declare function makeConfig(): { retries: number; onError: (e: Error) => void };

class Foo extends React.Component {
  state = { open: false };

  componentDidMount() {
    const local = makeConfig();
    this.state.config = local;
  }

  render() {
    return <div>{this.state.open}</div>;
  }
}

export default Foo;
`);

    expect(stateAlias(result)).toBe(`type State = {
    open: boolean;
    config?: $TSFixMe;
};`);
  });
});
