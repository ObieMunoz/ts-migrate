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
  // Patching an existing named Props type with any members
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Import injection
  // ---------------------------------------------------------------------------

  it('adds missing imports for types inferred from JSX expressions', async () => {
    // Declare a named type in a separate "library" file so the language service
    // can resolve it and produce a non-primitive type string.
    const libFile = `
export type ButtonSize = 'sm' | 'md' | 'lg';
export type ButtonVariant = 'primary' | 'secondary';
`;
    const componentText = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
export default Foo;
`;
    // The caller imports from the lib and passes ButtonSize / ButtonVariant values.
    const caller = `import React from 'react';
import Foo from '/Foo';
import { ButtonSize, ButtonVariant } from '/lib';
declare const size: ButtonSize;
declare const variant: ButtonVariant;
const el = <Foo size={size} variant={variant} />;
`;
    const result = await run(
      componentText,
      { 'caller.tsx': caller, 'lib.ts': libFile },
      {},
    );
    // The Props type should reference ButtonSize and ButtonVariant.
    expect(result).toContain('ButtonSize');
    expect(result).toContain('ButtonVariant');
    // The component file should now import those types from the lib.
    expect(result).toMatch(/import.*ButtonSize.*from/s);
    expect(result).toMatch(/import.*ButtonVariant.*from/s);
  });

  it('does not import unexported internal types from npm packages', async () => {
    // Reproduces the immer WritableNonArrayDraft case: the type is declared in
    // a node_modules .d.ts but has no `export` modifier and is not in an export
    // specifier — it is an internal implementation detail that cannot be imported.
    const libDts = `
type InternalDraft<T> = { [K in keyof T]: T[K] };
export type WritableDraft<T> = InternalDraft<T>;
export declare function produce<T>(base: T, recipe: (draft: WritableDraft<T>) => void): T;
`;
    const componentText = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
export default Foo;
`;
    const caller = `import React from 'react';
import Foo from '/Foo';
import { produce } from 'mylib';
const state = { count: 0 };
const next = produce(state, draft => { draft.count++; });
const el = <Foo data={next} />;
`;
    const result = await run(
      componentText,
      { 'node_modules/mylib/index.d.ts': libDts, 'caller.tsx': caller },
    );
    // InternalDraft must not be imported — it has no export modifier.
    expect(result).not.toMatch(/import.*InternalDraft.*from/s);
  });

  it('does not add an import for TypeScript built-in utility types like Record', async () => {
    // Record is declared in lib.es5.d.ts inside the TypeScript package itself.
    // It is globally available and must not be imported.
    const componentText = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
export default Foo;
`;
    const caller = `import React from 'react';
import Foo from '/Foo';
declare const data: Record<string, number>;
const el = <Foo data={data} />;
`;
    const result = await run(componentText, { 'caller.tsx': caller });
    expect(result).toBeDefined();
    // The prop type should reference Record…
    expect(result).toContain('Record');
    // …but there must be no import statement for it.
    expect(result).not.toMatch(/import.*Record.*from/s);
  });

  it('adds missing imports for generic types with type parameters (direct annotation)', async () => {
    const libFile = `
export type ActionCreatorWithOptionalPayload<P, T extends string = string> = {
  (): { type: T; payload: P | undefined };
  type: T;
  match: (action: unknown) => boolean;
};
`;
    const componentText = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
export default Foo;
`;
    const caller = `import React from 'react';
import Foo from '/Foo';
import { ActionCreatorWithOptionalPayload } from '/lib';
declare const action: ActionCreatorWithOptionalPayload<string, 'search/update'>;
const el = <Foo action={action} />;
`;
    const result = await run(
      componentText,
      { 'caller.tsx': caller, 'lib.ts': libFile },
    );
    expect(result).toContain('ActionCreatorWithOptionalPayload');
    expect(result).not.toContain('import(');
    expect(result).toMatch(/import.*ActionCreatorWithOptionalPayload.*from/s);
  });

  it('adds missing imports for types from npm packages that use interface + re-export pattern', async () => {
    // Reproduces the @reduxjs/toolkit case: the type is an interface declared
    // WITHOUT the `export` keyword, then re-exported via `export { type ... }`.
    // TypeScript's getFullyQualifiedName() returns a bare name (no module prefix)
    // for such types. The plugin must fall back to extracting the package name
    // from the declaration file path.
    const libDts = `
interface ActionCreatorWithOptionalPayload<P, T extends string = string> {
  (payload?: P): { type: T; payload: P | undefined };
  type: T;
  match: (action: unknown) => boolean;
}
export { type ActionCreatorWithOptionalPayload };
export declare function makeActionCreator<P, T extends string>(type: T): ActionCreatorWithOptionalPayload<P, T>;
`;
    const componentText = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
export default Foo;
`;
    // Caller imports from 'mylib' (bare package name). TypeScript resolves this
    // to /node_modules/mylib/index.d.ts via the virtual LS host.
    const caller = `import React from 'react';
import Foo from '/Foo';
import { makeActionCreator } from 'mylib';
const action = makeActionCreator<string, 'search/update'>('search/update');
const el = <Foo action={action} />;
`;
    const result = await run(
      componentText,
      {
        'node_modules/mylib/index.d.ts': libDts,
        'caller.tsx': caller,
      },
    );
    // The plugin should add an import for ActionCreatorWithOptionalPayload from
    // 'mylib' even though the FQN has no module prefix.
    expect(result).toBeDefined();
    expect(result).toContain('ActionCreatorWithOptionalPayload');
    expect(result).not.toContain('import(');
    expect(result).toMatch(/import.*ActionCreatorWithOptionalPayload.*from\s+['"]mylib['"]/s);
  });
});
