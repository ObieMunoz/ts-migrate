import path from 'path';
import {
  createTypeChecker,
  fixturePluginParams,
  reactCompilerOptions as compilerOptions,
  FileMap,
  mockPluginParams,
} from '../test-utils';
import reactDestructuredPropsPlugin from '../../src/plugins/react-destructured-props';
import reactDefaultPropsPlugin from '../../src/plugins/react-default-props';

// A real directory, so `react` resolves through the repo's node_modules both
// here and in the single-file programs the plugin validates against.
const rootDir = __dirname;
const fixtureFile = path.join(rootDir, 'react-destructured-props-fixture.tsx');

function run(text: string, options?: { anyAlias?: string }, extraFiles?: FileMap): string {
  const result = reactDestructuredPropsPlugin.run(
    fixturePluginParams<{ anyAlias?: string }>({
      rootDir,
      fileName: fixtureFile,
      text,
      options,
      compilerOptions,
      extraFiles,
    }),
  );
  return typeof result === 'string' ? result : text;
}

/** Compiles the converted file for real, so a wrong prop type fails here. */
const typeCheck = createTypeChecker({ rootDir, fileName: fixtureFile, compilerOptions });

describe('react-destructured-props plugin', () => {
  it('names the props of an exported function component', () => {
    const text = `import React from 'react';

export default function Greeting({ title, onClick, children }) {
  return (
    <div onClick={onClick}>
      {title}
      {children}
    </div>
  );
}
`;

    const result = run(text);

    expect(result).toBe(`import React from 'react';

type Props = {
    title?: any;
    onClick?: any;
    children?: React.ReactNode;
};

export default function Greeting({ title, onClick, children }: Props) {
  return (
    <div onClick={onClick}>
      {title}
      {children}
    </div>
  );
}
`);
    expect(typeCheck(result)).toEqual([]);
  });

  it('is idempotent', () => {
    const text = `import React from 'react';

export default function Greeting({ title }) {
  return <div>{title}</div>;
}
`;

    const once = run(text);
    expect(once).not.toBe(text);
    expect(run(once)).toBe(once);
  });

  it('uses the any alias for the props it cannot type', () => {
    const text = `import React from 'react';

export default function Greeting({ title }) {
  return <div>{title}</div>;
}
`;

    expect(run(text, { anyAlias: '$TSFixMe' })).toContain('title?: $TSFixMe;');
  });

  it('types props from the JSX attributes of a component only this file renders', () => {
    const text = `import React from 'react';

function Badge({ label, count, active }) {
  return (
    <span title={label} className={active ? 'on' : 'off'}>
      {count}
    </span>
  );
}

export default function App() {
  return <Badge label="new" count={3} active />;
}
`;

    const result = run(text);

    expect(result).toContain(`type BadgeProps = {
    label?: string;
    count?: number;
    active?: boolean;
};`);
    expect(result).toContain('function Badge({ label, count, active }: BadgeProps) {');
    expect(typeCheck(result)).toEqual([]);
  });

  it('refuses call-site evidence for a component other files can render', () => {
    const text = `import React from 'react';

export function Badge({ label }) {
  return <span>{label}</span>;
}

export default function App() {
  return <Badge label="new" />;
}
`;

    expect(run(text)).toContain('label?: any;');
  });

  it('refuses call-site evidence when the call sites disagree', () => {
    const text = `import React from 'react';

function Badge({ label }) {
  return <span>{String(label)}</span>;
}

export default function App() {
  return (
    <div>
      <Badge label="new" />
      <Badge label={3} />
    </div>
  );
}
`;

    const result = run(text);

    expect(result).toContain('label?: any;');
    expect(typeCheck(result)).toEqual([]);
  });

  it('refuses call-site evidence from a spread attribute', () => {
    const text = `import React from 'react';

const extra = { label: 'new' };

function Badge({ label }) {
  return <span>{label}</span>;
}

export default function App() {
  return <Badge label="new" {...extra} />;
}
`;

    expect(run(text)).toContain('label?: any;');
  });

  it('refuses a call-site type the checker resolves to any', () => {
    const text = `import React from 'react';

declare const loose: any;

function Badge({ label }) {
  return <span>{label}</span>;
}

export default function App() {
  return <Badge label={loose} />;
}
`;

    expect(run(text)).toContain('label?: any;');
  });

  it('types props from the defaults in the pattern', () => {
    const text = `import React from 'react';

export function Counter({ start = 0, label = 'total', extra = null, title }) {
  return (
    <span>
      {title} {label}: {start} {extra}
    </span>
  );
}
`;

    const result = run(text);

    expect(result).toContain(`type Props = {
    start?: number;
    label?: string;
    extra?: any;
    title?: any;
};`);
    expect(typeCheck(result)).toEqual([]);
  });

  it('leaves a pattern the checker already types alone', () => {
    const text = `import React from 'react';

export function Counter({ start = 0, label = 'total' }) {
  return (
    <span>
      {label}: {start}
    </span>
  );
}
`;

    expect(run(text)).toBe(text);
  });

  it('falls back to the alias where the body contradicts the call site', () => {
    const text = `import React from 'react';

function Row({ render }) {
  return <span>{render()}</span>;
}

export default function App() {
  return <Row render={1} />;
}
`;

    const result = run(text);

    expect(result).toContain('render?: any;');
    expect(typeCheck(result)).toEqual([]);
  });

  it('keeps the props the contradicted one does not blame', () => {
    const text = `import React from 'react';

function Row({ render, label }) {
  return (
    <span title={label}>
      {render()}
    </span>
  );
}

export default function App() {
  return <Row render={1} label="row" />;
}
`;

    const result = run(text);

    expect(result).toContain(`type RowProps = {
    render?: any;
    label?: string;
};`);
    expect(typeCheck(result)).toEqual([]);
  });

  // The pattern already gives the component a closed props type as far as JSX
  // is concerned, so writing it down adds no call-site error of its own.
  it('adds no error where a call site passes a prop the pattern never names', () => {
    const text = `import React from 'react';

function Badge({ label }) {
  return <span>{label}</span>;
}

export default function App() {
  return <Badge label="new" extra={1} />;
}
`;

    const before = typeCheck(text).filter((message) => message.startsWith('TS2322'));
    const result = run(text);

    expect(result).toContain('label?: string;');
    expect(typeCheck(result).filter((message) => message.startsWith('TS2322'))).toHaveLength(
      before.length,
    );
  });

  it('names the props of every component in the file', () => {
    const text = `import React from 'react';

export function Header({ title }) {
  return <h1>{title}</h1>;
}

export function Footer({ note }) {
  return <p>{note}</p>;
}
`;

    const result = run(text);

    expect(result).toContain('type HeaderProps = {\n    title?: any;\n};');
    expect(result).toContain('type FooterProps = {\n    note?: any;\n};');
    expect(result).toContain('function Header({ title }: HeaderProps) {');
    expect(result).toContain('function Footer({ note }: FooterProps) {');
    expect(typeCheck(result)).toEqual([]);
  });

  it('leaves a component with a rest element alone', () => {
    const text = `import React from 'react';

export default function Box({ title, ...rest }) {
  return <div {...rest}>{title}</div>;
}
`;

    expect(run(text)).toBe(text);
  });

  it('types a nested pattern as the alias and keeps the outer names', () => {
    const text = `import React from 'react';

export default function Card({ header: { title }, footer }) {
  return (
    <div>
      {title}
      {footer}
    </div>
  );
}
`;

    const result = run(text);

    expect(result).toContain(`type Props = {
    header?: any;
    footer?: any;
};`);
    expect(result).toContain('function Card({ header: { title }, footer }: Props) {');
    expect(typeCheck(result)).toEqual([]);
  });

  it('keeps a defaulted pattern and its initializer', () => {
    const text = `import React from 'react';

export default function Box({ title } = {}) {
  return <div>{title}</div>;
}
`;

    const result = run(text);

    expect(result).toContain('function Box({ title }: Props = {}) {');
    expect(typeCheck(result)).toEqual([]);
  });

  it('quotes a property name that is not an identifier', () => {
    const text = `import React from 'react';

export default function Box({ 'data-id': dataId }) {
  return <div>{dataId}</div>;
}
`;

    const result = run(text);

    expect(result).toContain('"data-id"?: any;');
    expect(typeCheck(result)).toEqual([]);
  });

  it('covers arrow, function expression, memo and forwardRef components', () => {
    const text = `import React, { forwardRef, memo } from 'react';

export const Arrow = ({ a }) => <div>{a}</div>;

export const Expression = function ({ b }) {
  return <div>{b}</div>;
};

export const Memo = memo(({ c }) => <div>{c}</div>);

export const NamespacedMemo = React.memo(({ d }) => <div>{d}</div>);

export const Ref = forwardRef(({ e }) => <div>{e}</div>);

export const MemoRef = memo(forwardRef(({ f }) => <div>{f}</div>));
`;

    const result = run(text);

    ['a', 'b', 'c', 'd', 'e', 'f'].forEach((prop) => {
      expect(result).toContain(`    ${prop}?: any;`);
    });
    expect(result).toContain('export const Arrow = ({ a }: ArrowProps) =>');
    expect(result).toContain('export const MemoRef = memo(forwardRef(({ f }: MemoRefProps)');
    expect(typeCheck(result)).toEqual([]);
  });

  it('leaves a component whose declaration is annotated alone', () => {
    const text = `import React from 'react';

export const Greeting: React.FC<{ title: string }> = ({ title, subtitle }) => (
  <div>
    {title}
    {subtitle}
  </div>
);
`;

    expect(run(text)).toBe(text);
  });

  it('leaves a component whose props are already typed alone', () => {
    const text = `import React from 'react';

type Props = { title: string };

export default function Greeting({ title }: Props) {
  return <div>{title}</div>;
}
`;

    expect(run(text)).toBe(text);
  });

  it('leaves an untyped pattern alone without noImplicitAny', () => {
    const text = `import React from 'react';

export default function Greeting({ title }) {
  return <div>{title}</div>;
}
`;

    const params = fixturePluginParams({
      rootDir,
      fileName: fixtureFile,
      text,
      compilerOptions: { ...compilerOptions, strict: false, noImplicitAny: false },
    });
    expect(reactDestructuredPropsPlugin.run(params)).toBeUndefined();
  });

  // react-default-props runs next and only fires on a component that already
  // carries a props type, which these components did not have before.
  it('does not send react-default-props down its helper path', () => {
    const text = `import React from 'react';

export default function Greeting({ title }) {
  return <div>{title}</div>;
}

Greeting.defaultProps = { title: 'hi' };
`;

    const withProps = run(text);
    const withDefaults = reactDefaultPropsPlugin.run(
      mockPluginParams({
        text: withProps,
        fileName: fixtureFile,
        options: { useDefaultPropsHelper: false },
      }),
    );
    const result = typeof withDefaults === 'string' ? withDefaults : withProps;

    expect(result).not.toContain('WithDefaultProps');
    expect(result).toContain('type Props = OwnProps & (typeof Greeting)["defaultProps"];');
  });

  it('leaves files that are not .tsx alone', () => {
    const params = fixturePluginParams({
      rootDir,
      fileName: fixtureFile,
      text: 'export default function Greeting({ title }) {}',
      compilerOptions,
    });
    const result = reactDestructuredPropsPlugin.run({ ...params, fileName: 'file.ts' });
    expect(result).toBeUndefined();
  });
});
