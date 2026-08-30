import path from 'path';
import {
  createTypeChecker,
  fixturePluginParams,
  reactCompilerOptions as compilerOptions,
  FileMap,
} from '../test-utils';
import reactReadPropsPlugin from '../../src/plugins/react-read-props';

const rootDir = __dirname;
const fixtureFile = path.join(rootDir, 'react-read-props-fixture.tsx');
const callsName = 'react-read-props-calls.tsx';

function run(text: string, extraFiles: FileMap = {}): string {
  const result = reactReadPropsPlugin.run(
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
import { Widget } from './react-read-props-fixture';

export const Row = () => ${body};
`;

const spreadCall = `\
import React from 'react';
import { Widget } from './react-read-props-fixture';

const row = { name: 'a', subtitle: 'b' };
export const Row = () => <Widget {...row} />;
`;

describe('react-read-props plugin', () => {
  it('leaves a prop the component reads that nothing in the project types', () => {
    const text = `\
import React from 'react';

type Props = {
  name?: string;
};

export const Widget = (props: Props) => <div>{props.name}{props.subtitle}</div>;
`;

    expect(run(text, { [callsName]: callSite('<Widget name="a" />') })).toBe(text);
  });

  it('types a prop from the object a call site spreads', () => {
    const text = `\
import React from 'react';

type Props = {
  name?: string;
};

export const Widget = (props: Props) => <div>{props.name}{props.subtitle}</div>;
`;

    const calls = `\
import React from 'react';
import { Widget } from './react-read-props-fixture';

const row = { name: 'a', subtitle: 'b', count: 1 };
export const Row = () => <Widget {...row} />;
`;

    expect(run(text, { [callsName]: calls })).toContain('(props: Props & { subtitle?: string })');
  });

  it('types a prop from the value a call site passes for it', () => {
    const text = `\
import React from 'react';

type Props = {
  name?: string;
};

export const Widget = (props: Props) => <div>{props.name}{props.level}</div>;
`;

    const calls = `\
import React from 'react';
import { Widget } from './react-read-props-fixture';

const rest = { name: 'a' };
export const Row = () => <Widget {...rest} level={2} />;
`;

    expect(run(text, { [callsName]: calls })).toContain('(props: Props & { level?: number })');
  });

  it('declares a prop a class component reads off this.props', () => {
    const text = `\
import React from 'react';

type Props = {
  name?: string;
};

export class Widget extends React.Component<Props> {
  render() {
    return <div>{this.props.name}{this.props.subtitle}</div>;
  }
}
`;

    expect(run(text, { [callsName]: spreadCall })).toContain(
      'extends React.Component<Props & { subtitle?: string }>',
    );
  });

  it('declares a prop a class component destructures out of this.props', () => {
    const text = `\
import React from 'react';

type Props = {
  name?: string;
};

export class Widget extends React.Component<Props> {
  render() {
    const { name, subtitle } = this.props;
    return <div>{name}{subtitle}</div>;
  }
}
`;

    expect(run(text, { [callsName]: spreadCall })).toContain(
      'extends React.Component<Props & { subtitle?: string }>',
    );
  });

  it('declares a prop the parameter pattern binds and the props type omits', () => {
    const text = `\
import React from 'react';

type Props = {
  name?: string;
};

export const Widget = ({ name, subtitle }: Props) => <div>{name}{subtitle}</div>;
`;

    expect(run(text, { [callsName]: spreadCall })).toContain(
      '({ name, subtitle }: Props & { subtitle?: string })',
    );
  });

  it('takes the type argument of a component typed on its variable', () => {
    const text = `\
import React from 'react';

type Props = {
  name?: string;
};

export const Widget: React.FC<Props> = (props) => <div>{props.name}{props.subtitle}</div>;
`;

    expect(run(text, { [callsName]: spreadCall })).toContain(
      'React.FC<Props & { subtitle?: string }>',
    );
  });

  it('reaches the component a wrapper exports', () => {
    const text = `\
import React, { memo } from 'react';

type Props = {
  name?: string;
};

const WidgetBase = (props: Props) => <div>{props.name}{props.subtitle}</div>;
export const Widget = memo(WidgetBase);
`;

    const calls = `\
import React from 'react';
import { Widget } from './react-read-props-fixture';

const row = { name: 'a', subtitle: 'b' };
export const Row = () => <Widget {...row} />;
`;

    expect(run(text, { [callsName]: calls })).toContain('(props: Props & { subtitle?: string })');
  });

  it('types a prop the component spreads onto an element from that element', () => {
    const text = `\
import React from 'react';

type Props = {
  name?: string;
};

type IconProps = {
  glyph?: string;
  size?: number;
};

const Icon = (props: IconProps) => <i>{props.glyph}</i>;

export const Widget = ({ name, icon }: Props) => (
  <div>
    {name}
    <Icon {...icon} />
  </div>
);
`;

    const result = run(text, { [callsName]: callSite('<Widget name="a" />') });
    expect(result).toContain(
      '({ name, icon }: Props & { icon?: Partial<React.ComponentProps<typeof Icon>> })',
    );
    expect(typeCheck(result)).toEqual([]);
  });

  it('types a prop from the parameter it is handed to', () => {
    const text = `\
import React from 'react';

type Props = {
  name?: string;
};

const upper = (value?: string) => value?.toUpperCase();

export const Widget = ({ name, subtitle }: Props) => <div>{name}{upper(subtitle)}</div>;
`;

    expect(run(text, { [callsName]: callSite('<Widget name="a" />') })).toContain(
      '({ name, subtitle }: Props & { subtitle?: string })',
    );
  });

  it('types a prop from the prop of another component it is passed as', () => {
    const text = `\
import React from 'react';

type Props = {
  name?: string;
};

const Label = (props: { level?: number }) => <span>{props.level}</span>;

export const Widget = ({ name, depth }: Props) => (
  <div>
    {name}
    <Label level={depth} />
  </div>
);
`;

    expect(run(text, { [callsName]: callSite('<Widget name="a" />') })).toContain(
      '({ name, depth }: Props & { depth?: number })',
    );
  });

  it('leaves a prop whose only evidence the declaring file contradicts', () => {
    const text = `\
import React from 'react';

type Props = {
  name?: string;
};

const upper = (value: string) => value.toUpperCase();

export const Widget = ({ name, subtitle }: Props) => (
  <div>
    {name}
    {upper(subtitle)}
    {subtitle.toFixed(2)}
  </div>
);
`;

    expect(run(text, { [callsName]: callSite('<Widget name="a" />') })).toBe(text);
  });

  it('leaves a prop the project passes but cannot print a type for', () => {
    const text = `\
import React from 'react';

type Props = {
  name?: string;
};

export const Widget = (props: Props) => <div>{props.name}{String(props.meta)}</div>;
`;

    const calls = `\
import React from 'react';
import { Widget } from './react-read-props-fixture';

const row = { name: 'a', meta: { id: 1 } };
export const Row = () => <Widget {...row} />;
`;

    expect(run(text, { [callsName]: calls })).toBe(text);
  });

  it('leaves a read one letter off a prop the type declares', () => {
    const text = `\
import React from 'react';

type Props = {
  subtitle?: string;
};

export const Widget = (props: Props) => <div>{props.subtitl}</div>;
`;

    expect(run(text, { [callsName]: callSite('<Widget subtitle="a" />') })).toBe(text);
  });

  it('leaves a function nothing renders', () => {
    const text = `\
import React from 'react';

type Options = {
  name?: string;
};

export const format = (options: Options) => \`\${options.name}\${options.subtitle}\`;
export const Widget = () => <div>{format({ name: 'a' })}</div>;
`;

    expect(run(text)).toBe(text);
  });

  it('leaves a component whose props are any', () => {
    const text = `\
import React from 'react';

export const Widget = (props: any) => <div>{props.subtitle}</div>;
`;

    expect(run(text, { [callsName]: callSite('<Widget />') })).toBe(text);
  });

  it('leaves a props type with an index signature', () => {
    const text = `\
import React from 'react';

type Props = {
  [key: string]: unknown;
};

export const Widget = (props: Props) => <div>{String(props.subtitle)}</div>;
`;

    expect(run(text, { [callsName]: callSite('<Widget />') })).toBe(text);
  });

  it('leaves a component with no props annotation', () => {
    const text = `\
import React from 'react';

export const Widget = (props) => <div>{props.subtitle}</div>;
`;

    expect(run(text, { [callsName]: callSite('<Widget />') })).toBe(text);
  });

  it('type checks what it wrote for a component used in its own file', () => {
    const text = `\
import React from 'react';

type Props = {
  name?: string;
};

const Widget = (props: Props) => <div>{props.name}{props.subtitle}</div>;
const row = { name: 'a', subtitle: 'b' };
export const Row = () => <Widget {...row} />;
`;

    const result = run(text);
    expect(result).toContain('(props: Props & { subtitle?: string })');
    expect(typeCheck(result)).toEqual([]);
    expect(typeCheck(text)).toHaveLength(1);
  });

  it('leaves a file whose reads the props type declares', () => {
    const result = reactReadPropsPlugin.run(
      fixturePluginParams({
        rootDir,
        fileName: fixtureFile,
        text: `\
import React from 'react';

type Props = {
  name?: string;
};

export const Widget = (props: Props) => <div>{props.name}</div>;
`,
        compilerOptions,
      }),
    );
    expect(result).toBeUndefined();
  });
});
