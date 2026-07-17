import { realPluginParams } from '../test-utils';
import reactPropsFromUsagePlugin from '../../src/plugins/react-props-from-usage';

// Helper that builds plugin params for the component file, with optional extra
// files visible to the language service (for call-site discovery).
async function run(
  text: string,
  extraFiles: Record<string, string> = {},
  options: Record<string, unknown> = {},
) {
  return reactPropsFromUsagePlugin.run(
    await realPluginParams({
      fileName: 'Foo.tsx',
      text,
      options,
      compilerOptions: { jsx: 2 /* React */ },
      extraFiles,
    }),
  );
}

// ---------------------------------------------------------------------------
// Basic skip conditions
// ---------------------------------------------------------------------------

describe('react-props-from-usage plugin', () => {
  it('returns undefined for non-tsx files', async () => {
    const text = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
`;
    const result = await reactPropsFromUsagePlugin.run(
      await realPluginParams({ fileName: 'Foo.ts', text, compilerOptions: { jsx: 2 } }),
    );
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

  // ---------------------------------------------------------------------------
  // this.props body analysis only
  // ---------------------------------------------------------------------------

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

  it('marks a prop optional when accessed with optional chaining', async () => {
    const text = `import React from 'react';
class Foo extends React.Component {
  render() { return <div>{this.props?.label}</div>; }
}
`;
    const result = await run(text);
    expect(result).toContain('label?: any');
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

  // ---------------------------------------------------------------------------
  // Call-site inference
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Bail-outs and edge cases
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Multiple components in a file
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // anyAlias option
  // ---------------------------------------------------------------------------

  it('uses anyAlias for unresolvable prop types', async () => {
    const text = `import React from 'react';
class Foo extends React.Component {
  render() { return <div>{this.props.mystery}</div>; }
}
`;
    const result = await run(text, {}, { anyAlias: '$TSFixMe' });
    expect(result).toContain('mystery: $TSFixMe');
  });

  // ---------------------------------------------------------------------------
  // Already-typed with any / empty object
  // ---------------------------------------------------------------------------

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
