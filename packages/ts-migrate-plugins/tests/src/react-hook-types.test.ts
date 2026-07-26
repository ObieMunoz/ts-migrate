import path from 'path';
import ts from 'typescript';
import { createTypeChecker, fixturePluginParams } from '../test-utils';
import reactHookTypesPlugin from '../../src/plugins/react-hook-types';

// A path inside the repo, so `react` and its types resolve the way they do in
// a project. Nothing is written to disk.
const rootDir = __dirname;
const fileName = path.join(rootDir, 'react-hook-types-fixture.tsx');

const compilerOptions: ts.CompilerOptions = {
  moduleResolution: ts.ModuleResolutionKind.Node10,
  jsx: ts.JsxEmit.React,
  esModuleInterop: true,
  skipLibCheck: true,
};

// Shared across the suite: every test pulls in the same react type declarations.
const documentRegistry = ts.createDocumentRegistry();

function run(text: string, options: unknown = {}): string {
  return reactHookTypesPlugin.run(
    fixturePluginParams({ rootDir, fileName, text, options, compilerOptions, documentRegistry }),
  ) as string;
}

/** Compiles the text as the fixture file, resolving everything else from disk. */
const errorsIn = createTypeChecker({ rootDir, fileName, compilerOptions, ownFilesOnly: true });

describe('react-hook-types plugin', () => {
  it('types useState(null) from the setter arguments', () => {
    const text = `\
import React, { useState, useEffect } from 'react';

interface User {
  name: string;
}

export default function Profile({ user }: { user: User }) {
  const [current, setCurrent] = useState(null);
  useEffect(() => {
    setCurrent(user);
  }, [user]);
  return <span>{current ? current.name : 'none'}</span>;
}
`;

    expect(errorsIn(text)).not.toEqual([]);
    const result = run(text);

    expect(result).toContain('useState<User | null>(null)');
    expect(errorsIn(result)).toEqual([]);
  });

  it('types useState([]) from the setter arguments', () => {
    const text = `\
import React, { useState, useEffect } from 'react';

interface Item {
  id: string;
}

export default function List({ source }: { source: Item[] }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    setItems(source);
  }, [source]);
  return <span>{items.map((item) => item.id).join('')}</span>;
}
`;

    expect(errorsIn(text)).not.toEqual([]);
    const result = run(text);

    expect(result).toContain('useState<Item[]>([])');
    expect(errorsIn(result)).toEqual([]);
  });

  it('types useState({}) from the setter arguments', () => {
    const text = `\
import React, { useState, useEffect } from 'react';

interface Config {
  label?: string;
}

export default function Panel({ incoming }: { incoming: Config }) {
  const [config, setConfig] = useState({});
  useEffect(() => {
    setConfig(incoming);
  }, [incoming]);
  return <span>{config.label}</span>;
}
`;

    expect(errorsIn(text)).not.toEqual([]);
    const result = run(text);

    expect(result).toContain('useState<Config>({})');
    expect(errorsIn(result)).toEqual([]);
  });

  it('keeps undefined in the union for useState(undefined)', () => {
    const text = `\
import React, { useState, useEffect } from 'react';

interface User {
  name: string;
}

export default function Profile({ user }: { user: User }) {
  const [current, setCurrent] = useState(undefined);
  useEffect(() => {
    setCurrent(user);
  }, [user]);
  return <span>{current ? current.name : 'none'}</span>;
}
`;

    const result = run(text);

    expect(result).toContain('useState<User | undefined>(undefined)');
    expect(errorsIn(result)).toEqual([]);
  });

  it('unions the types of every setter argument', () => {
    const text = `\
import React, { useState } from 'react';

export default function Toggle({ label }: { label: string }) {
  const [value, setValue] = useState(null);
  return (
    <button
      onClick={() => {
        setValue(label);
        setValue(label.length);
      }}
    >
      {value === null ? 'unset' : value}
    </button>
  );
}
`;

    expect(errorsIn(text)).not.toEqual([]);
    const result = run(text);

    expect(result).toContain('useState<string | number | null>(null)');
    expect(errorsIn(result)).toEqual([]);
  });

  it('widens a literal setter argument to its base type', () => {
    const text = `\
import React, { useState } from 'react';

export default function Status() {
  const [status, setStatus] = useState(null);
  return (
    <button onClick={() => setStatus('open')}>
      {status === null ? 'closed' : status.toUpperCase()}
    </button>
  );
}
`;

    const result = run(text);

    expect(result).toContain('useState<string | null>(null)');
    expect(errorsIn(result)).toEqual([]);
  });

  it('types useRef(null) from the intrinsic tag its ref is attached to', () => {
    const text = `\
import React, { useRef } from 'react';

export default function Field() {
  const input = useRef(null);
  const focus = () => {
    if (input.current) {
      input.current.select();
    }
  };
  return <input ref={input} onFocus={focus} />;
}
`;

    expect(errorsIn(text)).not.toEqual([]);
    const result = run(text);

    expect(result).toContain('useRef<HTMLInputElement | null>(null)');
    expect(errorsIn(result)).toEqual([]);
  });

  it('falls back to the alias when a ref reaches two kinds of tag', () => {
    const text = `\
import React, { useRef } from 'react';

export default function Field({ wide }: { wide: boolean }) {
  const box = useRef(null);
  const measure = () => {
    if (box.current) {
      box.current.scrollIntoView();
    }
  };
  return wide ? <div ref={box} onClick={measure} /> : <span ref={box} onClick={measure} />;
}
`;

    const result = run(text, { anyAlias: '$TSFixMe' });

    expect(result).toContain('useRef<$TSFixMe>(null)');
  });

  it('falls back to the alias when a ref is handed to a component', () => {
    const text = `\
import React, { useRef } from 'react';

function Box({ innerRef }: { innerRef: React.Ref<HTMLDivElement> }) {
  return <div ref={innerRef} />;
}

export default function Field() {
  const box = useRef(null);
  const measure = () => {
    if (box.current) {
      box.current.scrollIntoView();
    }
  };
  return <Box innerRef={box} onClick={measure} />;
}
`;

    const result = run(text, { anyAlias: '$TSFixMe' });

    expect(result).toContain('useRef<$TSFixMe>(null)');
  });

  it('gives an escaping setter the any argument', () => {
    const text = `\
import React, { useState } from 'react';

function Picker({ onPick }: { onPick: (value: string) => void }) {
  return <button onClick={() => onPick('a')} />;
}

export default function Wrapper() {
  const [current, setCurrent] = useState(null);
  return (
    <div>
      {current}
      <Picker onPick={setCurrent} />
    </div>
  );
}
`;

    expect(errorsIn(text)).not.toEqual([]);
    const result = run(text);

    expect(result).toContain('useState<any>(null)');
    expect(errorsIn(result)).toEqual([]);
  });

  it('gives a setter a custom hook returns the any argument', () => {
    const text = `\
import { useState } from 'react';

export function useSelection(fallback: string) {
  const [selected, setSelected] = useState(null);
  return { setSelected, label: selected === null ? fallback : selected.toUpperCase() };
}
`;

    expect(errorsIn(text)).not.toEqual([]);
    const result = run(text);

    expect(result).toContain('useState<any>(null)');
    expect(errorsIn(result)).toEqual([]);
  });

  it('writes the configured alias instead of any', () => {
    const text = `\
import React, { useState } from 'react';

function Picker({ onPick }: { onPick: (value: string) => void }) {
  return <button onClick={() => onPick('a')} />;
}

export default function Wrapper() {
  const [current, setCurrent] = useState(null);
  return (
    <div>
      {current}
      <Picker onPick={setCurrent} />
    </div>
  );
}
`;

    const result = run(text, { anyAlias: '$TSFixMe' });

    expect(result).toContain('useState<$TSFixMe>(null)');
  });

  it('does not take an any-typed setter argument as evidence', () => {
    const text = `\
import React, { useState, useEffect } from 'react';

declare function load(): any;

export default function Panel() {
  const [data, setData] = useState(null);
  useEffect(() => {
    setData(load());
  }, []);
  return <span>{data === null ? 'none' : data.label}</span>;
}
`;

    const result = run(text, { anyAlias: '$TSFixMe' });

    expect(result).toContain('useState<$TSFixMe>(null)');
  });

  it('falls back to the alias when the checker rejects the proposed argument', () => {
    const text = `\
import React, { useState, useEffect } from 'react';

interface Config {
  label: string;
}

export default function Panel({ incoming }: { incoming: Config }) {
  const [config, setConfig] = useState({});
  useEffect(() => {
    setConfig(incoming);
  }, [incoming]);
  return <span>{config.label}</span>;
}
`;

    const result = run(text, { anyAlias: '$TSFixMe' });

    expect(result).toContain('useState<$TSFixMe>({})');
  });

  it('leaves hooks whose initializer already infers a type alone', () => {
    const text = `\
import React, { useState } from 'react';

export default function Counter() {
  const [count, setCount] = useState(0);
  const [label, setLabel] = useState('');
  return (
    <button
      onClick={() => {
        setCount(count + 1);
        setLabel(String(count));
      }}
    >
      {label}
    </button>
  );
}
`;

    expect(run(text)).toBe(text);
    expect(errorsIn(text)).toEqual([]);
  });

  it('leaves a hook no error blames alone', () => {
    const text = `\
import React, { useState } from 'react';

export default function Blank() {
  const [value, setValue] = useState(null);
  return <button onClick={() => setValue(null)}>{value}</button>;
}
`;

    expect(errorsIn(text)).toEqual([]);
    expect(run(text)).toBe(text);
  });

  it('leaves a call that already has a type argument alone', () => {
    const text = `\
import React, { useState } from 'react';

interface User {
  name: string;
}

export default function Profile({ user }: { user: User }) {
  const [current, setCurrent] = useState<User | null>(null);
  return <button onClick={() => setCurrent(user)}>{current ? current.name : ''}</button>;
}
`;

    expect(run(text)).toBe(text);
  });

  it('reads the React.useState form', () => {
    const text = `\
import React from 'react';

interface User {
  name: string;
}

export default function Profile({ user }: { user: User }) {
  const [current, setCurrent] = React.useState(null);
  React.useEffect(() => {
    setCurrent(user);
  }, [user]);
  return <span>{current ? current.name : 'none'}</span>;
}
`;

    const result = run(text);

    expect(result).toContain('React.useState<User | null>(null)');
    expect(errorsIn(result)).toEqual([]);
  });

  it('types createContext() from a same-file Provider value', () => {
    const text = `\
import React, { createContext, useContext } from 'react';

interface Theme {
  color: string;
}

const ThemeContext = createContext();

export function ThemeProvider({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
`;

    expect(errorsIn(text)).not.toEqual([]);
    const result = run(text);

    expect(result).toContain('createContext<Theme | undefined>(undefined)');
    expect(errorsIn(result)).toEqual([]);
  });

  it('reads a Provider value written as an object literal', () => {
    const text = `\
import React, { createContext } from 'react';

const StatusContext = React.createContext();

export function StatusProvider({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <StatusContext.Provider value={{ label, open: false }}>{children}</StatusContext.Provider>
  );
}
`;

    expect(errorsIn(text)).not.toEqual([]);
    const result = run(text);

    expect(result).toContain(
      'React.createContext<{ label: string; open: boolean; } | undefined>(undefined)',
    );
    expect(errorsIn(result)).toEqual([]);
  });

  it('keeps null in the union for createContext(null)', () => {
    const text = `\
import React, { createContext } from 'react';

interface Theme {
  color: string;
}

const ThemeContext = createContext(null);

export function ThemeProvider({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
`;

    expect(errorsIn(text)).not.toEqual([]);
    const result = run(text);

    expect(result).toContain('createContext<Theme | null>(null)');
    expect(errorsIn(result)).toEqual([]);
  });

  it('gives a context defaulted to an empty object the any argument', () => {
    const text = `\
import React, { createContext, useContext } from 'react';

interface Theme {
  color?: string;
}

const ThemeContext = createContext({});

export function ThemeProvider({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function Label() {
  return <span>{useContext(ThemeContext).color}</span>;
}
`;

    expect(errorsIn(text)).not.toEqual([]);
    const result = run(text);

    expect(result).toContain('createContext<any>({})');
    expect(errorsIn(result)).toEqual([]);
  });

  it('gives a context with no same-file Provider the any argument', () => {
    const text = `\
import { createContext } from 'react';

export const ThemeContext = createContext();
`;

    expect(errorsIn(text)).not.toEqual([]);
    const result = run(text);

    expect(result).toContain('createContext<any>(undefined)');
    expect(errorsIn(result)).toEqual([]);
  });

  it('leaves a context nothing in its file blames alone', () => {
    const text = `\
import { createContext } from 'react';

export const ThemeContext = createContext(null);
`;

    expect(errorsIn(text)).toEqual([]);
    expect(run(text)).toBe(text);
  });

  it('does not take an any-typed Provider value as evidence', () => {
    const text = `\
import React, { createContext } from 'react';

declare function load(): any;

const DataContext = createContext();

export function DataProvider({ children }: { children: React.ReactNode }) {
  return <DataContext.Provider value={load()}>{children}</DataContext.Provider>;
}
`;

    const result = run(text, { anyAlias: '$TSFixMe' });

    expect(result).toContain('createContext<$TSFixMe>(undefined)');
  });

  it('gives a Provider whose value is spread the any argument', () => {
    const text = `\
import React, { createContext } from 'react';

interface Theme {
  color: string;
}

const ThemeContext = createContext();

export function ThemeProvider(props: { value: Theme; children: React.ReactNode }) {
  return <ThemeContext.Provider {...props} />;
}
`;

    const result = run(text, { anyAlias: '$TSFixMe' });

    expect(result).toContain('createContext<$TSFixMe>(undefined)');
  });

  it('falls back to the alias when the file reads the context without a check', () => {
    const text = `\
import React, { createContext, useContext } from 'react';

interface Theme {
  color: string;
}

const ThemeContext = createContext();

export function ThemeProvider({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function Label() {
  return <span>{useContext(ThemeContext).color}</span>;
}
`;

    expect(errorsIn(text)).not.toEqual([]);
    const result = run(text);

    expect(result).toContain('createContext<any>(undefined)');
    expect(errorsIn(result)).toEqual([]);
  });

  it('leaves a createContext call it has already typed alone', () => {
    const text = `\
import React, { createContext } from 'react';

interface Theme {
  color: string;
}

const ThemeContext = createContext();

export function ThemeProvider({ theme, children }: { theme: Theme; children: React.ReactNode }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
`;

    const once = run(text);

    expect(once).not.toBe(text);
    expect(run(once)).toBe(once);
  });

  it('clears every hook error in a file with several components', () => {
    const text = `\
import React, { createContext, useState, useRef, useEffect } from 'react';

interface Item {
  id: string;
}

const ItemsContext = createContext();

export function ItemsProvider({ source, children }: { source: Item[]; children: React.ReactNode }) {
  return <ItemsContext.Provider value={source}>{children}</ItemsContext.Provider>;
}

export function List({ source }: { source: Item[] }) {
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    setItems(source);
    setSelected(source[0]);
  }, [source]);
  return <span>{items.map((item) => item.id).join(selected ? selected.id : '')}</span>;
}

export function Field() {
  const area = useRef(null);
  const clear = () => {
    if (area.current) {
      area.current.value = '';
    }
  };
  return <textarea ref={area} onBlur={clear} />;
}
`;

    expect(errorsIn(text).length).toBeGreaterThan(0);
    const result = run(text);

    expect(result).toContain('createContext<Item[] | undefined>(undefined)');
    expect(result).toContain('useState<Item[]>([])');
    expect(result).toContain('useState<Item | null>(null)');
    expect(result).toContain('useRef<HTMLTextAreaElement | null>(null)');
    expect(errorsIn(result)).toEqual([]);
  });
});
