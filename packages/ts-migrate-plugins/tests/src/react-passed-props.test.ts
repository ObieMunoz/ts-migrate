import path from 'path';
import ts from 'typescript';
import { createTypeChecker, fixturePluginParams, FileMap } from '../test-utils';
import reactPassedPropsPlugin from '../../src/plugins/react-passed-props';

const rootDir = __dirname;
const fixtureFile = path.join(rootDir, 'react-passed-props-fixture.tsx');
const callsName = 'react-passed-props-calls.tsx';

const compilerOptions: ts.CompilerOptions = {
  jsx: ts.JsxEmit.React,
  esModuleInterop: true,
  skipLibCheck: true,
};

function run(text: string, extraFiles: FileMap = {}): string {
  const result = reactPassedPropsPlugin.run(
    fixturePluginParams({
      rootDir,
      fileName: fixtureFile,
      text,
      compilerOptions,
      extraFiles,
    }),
  );
  return typeof result === 'string' ? result : text;
}

const typeCheck = createTypeChecker({ rootDir, fileName: fixtureFile, compilerOptions });

const callSite = (body: string) => `\
import React from 'react';
import { Widget } from './react-passed-props-fixture';

export const Row = () => ${body};
`;

describe('react-passed-props plugin', () => {
  it('declares a prop a call site in another file passes', () => {
    const text = `\
import React from 'react';

type Props = {
  name?: string;
};

export const Widget = ({ name }: Props) => <div>{name}</div>;
`;

    expect(run(text, { [callsName]: callSite('<Widget name="a" className="b" />') })).toBe(`\
import React from 'react';

type Props = {
  name?: string;
};

export const Widget = ({ name }: Props & { className?: string }) => <div>{name}</div>;
`);
  });

  it('types a prop from every value the call sites give it', () => {
    const text = `\
import React from 'react';

type Props = {
  name?: string;
};

export const Widget = ({ name }: Props) => <div>{name}</div>;
`;

    expect(
      run(text, {
        [callsName]: callSite('<><Widget level="2" /><Widget level={3} /></>'),
      }),
    ).toContain('({ name }: Props & { level?: string | number })');
  });

  it('takes the new props into a shape written on one line', () => {
    const text = `\
import React from 'react';

export const Widget = ({ name }: { name?: string }) => <div>{name}</div>;
`;

    expect(run(text, { [callsName]: callSite('<Widget name="a" wide />') })).toBe(`\
import React from 'react';

export const Widget = ({ name }: { name?: string; wide?: boolean }) => <div>{name}</div>;
`);
  });

  it('declares a prop passed to a class component', () => {
    const text = `\
import React from 'react';

type Props = {
  name?: string;
};

export class Widget extends React.Component<Props> {
  render() {
    return <div>{this.props.name}</div>;
  }
}
`;

    expect(run(text, { [callsName]: callSite('<Widget name="a" id="b" />') })).toContain(
      'extends React.Component<Props & { id?: string }>',
    );
  });

  it('reaches the component a memo wraps', () => {
    const text = `\
import React, { memo } from 'react';

type Props = {
  name?: string;
};

const WidgetBase = ({ name }: Props) => <div>{name}</div>;
export const Widget = memo(WidgetBase);
`;

    expect(run(text, { [callsName]: callSite('<Widget name="a" className="b" />') })).toContain(
      '({ name }: Props & { className?: string })',
    );
  });

  it('writes any for a prop no call site can be printed from', () => {
    const text = `\
import React from 'react';

type Props = {
  name?: string;
};

export const Widget = ({ name }: Props) => <div>{name}</div>;
`;

    expect(
      run(text, { [callsName]: callSite('<Widget name="a" meta={{ id: 1 }} />') }),
    ).toContain('({ name }: Props & { meta?: any })');
  });

  it('leaves a prop the props type declares with another type', () => {
    const text = `\
import React from 'react';

type Props = {
  count?: number;
};

export const Widget = ({ count }: Props) => <div>{count}</div>;
`;

    expect(run(text, { [callsName]: callSite('<Widget count="2" />') })).toBe(text);
  });

  it('leaves a component whose props are any', () => {
    const text = `\
import React from 'react';

export const Widget = (props: any) => <div>{props.name}</div>;
`;

    expect(run(text, { [callsName]: callSite('<Widget className="b" />') })).toBe(text);
  });

  it('leaves a component with no props annotation', () => {
    const text = `\
import React from 'react';

export const Widget = ({ name }) => <div>{name}</div>;
`;

    expect(run(text, { [callsName]: callSite('<Widget className="b" />') })).toBe(text);
  });

  it('leaves a props type with an index signature', () => {
    const text = `\
import React from 'react';

type Props = {
  [key: string]: unknown;
};

export const Widget = (props: Props) => <div>{String(props.name)}</div>;
`;

    expect(run(text, { [callsName]: callSite('<Widget className="b" />') })).toBe(text);
  });

  it('leaves key and ref, which React reads off the element', () => {
    const text = `\
import React from 'react';

type Props = {
  name?: string;
};

export const Widget = ({ name }: Props) => <div>{name}</div>;
`;

    expect(run(text, { [callsName]: callSite('<Widget name="a" key="k" />') })).toBe(text);
  });

  it('leaves an intrinsic element', () => {
    const text = `\
import React from 'react';

export const Row = () => <div notAnAttribute="x" />;
`;

    expect(run(text)).toBe(text);
  });

  it('declares props of a component used in its own file', () => {
    const text = `\
import React from 'react';

type Props = {
  name?: string;
};

const Widget = ({ name }: Props) => <div>{name}</div>;
export const Row = () => <Widget name="a" tabIndex={1} />;
`;

    const result = run(text);
    expect(result).toContain('({ name }: Props & { tabIndex?: number })');
    expect(typeCheck(result)).toEqual([]);
    expect(typeCheck(text)).toHaveLength(1);
  });

  it('leaves a file with no JSX', () => {
    const result = reactPassedPropsPlugin.run(
      fixturePluginParams({
        rootDir,
        fileName: path.join(rootDir, 'react-passed-props-fixture.ts'),
        text: 'export const value = 1;\n',
        compilerOptions,
      }),
    );
    expect(result).toBeUndefined();
  });
});
