import { run, runAs } from './react-props-from-usage.harness';

describe('react-props-from-usage plugin, what it infers', () => {
  describe('basic skip conditions', () => {
    it('returns undefined for non-tsx files', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
`;
      const result = await runAs('Foo.ts', text);
      expect(result).toBeUndefined();
    });

    it('skips a component that already has a props type argument', async () => {
      const text = `import React from 'react';
type Props = { name: string };
class Foo extends React.Component<Props> {
  render() { return null; }
}
`;
      expect(await run(text)).toBeUndefined();
    });

    it('skips a component with no this.props usage and no call sites', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return <div />; }
}
`;
      expect(await run(text)).toBeUndefined();
    });
  });

  describe('this.props body analysis only', () => {
    it('infers a required prop from this.props usage in the body', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return <div>{this.props.name}</div>; }
}
`;
      const result = await run(text);
      expect(result).toContain('type Props = {');
      expect(result).toContain('name: any');
      expect(result).toContain('class Foo extends React.Component<Props>');
    });

    it('marks a prop optional when the prop itself is optionally chained', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return <div>{this.props.label?.length}</div>; }
}
`;
      const result = await run(text);
      expect(result).toContain('label?: any');
    });

    it('marks a prop optional when it is optionally called', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return <div>{this.props.onRender?.()}</div>; }
}
`;
      const result = await run(text);
      expect(result).toContain('onRender?: any');
    });

    it('leaves a prop required when only props itself is optionally chained', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return <div>{this.props?.label}</div>; }
}
`;
      const result = await run(text);
      expect(result).toContain('label: any');
      expect(result).not.toContain('label?: any');
    });

    it('infers a prop read through element access', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return <div>{this.props['data-id']}</div>; }
}
`;
      const result = await run(text);
      expect(result).toContain('"data-id": any');
    });

    it('marks a prop optional when it has a default in destructuring', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() {
    const { title = 'default' } = this.props;
    return <div>{title}</div>;
  }
}
`;
      const result = await run(text);
      expect(result).toContain('title?: any');
    });
  });

  describe('Call-site inference', () => {
    it('infers props from a single call site', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
export default Foo;
`;
      const caller = `import React from 'react';
import Foo from '/Foo';
const el = <Foo name="Alice" count={42} />;
`;
      const result = await run(text, { 'caller.tsx': caller });
      // All literals are widened to base types.
      expect(result).toContain('name: string');
      expect(result).toContain('count: number');
      expect(result).toContain('class Foo extends React.Component<Props>');
    });

    it('unwraps immer draft alias to the underlying type at a call site', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
export default Foo;
`;
      // Fake immer module at a path containing /immer/ so the unwrap heuristic
      // recognises it. Mirrors redux-toolkit reducer state being Draft<T>.
      const immer = `export type WritableNonArrayDraft<T> = { -readonly [K in keyof T]: T[K] };
export const draft = <T>(base: T): WritableNonArrayDraft<T> => base as WritableNonArrayDraft<T>;
`;
      const state = `export type UsageState = { total: number };
`;
      const caller = `import React from 'react';
import Foo from '/Foo';
import { UsageState } from '/state';
import { draft } from '/immer/index';
const usages = draft<UsageState>({ total: 0 });
const el = <Foo usages={usages} />;
`;
      const result = await run(text, {
        'immer/index.ts': immer,
        'state.ts': state,
        'caller.tsx': caller,
      });
      expect(result).toContain('usages: UsageState');
      expect(result).not.toContain('WritableNonArrayDraft');
    });

    it('widens string attrs to string', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
export default Foo;
`;
      const caller = `import React from 'react';
import Foo from '/Foo';
const a = <Foo size="sm" />;
const b = <Foo size="md" />;
const c = <Foo size="lg" />;
`;
      const result = await run(text, { 'caller.tsx': caller });
      expect(result).toContain('size: string');
    });

    it('widens number attrs to number', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
export default Foo;
`;
      const caller = `import React from 'react';
import Foo from '/Foo';
const a = <Foo level={1} />;
const b = <Foo level={2} />;
const c = <Foo level={3} />;
`;
      const result = await run(text, { 'caller.tsx': caller });
      expect(result).toContain('level: number');
    });

    it('treats a boolean-shorthand attribute as boolean', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
export default Foo;
`;
      const caller = `import React from 'react';
import Foo from '/Foo';
const el = <Foo disabled />;
`;
      const result = await run(text, { 'caller.tsx': caller });
      expect(result).toContain('disabled: boolean');
    });

    it('unions conflicting base types across sites', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
export default Foo;
`;
      const caller = `import React from 'react';
import Foo from '/Foo';
const a = <Foo value="hello" />;
const b = <Foo value={42} />;
`;
      const result = await run(text, { 'caller.tsx': caller });
      expect(result).toContain('value: string | number');
    });

    it('marks prop optional when absent at some call sites', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
export default Foo;
`;
      const caller = `import React from 'react';
import Foo from '/Foo';
const a = <Foo label="hi" />;
const b = <Foo />;
`;
      const result = await run(text, { 'caller.tsx': caller });
      // Present at 1 of 2 sites → optional; widened to string.
      expect(result).toContain('label?: string');
    });

    it('marks prop required when present at every call site', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
export default Foo;
`;
      const caller = `import React from 'react';
import Foo from '/Foo';
const a = <Foo label="hi" />;
const b = <Foo label="bye" />;
`;
      const result = await run(text, { 'caller.tsx': caller });
      expect(result).toContain('label: ');
      expect(result).not.toMatch(/label\?:/);
    });

    it('adds children when JSX children are used', async () => {
      const text = `import React from 'react';
class Wrapper extends React.Component {
  render() { return null; }
}
export default Wrapper;
`;
      const caller = `import React from 'react';
import Wrapper from '/Foo';
const el = <Wrapper><span>hi</span></Wrapper>;
`;
      const result = await run(text, { 'caller.tsx': caller });
      expect(result).toContain('children?: React.ReactNode');
    });

    it('omits children when includeChildren is false', async () => {
      const text = `import React from 'react';
class Wrapper extends React.Component {
  render() { return null; }
}
export default Wrapper;
`;
      const caller = `import React from 'react';
import Wrapper from '/Foo';
const el = <Wrapper><span>hi</span></Wrapper>;
`;
      const result = await run(text, { 'caller.tsx': caller }, { includeChildren: false });
      // With includeChildren: false and no other props, result may be undefined
      // or a string without 'children'.
      if (result != null) {
        expect(result).not.toContain('children');
      }
    });
  });

  describe('Patching an existing named Props type with any members', () => {
    it('narrows any members in an existing named Props type from JSX call sites', async () => {
      const text = `import React from 'react';
type Props = { name: any; count: any };
type State = { loading: boolean };
export default class Header extends React.Component<Props, State> {
  render() { return null; }
}
`;
      const caller = `import React from 'react';
import Header from '/Foo';
const el = <Header name="Alice" count={42} />;
`;
      const result = await run(text, { 'caller.tsx': caller });
      // The any members should be narrowed from the JSX call site.
      expect(result).toContain('name: string');
      expect(result).toContain('count: number');
      // The class heritage line itself must not change.
      expect(result).toContain('React.Component<Props, State>');
    });

    it('keeps the arity of a generic prop type whose argument is a function', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
export default Foo;
`;
      const caller = `import React from 'react';
import Foo from '/Foo';
declare const m: Map<() => void, string>;
const el = <Foo lookup={m} />;
`;
      const result = await run(text, { 'caller.tsx': caller });
      expect(result).toContain('lookup: Map<any, string>');
    });

    it('widens a string literal prop that contains a union separator', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
export default Foo;
`;
      const caller = `import React from 'react';
import Foo from '/Foo';
const el = <Foo label="a | b" />;
`;
      const result = await run(text, { 'caller.tsx': caller });
      expect(result).toContain('label: string');
    });

    it('uses anyFunctionAlias for a signature it cannot reconstruct', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
export default Foo;
`;
      const caller = `import React from 'react';
import Foo from '/Foo';
const el = <Foo onClick={(e: string) => e.length} />;
`;
      const result = await run(
        text,
        { 'caller.tsx': caller },
        { anyFunctionAlias: '$TSFixMeFunction' },
      );
      expect(result).toContain('onClick: $TSFixMeFunction');
    });

    it('imports a type under one specifier when the call site and the symbol disagree', async () => {
      // ButtonSize is declared without `export` and re-exported, so the symbol
      // resolves to the package root while the call site imports the subpath.
      const typesDts = `
interface ButtonSize { px: number }
export { type ButtonSize };
export declare const size: ButtonSize;
`;
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
export default Foo;
`;
      const caller = `import React from 'react';
import Foo from '/Foo';
import { size, type ButtonSize } from 'ui-kit/types';
const el = <Foo size={size} />;
`;
      const result = await run(text, {
        'node_modules/ui-kit/types.d.ts': typesDts,
        'node_modules/ui-kit/index.d.ts': `export * from './types';`,
        'caller.tsx': caller,
      });
      expect(result).toContain('ButtonSize');
      const importLines = (result as string)
        .split('\n')
        .filter((line) => line.startsWith('import') && line.includes('ButtonSize'));
      expect(importLines).toHaveLength(1);
    });

    it('patches a Props alias shared by two components from the evidence of both', async () => {
      const text = `import React from 'react';
type Props = { name: any };
export class A extends React.Component<Props> {
  render() { return null; }
}
export class B extends React.Component<Props> {
  render() { return null; }
}
`;
      const caller = `import React from 'react';
import { A, B } from '/Foo';
const a = <A name="x" />;
const b = <B name={42} />;
`;
      const result = await run(text, { 'caller.tsx': caller });
      // One replacement carrying both observations, not two that concatenate.
      expect(result).toContain('name: string | number');
      expect(result).not.toContain('stringnumber');
    });

    it('leaves already-typed members untouched when patching', async () => {
      const text = `import React from 'react';
type Props = { name: string; count: any };
export default class Header extends React.Component<Props> {
  render() { return null; }
}
`;
      const caller = `import React from 'react';
import Header from '/Foo';
const el = <Header name="Alice" count={42} />;
`;
      const result = await run(text, { 'caller.tsx': caller });
      expect(result).toContain('count: number');
      // The already-typed member must not be duplicated or altered.
      expect(result).toContain('name: string');
      expect(result).not.toMatch(/name:.*name:/s);
    });

    it('leaves Props alone when there are no call sites to infer from', async () => {
      const text = `import React from 'react';
type Props = { name: any };
export default class Header extends React.Component<Props> {
  render() { return null; }
}
`;
      const result = await run(text);
      // No evidence → nothing to narrow → no change.
      expect(result).toBeUndefined();
    });

    it('unions conflicting types when patching from multiple call sites', async () => {
      const text = `import React from 'react';
type Props = { value: any };
export default class Header extends React.Component<Props> {
  render() { return null; }
}
`;
      const caller = `import React from 'react';
import Header from '/Foo';
const a = <Header value="hello" />;
const b = <Header value={42} />;
`;
      const result = await run(text, { 'caller.tsx': caller });
      expect(result).toContain('value: string | number');
    });

    it('uses anyAlias when patching and inference falls back to any', async () => {
      const text = `import React from 'react';
type Props = { data: any };
export default class Header extends React.Component<Props> {
  render() { return null; }
}
`;
      const caller = `import React from 'react';
import Header from '/Foo';
declare const x: any;
const el = <Header data={x} />;
`;
      const result = await run(text, { 'caller.tsx': caller }, { anyAlias: '$TSFixMe' });
      // all-any evidence → nothing improved → no change
      expect(result).toBeUndefined();
    });

    it('leaves a function-typed any member as any instead of emitting unsafe types when patching', async () => {
      const text = `import React from 'react';
type Props = { name: any; onClick: any };
export default class Header extends React.Component<Props> {
  render() { return null; }
}
`;
      const caller = `import React from 'react';
import Header from '/Foo';
const handleClick = (id: string) => id.length;
const el = <Header name="Alice" onClick={handleClick} />;
`;
      const result = await run(text, { 'caller.tsx': caller });
      // The simple attribute is narrowed...
      expect(result).toContain('name: string');
      // ...but the function-typed attribute is left as `any` rather than spliced
      // in as raw text (which could be truncated/invalid). No function type or
      // truncation markers must appear in the output.
      expect(result).toContain('onClick: any');
      expect(result).not.toContain('=>');
      expect(result).not.toContain('...');
    });
  });

  describe('Bail-outs and edge cases', () => {
    it('bails out when a call site uses spread attributes (skipOnSpread: true)', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
export default Foo;
`;
      const caller = `import React from 'react';
import Foo from '/Foo';
const extra = { name: 'hi' };
const el = <Foo {...extra} />;
`;
      // Default skipOnSpread = true → plugin bails, returns undefined.
      const result = await run(text, { 'caller.tsx': caller });
      expect(result).toBeUndefined();
    });

    it('respects skipOnSpread: false', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
export default Foo;
`;
      const caller = `import React from 'react';
import Foo from '/Foo';
const extra = { name: 'hi' };
const el = <Foo {...extra} name="hi" />;
`;
      const result = await run(text, { 'caller.tsx': caller }, { skipOnSpread: false });
      // spread is ignored but the explicit 'name' attribute is still captured
      expect(result).toContain('name: string');
    });

    it('forces all props optional with defaultOptional: true', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
export default Foo;
`;
      const caller = `import React from 'react';
import Foo from '/Foo';
const el = <Foo name="hi" count={1} />;
`;
      const result = await run(text, { 'caller.tsx': caller }, { defaultOptional: true });
      expect(result).toContain('name?:');
      expect(result).toContain('count?:');
    });

    it('skips this.props body analysis when useThisPropsUsage: false', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return <div>{this.props.name}</div>; }
}
`;
      // No call sites, body usage disabled → nothing to infer → undefined.
      const result = await run(text, {}, { useThisPropsUsage: false });
      expect(result).toBeUndefined();
    });

    it('this.props adds a prop not seen at any call site', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return <div onClick={this.props.onClick}>{this.props.label}</div>; }
}
export default Foo;
`;
      const caller = `import React from 'react';
import Foo from '/Foo';
const el = <Foo label="hi" />;
`;
      const result = await run(text, { 'caller.tsx': caller });
      // label comes from both call site and body, onClick only from body
      expect(result).toContain('label');
      expect(result).toContain('onClick');
    });
  });

  describe('Multiple components in a file', () => {
    it('uses component-qualified names when multiple components share a file', async () => {
      const text = `import React from 'react';
export class Foo extends React.Component {
  render() { return <div>{this.props.fooName}</div>; }
}
export class Bar extends React.Component {
  render() { return <div>{this.props.barName}</div>; }
}
`;
      const result = await run(text);
      expect(result).toContain('type FooProps = {');
      expect(result).toContain('type BarProps = {');
      expect(result).toContain('class Foo extends React.Component<FooProps>');
      expect(result).toContain('class Bar extends React.Component<BarProps>');
    });
  });

  describe('anyAlias option', () => {
    it('uses anyAlias for unresolvable prop types', async () => {
      const text = `import React from 'react';
class Foo extends React.Component {
  render() { return <div>{this.props.mystery}</div>; }
}
`;
      const result = await run(text, {}, { anyAlias: '$TSFixMe' });
      expect(result).toContain('mystery: $TSFixMe');
    });
  });

  describe('Already-typed with any / empty object', () => {
    it('patches a component whose props type is any', async () => {
      const text = `import React from 'react';
class Foo extends React.Component<any> {
  render() { return null; }
}
export default Foo;
`;
      const caller = `import React from 'react';
import Foo from '/Foo';
const el = <Foo name="hi" />;
`;
      const result = await run(text, { 'caller.tsx': caller });
      expect(result).toContain('type Props = {');
      expect(result).toContain('name: string');
      expect(result).toContain('React.Component<Props>');
    });

    it('patches a component whose props type is {}', async () => {
      const text = `import React from 'react';
class Foo extends React.Component<{}> {
  render() { return null; }
}
export default Foo;
`;
      const caller = `import React from 'react';
import Foo from '/Foo';
const el = <Foo name="hi" />;
`;
      const result = await run(text, { 'caller.tsx': caller });
      expect(result).toContain('type Props = {');
      expect(result).toContain('name: string');
    });
  });
});
