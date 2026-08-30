import path from 'path';
import ts from 'typescript';
import {
  createTypeChecker,
  fixturePluginParams,
  reactCompilerOptions as compilerOptions,
} from '../test-utils';
import reactForwardedPropsPlugin from '../../src/plugins/react-forwarded-props';

const rootDir = __dirname;
const fixtureFile = path.join(rootDir, 'react-forwarded-props-fixture.tsx');

const target = `\
import React from 'react';

type IconProps = {
  name?: string;
  size?: number;
  className?: string;
};

export default function Icon({ name, size, className }: IconProps) {
  return <i className={className} data-name={name} data-size={size} />;
}
`;

function run(text: string): string {
  const result = reactForwardedPropsPlugin.run(
    fixturePluginParams({
      rootDir,
      fileName: fixtureFile,
      text,
      compilerOptions,
      extraFiles: { 'react-forwarded-props-target.tsx': target },
    }),
  );
  return typeof result === 'string' ? result : text;
}

const typeCheck = createTypeChecker({
  rootDir,
  fileName: fixtureFile,
  compilerOptions,
  sharedFiles: { [path.join(rootDir, 'react-forwarded-props-target.tsx')]: target },
});

describe('react-forwarded-props plugin', () => {
  it('adds the props of the element the rest is forwarded to', () => {
    const text = `\
import React from 'react';
import Icon from './react-forwarded-props-target';

type Props = {
  name?: string;
};

const IconContainer = ({ name, ...props }: Props) => <Icon {...props} name={name} />;
export default IconContainer;
`;

    expect(run(text)).toBe(`\
import React from 'react';
import Icon from './react-forwarded-props-target';

type Props = {
  name?: string;
};

const IconContainer = ({ name, ...props }: Props & Omit<Partial<React.ComponentProps<typeof Icon>>, 'name'>) => <Icon {...props} name={name} />;
export default IconContainer;
`);
    expect(typeCheck(run(text))).toEqual([]);
  });

  it('lets a call site pass a prop only the forwarded element declares', () => {
    const text = `\
import React from 'react';
import Icon from './react-forwarded-props-target';

type Props = {
  name?: string;
};

export const IconContainer = ({ name, ...props }: Props) => <Icon {...props} name={name} />;
export const Row = () => <IconContainer name="a" className="b" />;
`;

    expect(run(text)).toContain(
      "({ name, ...props }: Props & Omit<Partial<React.ComponentProps<typeof Icon>>, 'name'>)",
    );
    expect(typeCheck(run(text))).toEqual([]);
    expect(typeCheck(text)).toHaveLength(1);
  });

  it('imports ComponentProps when the file has no React binding', () => {
    const text = `\
import Icon from './react-forwarded-props-target';

type Props = {
  name?: string;
};

export const IconContainer = ({ name, ...props }: Props) => <Icon {...props} name={name} />;
`;

    const result = reactForwardedPropsPlugin.run(
      fixturePluginParams({
        rootDir,
        fileName: fixtureFile,
        text,
        compilerOptions: { ...compilerOptions, jsx: ts.JsxEmit.ReactJSX },
        extraFiles: { 'react-forwarded-props-target.tsx': target },
      }),
    );

    expect(result).toBe(`\
import Icon from './react-forwarded-props-target';
import { ComponentProps } from "react";

type Props = {
  name?: string;
};

export const IconContainer = ({ name, ...props }: Props & Omit<Partial<ComponentProps<typeof Icon>>, 'name'>) => <Icon {...props} name={name} />;
`);
  });

  it('names an intrinsic element as the string tag it is', () => {
    const text = `\
import React from 'react';

type Props = {
  label?: string;
};

export const Field = ({ label, ...props }: Props) => <input {...props} placeholder={label} />;
`;

    expect(run(text)).toContain(
      "({ label, ...props }: Props & Omit<Partial<React.ComponentProps<'input'>>, 'label'>)",
    );
    expect(typeCheck(run(text))).toEqual([]);
  });

  it('widens an annotation that already carries an error of its own', () => {
    const text = `\
import React from 'react';
import Icon from './react-forwarded-props-target';

export const IconContainer = ({ name, ...props }: { label?: element; name?: string }) => (
  <Icon {...props} name={name} />
);
`;

    expect(run(text)).toContain(
      "{ label?: element; name?: string } & Omit<Partial<React.ComponentProps<typeof Icon>>, 'name'>",
    );
  });

  it('leaves a component whose rest is spread onto two different elements', () => {
    const text = `\
import React from 'react';
import Icon from './react-forwarded-props-target';

type Props = {
  name?: string;
  wide?: boolean;
};

export const IconContainer = ({ name, wide, ...props }: Props) =>
  wide ? <Icon {...props} name={name} /> : <span {...props} />;
`;

    expect(run(text)).toBe(text);
  });

  it('leaves a component with no rest element', () => {
    const text = `\
import React from 'react';
import Icon from './react-forwarded-props-target';

type Props = {
  name?: string;
};

export const IconContainer = ({ name }: Props) => <Icon name={name} />;
`;

    expect(run(text)).toBe(text);
  });

  it('leaves a props parameter annotated any', () => {
    const text = `\
import React from 'react';
import Icon from './react-forwarded-props-target';

export const IconContainer = ({ name, ...props }: any) => <Icon {...props} name={name} />;
`;

    expect(run(text)).toBe(text);
  });

  it('leaves a component whose props type already covers the target', () => {
    const text = `\
import React from 'react';
import Icon from './react-forwarded-props-target';

type Props = {
  name?: string;
  size?: number;
  className?: string;
};

export const IconContainer = ({ name, ...props }: Props) => <Icon {...props} name={name} />;
`;

    expect(run(text)).toBe(text);
  });

  it('leaves a component that forwards onto itself', () => {
    const text = `\
import React from 'react';

type Props = {
  depth?: number;
};

export const Nested = ({ depth, ...props }: Props) =>
  depth ? <Nested {...props} depth={depth - 1} /> : null;
`;

    expect(run(text)).toBe(text);
  });

  it('parenthesizes a union it widens', () => {
    const text = `\
import React from 'react';
import Icon from './react-forwarded-props-target';

type Small = { name?: string };
type Large = { name?: string; loud?: boolean };

export const IconContainer = ({ name, ...props }: Small | Large) => <Icon {...props} name={name} />;
`;

    expect(run(text)).toContain(
      "({ name, ...props }: (Small | Large) & Omit<Partial<React.ComponentProps<typeof Icon>>, 'name'>)",
    );
    expect(typeCheck(run(text))).toEqual([]);
  });

  it('leaves a file with no JSX extension', () => {
    const result = reactForwardedPropsPlugin.run(
      fixturePluginParams({
        rootDir,
        fileName: path.join(rootDir, 'react-forwarded-props-fixture.ts'),
        text: 'export const f = ({ a, ...rest }: { a?: string }) => [a, rest];\n',
        compilerOptions,
      }),
    );
    expect(result).toBeUndefined();
  });
});
