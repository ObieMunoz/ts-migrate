import { run } from './react-props-from-usage.harness';

describe('react-props-from-usage plugin, the imports it adds', () => {
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

    it('emits `typeof <value>` when a call-site value type degrades to any but is an exported value', async () => {
      // Mirrors `updateVideoPage={bindActionCreators(updateVideoPage, dispatch)}`:
      // the value is an exported action creator whose function type is too large
      // to reconstruct (degrades to `any`), but `typeof updateThing` is both
      // accurate and importable. `wrap` stands in for bindActionCreators — its
      // single-argument overload returns the same type as its argument.
      const libFile = `
export function updateThing(id: string, value: number) {
  return (dispatch: unknown) => Promise.resolve();
}
export function wrap<T>(fn: T, dispatch: unknown): T { return fn; }
`;
      const componentText = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
export default Foo;
`;
      const caller = `import React from 'react';
import Foo from '/Foo';
import { updateThing, wrap } from '/lib';
declare const dispatch: unknown;
const el = <Foo onUpdate={wrap(updateThing, dispatch)} />;
`;
      const result = await run(componentText, { 'caller.tsx': caller, 'lib.ts': libFile });
      expect(result).toContain('onUpdate: typeof updateThing');
      expect(result).not.toContain('onUpdate: any');
      expect(result).toMatch(/import.*updateThing.*from/s);
    });

    it('does not emit `typeof default` for a default-exported value (falls back to any)', async () => {
      // Reproduces TagSearch: two call sites pass different default-exported
      // functions to the same prop. A default export's symbol name is `default`,
      // which cannot be referenced via `typeof default` nor imported as a named
      // import. The prop must fall back to `any` with no broken import.
      const utilA = `export default function removeStringTagDuplicates(tag: { id: string }, tagValue: unknown) {
  return tagValue;
}
`;
      const utilB = `export default function removeTagDuplicates(tag: { id: string }, tagValue: unknown) {
  return tagValue;
}
`;
      const componentText = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
export default Foo;
`;
      const callerA = `import React from 'react';
import Foo from '/Foo';
import removeStringTagDuplicates from '/utilA';
const el = <Foo removeDupes={removeStringTagDuplicates} />;
`;
      const callerB = `import React from 'react';
import Foo from '/Foo';
import removeTagDuplicates from '/utilB';
const el = <Foo removeDupes={removeTagDuplicates} />;
`;
      const result = await run(componentText, {
        'utilA.ts': utilA,
        'utilB.ts': utilB,
        'callerA.tsx': callerA,
        'callerB.tsx': callerB,
      });
      expect(result).toContain('removeDupes: any');
      expect(result).not.toContain('typeof default');
      expect(result).not.toMatch(/import\s*\{\s*default\s*\}/);
    });

    it('leaves an inline/anonymous function prop as any without adding an import', async () => {
      // Mirrors `saveVideo={bindActionCreators(saveVideo, dispatch)}` where the
      // resolved value is an anonymous `__function`: there is no name to reference
      // via `typeof`, so the prop stays `any` and nothing is imported.
      const componentText = `import React from 'react';
class Foo extends React.Component {
  render() { return null; }
}
export default Foo;
`;
      const caller = `import React from 'react';
import Foo from '/Foo';
const el = <Foo onClick={(x: number) => x + 1} />;
`;
      const result = await run(componentText, { 'caller.tsx': caller });
      expect(result).toContain('onClick: any');
      expect(result).not.toContain('typeof');
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
