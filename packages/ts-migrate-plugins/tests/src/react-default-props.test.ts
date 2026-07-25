import ts from 'typescript';
import { PluginFileNotice } from '@obiemunoz/ts-migrate-server';
import reactDefaultPropsPlugin from '../../src/plugins/react-default-props';
import { mockPluginParams, realPluginParams } from '../test-utils';

const REACT_STUB = `declare namespace JSX {
  interface Element {}
  interface IntrinsicElements { [name: string]: any; }
}
declare module 'react' {
  const React: any;
  export default React;
  export const memo: any;
  export const forwardRef: any;
}`;

/** Parsed once: every typeCheck call below pulls in the same lib files. */
const libSourceFiles = new Map<string, ts.SourceFile | undefined>();

/** Compiles the given files in memory, resolving the lib files from disk. */
function typeCheck(files: { [fileName: string]: string }): string[] {
  const allFiles = { '/react-stub.d.ts': REACT_STUB, ...files };
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.React,
  };
  const host: ts.CompilerHost = {
    getSourceFile: (fileName, languageVersion) => {
      if (!(fileName in allFiles)) {
        if (!libSourceFiles.has(fileName)) {
          const libText = ts.sys.readFile(fileName);
          libSourceFiles.set(
            fileName,
            libText === undefined
              ? undefined
              : ts.createSourceFile(fileName, libText, languageVersion, true),
          );
        }
        return libSourceFiles.get(fileName);
      }
      return ts.createSourceFile(fileName, allFiles[fileName], languageVersion, true);
    },
    getDefaultLibFileName: (compilerOptions) => ts.getDefaultLibFilePath(compilerOptions),
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (fileName) => fileName in allFiles || ts.sys.fileExists(fileName),
    readFile: (fileName) => allFiles[fileName] ?? ts.sys.readFile(fileName),
  };
  const program = ts.createProgram(Object.keys(allFiles), options, host);
  return [...program.getSyntacticDiagnostics(), ...program.getSemanticDiagnostics()].map(
    (diagnostic) =>
      `TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
  );
}

describe('react-default-props plugin', () => {
  const options = { useDefaultPropsHelper: true };
  it('basic component with defaultProps as a variable', async () => {
    const text = `import React from 'react';

type Props = {
  test: string;
};

const defaultProps = {
  test: '',
};

function ExampleComponent({ test }: Props) {
  return <React.Fragment>{test}</React.Fragment>;
}
ExampleComponent.defaultProps = defaultProps;

export default ExampleComponent;`;

    const result = await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options }),
    );

    expect(result).toBe(`import React from 'react';

type WithDefaultProps<P, D> = Omit<P, keyof D> & { [K in keyof D & keyof P]: Exclude<P[K], undefined> | D[K] } & Omit<D, keyof P>;

type OwnProps = {
    test: string;
};

const defaultProps = {
  test: '',
};

type Props = WithDefaultProps<OwnProps, typeof defaultProps>;

function ExampleComponent({ test }: Props) {
  return <React.Fragment>{test}</React.Fragment>;
}
ExampleComponent.defaultProps = defaultProps;

export default ExampleComponent;`);
  });

  it('basic component with defaultProps as a variable, without helper', async () => {
    const text = `import React from 'react';

type Props = {
  test: string;
};

const defaultProps = {
  test: '',
};

function ExampleComponent({ test }: Props) {
  return <React.Fragment>{test}</React.Fragment>;
}
ExampleComponent.defaultProps = defaultProps;

export default ExampleComponent;`;

    const result = await reactDefaultPropsPlugin.run(
      mockPluginParams({
        text,
        fileName: 'file.tsx',
      }),
    );

    expect(result).toBe(`import React from 'react';

type OwnProps = {
    test: string;
};

const defaultProps = {
  test: '',
};

type Props = OwnProps & typeof defaultProps;

function ExampleComponent({ test }: Props) {
  return <React.Fragment>{test}</React.Fragment>;
}
ExampleComponent.defaultProps = defaultProps;

export default ExampleComponent;`);
  });

  it('arrow function component with defaultProps as a variable', async () => {
    const text = `import React from 'react';

type Props = {
  test: string;
};

const defaultProps = {
  test: '',
};

const ExampleComponent = ({ test }: Props) => {
  return <React.Fragment>{test}</React.Fragment>;
}
ExampleComponent.defaultProps = defaultProps;

export default ExampleComponent;`;

    const result = await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options }),
    );

    expect(result).toBe(`import React from 'react';

type WithDefaultProps<P, D> = Omit<P, keyof D> & { [K in keyof D & keyof P]: Exclude<P[K], undefined> | D[K] } & Omit<D, keyof P>;

type OwnProps = {
    test: string;
};

const defaultProps = {
  test: '',
};

type Props = WithDefaultProps<OwnProps, typeof defaultProps>;

const ExampleComponent = ({ test }: Props) => {
  return <React.Fragment>{test}</React.Fragment>;
}
ExampleComponent.defaultProps = defaultProps;

export default ExampleComponent;`);
  });

  it('basic component with defaultProps assignment as an object', async () => {
    const text = `import React from 'react';

type Props = {
  test: string;
};

function ExampleComponent({ test }: Props) {
  return <React.Fragment>{test}</React.Fragment>;
}
ExampleComponent.defaultProps = {
  test: '',
};

export default ExampleComponent;`;

    const result = await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options }),
    );

    expect(result).toBe(`import React from 'react';

type WithDefaultProps<P, D> = Omit<P, keyof D> & { [K in keyof D & keyof P]: Exclude<P[K], undefined> | D[K] } & Omit<D, keyof P>;

type OwnProps = {
    test: string;
};

type Props = WithDefaultProps<OwnProps, (typeof ExampleComponent)["defaultProps"]>;

function ExampleComponent({ test }: Props) {
  return <React.Fragment>{test}</React.Fragment>;
}
ExampleComponent.defaultProps = {
  test: '',
};

export default ExampleComponent;`);
  });

  it('compiles with the object literal assignment below the generated alias', async () => {
    const text = `import React from 'react';

type Props = {
  size?: string;
  label: string;
};

function Button({ size, label }: Props) {
  return <button className={size}>{label}</button>;
}
Button.defaultProps = {
  size: 'md',
};

export default Button;`;

    const intersection = (await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx' }),
    )) as string;
    expect(intersection).toContain('type Props = OwnProps & (typeof Button)["defaultProps"];');
    expect(typeCheck({ '/file.tsx': intersection })).toEqual([]);

    const withHelper = (await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options }),
    )) as string;
    expect(withHelper).toContain(
      'type Props = WithDefaultProps<OwnProps, (typeof Button)["defaultProps"]>;',
    );
    expect(typeCheck({ '/file.tsx': withHelper })).toEqual([]);
  });

  it('names the defaults of an arrow component that assigns them inline', async () => {
    const text = `import React from 'react';

type Props = {
  title: string;
};

const Greeting = ({ title }: Props) => {
  return <div>{title}</div>;
};
Greeting.defaultProps = {
  title: 'hi',
};

export default Greeting;`;

    const intersection = (await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx' }),
    )) as string;

    expect(intersection).toBe(`import React from 'react';

type OwnProps = {
    title: string;
};

const GreetingDefaultProps = {
  title: 'hi',
};

type Props = OwnProps & typeof GreetingDefaultProps;

const Greeting = ({ title }: Props) => {
  return <div>{title}</div>;
};
Greeting.defaultProps = GreetingDefaultProps;

export default Greeting;`);
    expect(typeCheck({ '/file.tsx': intersection })).toEqual([]);

    const withHelper = (await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options }),
    )) as string;
    expect(withHelper).toContain(
      'type Props = WithDefaultProps<OwnProps, typeof GreetingDefaultProps>;',
    );
    expect(withHelper).toContain('Greeting.defaultProps = GreetingDefaultProps;');
    expect(typeCheck({ '/file.tsx': withHelper })).toEqual([]);
  });

  it('leaves an arrow component alone when its defaults read a binding below it', async () => {
    const text = `import React from 'react';

type Props = {
  title: string;
};

const Greeting = ({ title }: Props) => {
  return <div>{title}</div>;
};

const DEFAULT_TITLE = 'hi';

Greeting.defaultProps = {
  title: DEFAULT_TITLE,
};

export default Greeting;`;

    const notices: PluginFileNotice[] = [];
    const result = await reactDefaultPropsPlugin.run(
      mockPluginParams({
        text,
        fileName: 'file.tsx',
        reportFileNotice: (notice) => notices.push(notice),
      }),
    );

    expect(result).toBe(text);
    expect(notices).toEqual([
      {
        reason:
          'Left Greeting without a defaults type: naming its defaults would move them above a binding they read.',
        hint: 'Declare the defaults in a const above the component to have them typed.',
        recovered: true,
      },
    ]);
    expect(typeCheck({ '/file.tsx': result as string })).toEqual([]);
  });

  it('names the defaults of every arrow component in the file', async () => {
    const text = `import React from 'react';

type ButtonProps = {
  size: string;
};

const Button = ({ size }: ButtonProps) => {
  return <button className={size} />;
};
Button.defaultProps = {
  size: 'md',
};

type LinkProps = {
  href: string;
};

const Link = ({ href }: LinkProps) => {
  return <a href={href} />;
};
Link.defaultProps = {
  href: '#',
};

export { Button, Link };`;

    const result = (await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx' }),
    )) as string;

    expect(result).toContain('type ButtonProps = OwnButtonProps & typeof ButtonDefaultProps;');
    expect(result).toContain('type LinkProps = OwnLinkProps & typeof LinkDefaultProps;');
    expect(typeCheck({ '/file.tsx': result })).toEqual([]);
  });

  it('leaves an arrow component it already named alone on a second run', async () => {
    const text = `import React from 'react';

type Props = {
  title: string;
};

const Greeting = ({ title }: Props) => {
  return <div>{title}</div>;
};
Greeting.defaultProps = {
  title: 'hi',
};

export default Greeting;`;

    const first = (await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx' }),
    )) as string;
    const second = await reactDefaultPropsPlugin.run(
      mockPluginParams({ text: first, fileName: 'file.tsx' }),
    );

    expect(second ?? first).toBe(first);
  });

  it('leaves a function declaration on the indexed access', async () => {
    const text = `import React from 'react';

type Props = {
  title: string;
};

function Greeting({ title }: Props) {
  return <div>{title}</div>;
}
Greeting.defaultProps = {
  title: 'hi',
};

export default Greeting;`;

    const result = (await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx' }),
    )) as string;

    expect(result).toBe(`import React from 'react';

type OwnProps = {
    title: string;
};

type Props = OwnProps & (typeof Greeting)["defaultProps"];

function Greeting({ title }: Props) {
  return <div>{title}</div>;
}
Greeting.defaultProps = {
  title: 'hi',
};

export default Greeting;`);
    expect(typeCheck({ '/file.tsx': result })).toEqual([]);
  });

  it('compiles with the alias above a class that states its defaults', async () => {
    const text = `import React from 'react';

type Props = {
  size?: string;
  label: string;
};

class Button extends React.Component<Props> {
  static defaultProps = {
    size: 'md',
  };

  render() {
    return <button className={this.props.size}>{this.props.label}</button>;
  }
}

export default Button;`;

    const result = (await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx' }),
    )) as string;
    expect(result).toContain('type Props = OwnProps & typeof Button.defaultProps;');
    expect(typeCheck({ '/file.tsx': result })).toEqual([]);
  });

  it('WithStylesProps in props type at first place', async () => {
    const text = `import React from 'react';
import { withStyles, WithStylesProps } from ':dls-themes/withStyles';

type Props = WithStylesProps & { message?: string };

const defaultProps = { message: '' };

function Hello({ message, css, styles }: Props) {
  return <div {...css(styles.container)}>{message}</div>;
}

Hello.defaultProps = defaultProps;
export default withStyles(() => ({
  container: {
    /* ... */
  },
}))(Hello);`;

    const result = await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options }),
    );

    expect(result).toBe(`import React from 'react';
import { withStyles, WithStylesProps } from ':dls-themes/withStyles';

type WithDefaultProps<P, D> = Omit<P, keyof D> & { [K in keyof D & keyof P]: Exclude<P[K], undefined> | D[K] } & Omit<D, keyof P>;

type OwnProps = {
    message?: string;
};

const defaultProps = { message: '' };

type Props = WithDefaultProps<OwnProps, typeof defaultProps> & WithStylesProps;

function Hello({ message, css, styles }: Props) {
  return <div {...css(styles.container)}>{message}</div>;
}

Hello.defaultProps = defaultProps;
export default withStyles(() => ({
  container: {
    /* ... */
  },
}))(Hello);`);
  });

  it('basic class component with default props', async () => {
    const text = `import React from 'react';
import { withStyles, WithStylesProps } from ':dls-themes/withStyles';

const defaultProps = { message: '' };

type Props = { message?: string } & WithStylesProps;

class Hello extends React.Component<Props> {
  static defaultProps = defaultProps;

  render() {
    const { message, css, styles } = this.props;
    return <div {...css(styles.container)}>{message}</div>;
  }
}

export default withStyles(() => ({
  container: {
    /* ... */
  },
}))(Hello);`;

    const result = await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options }),
    );

    expect(result).toBe(`import React from 'react';
import { withStyles, WithStylesProps } from ':dls-themes/withStyles';

type WithDefaultProps<P, D> = Omit<P, keyof D> & { [K in keyof D & keyof P]: Exclude<P[K], undefined> | D[K] } & Omit<D, keyof P>;

const defaultProps = { message: '' };

type OwnProps = {
    message?: string;
};

type Props = WithDefaultProps<OwnProps, typeof defaultProps> & WithStylesProps;

class Hello extends React.Component<Props> {
  static defaultProps = defaultProps;

  render() {
    const { message, css, styles } = this.props;
    return <div {...css(styles.container)}>{message}</div>;
  }
}

export default withStyles(() => ({
  container: {
    /* ... */
  },
}))(Hello);`);
  });

  it('class with default props and state', async () => {
    const text = `import React from 'react';

type MyProps = { message: string };
type MyState = $TSFixMe;

const defaulPrs = { message: 'hello' }

class Foo extends React.Component<MyProps, MyState> {
  static defaultProps = defaulPrs;
  render() {
    return this.state.loading
      ? <div>Loading...</div>
      : <div>{this.props.message}</div>;
  }
}

export default Foo;`;

    const result = await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options }),
    );

    expect(result).toBe(`import React from 'react';

type WithDefaultProps<P, D> = Omit<P, keyof D> & { [K in keyof D & keyof P]: Exclude<P[K], undefined> | D[K] } & Omit<D, keyof P>;

type OwnMyProps = {
    message: string;
};
type MyState = $TSFixMe;

const defaulPrs = { message: 'hello' }

type MyProps = WithDefaultProps<OwnMyProps, typeof defaulPrs>;

class Foo extends React.Component<MyProps, MyState> {
  static defaultProps = defaulPrs;
  render() {
    return this.state.loading
      ? <div>Loading...</div>
      : <div>{this.props.message}</div>;
  }
}

export default Foo;`);
  });

  it('class with default props as a value', async () => {
    const text = `import React from 'react';

type MyProps = { message: string };
type MyState = $TSFixMe;

class Foo extends React.Component<MyProps, MyState> {
  static defaultProps = {
    message: 'in class',
  };
  render() {
    return this.state.loading
      ? <div>Loading...</div>
      : <div>{this.props.message}</div>;
  }
}

export default Foo;`;

    const result = await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options }),
    );

    expect(result).toBe(`import React from 'react';

type WithDefaultProps<P, D> = Omit<P, keyof D> & { [K in keyof D & keyof P]: Exclude<P[K], undefined> | D[K] } & Omit<D, keyof P>;

type OwnMyProps = {
    message: string;
};
type MyState = $TSFixMe;

type MyProps = WithDefaultProps<OwnMyProps, typeof Foo.defaultProps>;

class Foo extends React.Component<MyProps, MyState> {
  static defaultProps = {
    message: 'in class',
  };
  render() {
    return this.state.loading
      ? <div>Loading...</div>
      : <div>{this.props.message}</div>;
  }
}

export default Foo;`);
  });

  it('do not break class without default props', async () => {
    const text = `import React from 'react';

type MyProps = { message: string };
type MyState = $TSFixMe;

class Foo extends React.Component<MyProps, MyState> {
  render() {
    return this.state.loading
      ? <div>Loading...</div>
      : <div>{this.props.message}</div>;
  }
}

export default Foo;`;

    const result = await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options }),
    );

    expect(result).toBe(undefined);
  });

  it('do not perform default props plugin logic multiple times', async () => {
    const text = `import { WithDefaultProps } from ":ts-utils/types/WithDefaultProps";
import React from 'react';

type OwnMyProps = {
    message: string;
};
type MyState = $TSFixMe;

const defaulPrs = { message: 'hello' };

type MyProps = WithDefaultProps<OwnMyProps, typeof defaulPrs>;

class Foo extends React.Component<MyProps, MyState> {
  static defaultProps = defaulPrs;
  render() {
    return this.state.loading
      ? <div>Loading...</div>
      : <div>{this.props.message}</div>;
  }
}
export default Foo;`;

    const result = await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options }),
    );

    expect(result).toBe(`import { WithDefaultProps } from ":ts-utils/types/WithDefaultProps";
import React from 'react';

type OwnMyProps = {
    message: string;
};
type MyState = $TSFixMe;

const defaulPrs = { message: 'hello' };

type MyProps = WithDefaultProps<OwnMyProps, typeof defaulPrs>;

class Foo extends React.Component<MyProps, MyState> {
  static defaultProps = defaulPrs;
  render() {
    return this.state.loading
      ? <div>Loading...</div>
      : <div>{this.props.message}</div>;
  }
}
export default Foo;`);
  });

  it('do not perform default props plugin logic multiple times', async () => {
    const text = `import React from 'react';
type Props = {
    message: string;
};

type MyState = {};

const defaultProps = { message: 'hello' };

type PrivateProps = OwnMyProps & typeof defaultProps;

class Foo extends React.Component<MyProps, MyState> {
  static defaultProps = defaultProps;
  render() {
    return this.state.loading
      ? <div>Loading...</div>
      : <div>{this.props.message}</div>;
  }
}
export default Foo;`;

    const result = await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options }),
    );

    expect(result).toBe(`import React from 'react';
type Props = {
    message: string;
};

type MyState = {};

const defaultProps = { message: 'hello' };

type PrivateProps = OwnMyProps & typeof defaultProps;

class Foo extends React.Component<MyProps, MyState> {
  static defaultProps = defaultProps;
  render() {
    return this.state.loading
      ? <div>Loading...</div>
      : <div>{this.props.message}</div>;
  }
}
export default Foo;`);
  });

  it('default props already exists for sfcs', async () => {
    const text = `import React from 'react';
import { withStyles, WithStylesProps } from ':dls-themes/withStyles';

type Props = {} & WithStylesProps;

const defaultProps = {};

type PrivateProps = Props & typeof defaultProps;

function FlowHeader({ styles, css, theme }: PrivateProps) {
  return (
    <div {...css(styles.headerWrapper)}></div>
  );
}

FlowHeader.defaultProps = defaultProps;

export default withStyles(() => ({
  headerWrapper: {
    height: 48,
  },
}))(FlowHeader) as FlowHeader<Props>;`;

    const result = await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options }),
    );

    expect(result).toBe(`import React from 'react';
import { withStyles, WithStylesProps } from ':dls-themes/withStyles';

type Props = {} & WithStylesProps;

const defaultProps = {};

type PrivateProps = Props & typeof defaultProps;

function FlowHeader({ styles, css, theme }: PrivateProps) {
  return (
    <div {...css(styles.headerWrapper)}></div>
  );
}

FlowHeader.defaultProps = defaultProps;

export default withStyles(() => ({
  headerWrapper: {
    height: 48,
  },
}))(FlowHeader) as FlowHeader<Props>;`);
  });

  it('complex file with multiple component and mupltiple default props', async () => {
    const text = `import { WithDefaultProps } from ":ts-utils/types/WithDefaultProps";
import React from 'react';
import { withStyles, WithStylesProps } from ':dls-themes/withStyles';

type TrElementProps = {
  children: React.ReactNode;
  onClick?: $TSFixMeFunction;
  onMouseEnter?: $TSFixMeFunction;
  onMouseLeave?: $TSFixMeFunction;
  role?: string;
  tabIndex?: string;
  strongAccentOnHover?: boolean;
} & WithStylesProps;

const trDefaultProps = {
  onClick: null,
  onMouseEnter: null,
  onMouseLeave: null,
  role: null,
  tabIndex: null,
  strongAccentOnHover: false,
};

const TrElement = ({
  css,
  styles,
  children,
  onClick,
  role,
  tabIndex,
  onMouseEnter,
  onMouseLeave,
  strongAccentOnHover,
}: TrElementProps) => (
  <tr
    {...css(
      onClick && styles.tr_clickable,
      strongAccentOnHover && styles.tr_strong_accent_on_hover,
    )}
    onClick={onClick}
    role={role}
    // @ts-ignore ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
    tabIndex={tabIndex}
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
  >
    {children}
  </tr>
);
TrElement.defaultProps = trDefaultProps;

export const Tr = withStyles(({ color }) => ({
  tr_clickable: {
    ':hover': {
      cursor: 'pointer',
      backgroundColor: color.accent.bgGray,
    },
  },
  tr_strong_accent_on_hover: {
    ':hover': {
      color: color.white,
      backgroundColor: color.core.babu,
    },
  },
}))(TrElement);`;

    const result = await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options }),
    );

    expect(result).toBe(`import { WithDefaultProps } from ":ts-utils/types/WithDefaultProps";
import React from 'react';
import { withStyles, WithStylesProps } from ':dls-themes/withStyles';

type OwnTrElementProps = {
    children: React.ReactNode;
    onClick?: $TSFixMeFunction;
    onMouseEnter?: $TSFixMeFunction;
    onMouseLeave?: $TSFixMeFunction;
    role?: string;
    tabIndex?: string;
    strongAccentOnHover?: boolean;
};

const trDefaultProps = {
  onClick: null,
  onMouseEnter: null,
  onMouseLeave: null,
  role: null,
  tabIndex: null,
  strongAccentOnHover: false,
};

type TrElementProps = WithDefaultProps<OwnTrElementProps, typeof trDefaultProps> & WithStylesProps;

const TrElement = ({
  css,
  styles,
  children,
  onClick,
  role,
  tabIndex,
  onMouseEnter,
  onMouseLeave,
  strongAccentOnHover,
}: TrElementProps) => (
  <tr
    {...css(
      onClick && styles.tr_clickable,
      strongAccentOnHover && styles.tr_strong_accent_on_hover,
    )}
    onClick={onClick}
    role={role}
    // @ts-ignore ts-migrate(2322) FIXME: Type 'string' is not assignable to type 'number | ... Remove this comment to see the full error message
    tabIndex={tabIndex}
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
  >
    {children}
  </tr>
);
TrElement.defaultProps = trDefaultProps;

export const Tr = withStyles(({ color }) => ({
  tr_clickable: {
    ':hover': {
      cursor: 'pointer',
      backgroundColor: color.accent.bgGray,
    },
  },
  tr_strong_accent_on_hover: {
    ':hover': {
      color: color.white,
      backgroundColor: color.core.babu,
    },
  },
}))(TrElement);`);
  });

  it('multiple components in one file', async () => {
    const text = `import React from 'react';

const SIZES = {
  LARGE: 'large',
  JUMBO: 'jumbo',
};

type AddEmailWidgetProps = {
  email?: string;
};

const defaultProps = {
  onSubmit() {},
  onImpression() {},
  onFinished() {},
  onError() {},
  size: SIZES.LARGE,
};

const INPUT_CLASS = {
  large: 'input-large',
  jumbo: 'input-jumbo',
};

const BTN_CLASS = {
  large: 'btn-large',
  jumbo: 'btn-jumbo',
};

type UpdatedEmailProps = {
  size?: $TSFixMe; // TODO: PropTypes.oneOf(Object.values(SIZES))
  email: string;
};

function UpdatedEmail({ size }: UpdatedEmailProps) {
  // @ts-ignore ts-migrate(7017) FIXME: Element implicitly has an 'any' type because type ... Remove this comment to see the full error message
  const inputClass = INPUT_CLASS[size];
  return <div className="row email-update-form" />;
}

UpdatedEmail.defaultProps = {
  size: SIZES.LARGE,
};

type EmailFormProps = {
  size?: $TSFixMe; // TODO: PropTypes.oneOf(Object.values(SIZES))
  status?: $TSFixMe; // TODO: PropTypes.oneOf(Object.values(EmailUpdateStatuses))
  email?: string;
  errorMessage?: string;
  onChangedInput: $TSFixMeFunction;
  onClickSubmit: $TSFixMeFunction;
};

function EmailForm({ size, status }: EmailFormProps) {
  const inputClass = INPUT_CLASS[size];
  const btnClass = BTN_CLASS[size];

  return <div />;
}

EmailForm.defaultProps = {
  size: SIZES.LARGE,
  errorMessage: null,
  email: null,
  status: 'EmailUpdateStatuses.AWAITING_INPUT',
};

class AddEmailWidget extends React.Component<AddEmailWidgetProps> {
  static defaultProps = defaultProps;

  constructor(props: AddEmailWidgetProps) {
    super(props);
  }

  render() {
    const { status, email, size } = this.props;

    if (status === 'EmailUpdateStatuses.SUCCESS') {
      return <div />;
    }
    return <div />;
  }
}

export default AddEmailWidget;
`;
    const result = await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options }),
    );

    expect(result).toBe(`import React from 'react';

type WithDefaultProps<P, D> = Omit<P, keyof D> & { [K in keyof D & keyof P]: Exclude<P[K], undefined> | D[K] } & Omit<D, keyof P>;

const SIZES = {
  LARGE: 'large',
  JUMBO: 'jumbo',
};

type OwnAddEmailWidgetProps = {
    email?: string;
};

const defaultProps = {
  onSubmit() {},
  onImpression() {},
  onFinished() {},
  onError() {},
  size: SIZES.LARGE,
};

const INPUT_CLASS = {
  large: 'input-large',
  jumbo: 'input-jumbo',
};

const BTN_CLASS = {
  large: 'btn-large',
  jumbo: 'btn-jumbo',
};

type OwnUpdatedEmailProps = {
    size?: $TSFixMe; // TODO: PropTypes.oneOf(Object.values(SIZES))
    email: string;
};

type UpdatedEmailProps = WithDefaultProps<OwnUpdatedEmailProps, (typeof UpdatedEmail)["defaultProps"]>;

function UpdatedEmail({ size }: UpdatedEmailProps) {
  // @ts-ignore ts-migrate(7017) FIXME: Element implicitly has an 'any' type because type ... Remove this comment to see the full error message
  const inputClass = INPUT_CLASS[size];
  return <div className="row email-update-form" />;
}

UpdatedEmail.defaultProps = {
  size: SIZES.LARGE,
};

type OwnEmailFormProps = {
    size?: $TSFixMe; // TODO: PropTypes.oneOf(Object.values(SIZES))
    status?: $TSFixMe; // TODO: PropTypes.oneOf(Object.values(EmailUpdateStatuses))
    email?: string;
    errorMessage?: string;
    onChangedInput: $TSFixMeFunction;
    onClickSubmit: $TSFixMeFunction;
};

type EmailFormProps = WithDefaultProps<OwnEmailFormProps, (typeof EmailForm)["defaultProps"]>;

function EmailForm({ size, status }: EmailFormProps) {
  const inputClass = INPUT_CLASS[size];
  const btnClass = BTN_CLASS[size];

  return <div />;
}

EmailForm.defaultProps = {
  size: SIZES.LARGE,
  errorMessage: null,
  email: null,
  status: 'EmailUpdateStatuses.AWAITING_INPUT',
};

type AddEmailWidgetProps = WithDefaultProps<OwnAddEmailWidgetProps, typeof defaultProps>;

class AddEmailWidget extends React.Component<AddEmailWidgetProps> {
  static defaultProps = defaultProps;

  constructor(props: AddEmailWidgetProps) {
    super(props);
  }

  render() {
    const { status, email, size } = this.props;

    if (status === 'EmailUpdateStatuses.SUCCESS') {
      return <div />;
    }
    return <div />;
  }
}

export default AddEmailWidget;
`);
  });

  it('custom default props, resulted as $TSFixMe', async () => {
    const text = `import PropTypes from 'prop-types';
import React from 'react';

const noOnPressWithLink = mutuallyExclusiveProps(PropTypes.func, 'link', 'onPress');

export const propTypes = {
  ...baseRowPropTypes,
  actionText: noActionTextWithLink,
  onPress: noOnPressWithLink,
  subtitle: PropTypes.oneOfType([textlike, PropTypes.arrayOf(textlike)]),
  small: PropTypes.bool,
  title: textlike.isRequired,
};

export const defaultProps = {
  ...baseRowDefaultProps,
  baseline: lineTypes.FULL,
  small: false,
};

export default function ActionRowWithReactRouter({
  actionText,
  onPress,
  subtitle,
  title,
  small,
  link,

  // BaseRow props
  ...rowProps
}: $TSFixMe) {
  return <div />;
}

ActionRowWithReactRouter.propTypes = forbidExtraProps(propTypes);
ActionRowWithReactRouter.defaultProps = defaultProps;
`;
    const result = await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options }),
    );

    expect(result).toBe(`import PropTypes from 'prop-types';
import React from 'react';

const noOnPressWithLink = mutuallyExclusiveProps(PropTypes.func, 'link', 'onPress');

export const propTypes = {
  ...baseRowPropTypes,
  actionText: noActionTextWithLink,
  onPress: noOnPressWithLink,
  subtitle: PropTypes.oneOfType([textlike, PropTypes.arrayOf(textlike)]),
  small: PropTypes.bool,
  title: textlike.isRequired,
};

export const defaultProps = {
  ...baseRowDefaultProps,
  baseline: lineTypes.FULL,
  small: false,
};

export default function ActionRowWithReactRouter({
  actionText,
  onPress,
  subtitle,
  title,
  small,
  link,

  // BaseRow props
  ...rowProps
}: $TSFixMe) {
  return <div />;
}

ActionRowWithReactRouter.propTypes = forbidExtraProps(propTypes);
ActionRowWithReactRouter.defaultProps = defaultProps;
`);
  });

  it('example with proptype contains only a type references', async () => {
    const text = `import React from 'react';
import { withStyles, WithStylesProps } from ':dls-themes/withStyles';

type Props = {
  activeRouteName?: string;
  isSaving: boolean;
  lastSavedTimeStamp?: number;
  listingId: number | string;
  logLYSExitMethod: (
    activeRouteName: string | undefined,
    listingId: string | number,
    method: string,
  ) => void;
  onSaveAndExit: () => void;
  setHeadingRef?: () => void;
  step?: number;
  stepTitle?: string;
};

type PrivateProps = Props & WithStylesProps;

const defaultProps = {
  activeRouteName: '',
  setHeadingRef() {},
  lastSavedTimeStamp: null,
  listingId: null,
  onSaveAndExit() {},
  stepTitle: '',
};

class Navbar extends React.Component<PrivateProps> {
  static defaultProps = defaultProps;

  constructor(props: PrivateProps) {
    super(props);
  }

  render() {
    const {
      css,
      isSaving,
      lastSavedTimeStamp,
      listingId,
      setHeadingRef,
      step,
      stepTitle,
      styles,
    } = this.props;

    return <div {...css(styles.airbnbHeader)} />;
  }
}

export default withStyles(({ color, responsive }) => ({
  airbnbHeader: {
    width: '100%',
  },
}))(Navbar);`;
    const result = await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options }),
    );
    expect(result).toBe(`import React from 'react';
import { withStyles, WithStylesProps } from ':dls-themes/withStyles';

type WithDefaultProps<P, D> = Omit<P, keyof D> & { [K in keyof D & keyof P]: Exclude<P[K], undefined> | D[K] } & Omit<D, keyof P>;

type Props = {
  activeRouteName?: string;
  isSaving: boolean;
  lastSavedTimeStamp?: number;
  listingId: number | string;
  logLYSExitMethod: (
    activeRouteName: string | undefined,
    listingId: string | number,
    method: string,
  ) => void;
  onSaveAndExit: () => void;
  setHeadingRef?: () => void;
  step?: number;
  stepTitle?: string;
};

type OwnPrivateProps = Props & WithStylesProps;

const defaultProps = {
  activeRouteName: '',
  setHeadingRef() {},
  lastSavedTimeStamp: null,
  listingId: null,
  onSaveAndExit() {},
  stepTitle: '',
};

type PrivateProps = WithDefaultProps<OwnPrivateProps, typeof defaultProps>;

class Navbar extends React.Component<PrivateProps> {
  static defaultProps = defaultProps;

  constructor(props: PrivateProps) {
    super(props);
  }

  render() {
    const {
      css,
      isSaving,
      lastSavedTimeStamp,
      listingId,
      setHeadingRef,
      step,
      stepTitle,
      styles,
    } = this.props;

    return <div {...css(styles.airbnbHeader)} />;
  }
}

export default withStyles(({ color, responsive }) => ({
  airbnbHeader: {
    width: '100%',
  },
}))(Navbar);`);
  });

  it('one prop types for the multiple component', async () => {
    const text = `import React from 'react';

type Props = {
  instantBookingAllowedCategory: string;
  listingId: number;
  forAvailabilityAllSettings: boolean;
};
type State = {
  didClickExpand: boolean;
  isLoadingRequirements: boolean;
};

const defaultProps = {
  forAvailabilityAllSettings: false,
  buildingInstantBookingAllowedCategory: '',
};

export class GuestRequirementsContent extends React.Component<Props, State> {
  static defaultProps = defaultProps;

  constructor(props: Props) {
    super(props);
  }

  render() {
    return <div />;
  }
}

export default class GuestRequirements extends React.Component<Props> {
  static defaultProps = defaultProps;

  render() {
    return <StepContainer></StepContainer>;
  }
}`;

    const result = await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options }),
    );

    expect(result).toBe(`import React from 'react';

type WithDefaultProps<P, D> = Omit<P, keyof D> & { [K in keyof D & keyof P]: Exclude<P[K], undefined> | D[K] } & Omit<D, keyof P>;

type OwnProps = {
    instantBookingAllowedCategory: string;
    listingId: number;
    forAvailabilityAllSettings: boolean;
};
type State = {
  didClickExpand: boolean;
  isLoadingRequirements: boolean;
};

const defaultProps = {
  forAvailabilityAllSettings: false,
  buildingInstantBookingAllowedCategory: '',
};

type Props = WithDefaultProps<OwnProps, typeof defaultProps>;

export class GuestRequirementsContent extends React.Component<Props, State> {
  static defaultProps = defaultProps;

  constructor(props: Props) {
    super(props);
  }

  render() {
    return <div />;
  }
}

export default class GuestRequirements extends React.Component<Props> {
  static defaultProps = defaultProps;

  render() {
    return <StepContainer></StepContainer>;
  }
}`);
  });

  it('dont rename exported type', async () => {
    const text = `import React from 'react';

export type Props = {
  test: string;
};

const defaultProps = {
  test: '',
};

function ExampleComponent({ test }: Props) {
  return <React.Fragment>{test}</React.Fragment>;
}
ExampleComponent.defaultProps = defaultProps;

export default ExampleComponent;`;

    const result = await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options }),
    );

    expect(result).toBe(`import React from 'react';

type WithDefaultProps<P, D> = Omit<P, keyof D> & { [K in keyof D & keyof P]: Exclude<P[K], undefined> | D[K] } & Omit<D, keyof P>;

export type Props = {
    test: string;
};

const defaultProps = {
  test: '',
};

type PrivateProps = WithDefaultProps<Props, typeof defaultProps>;

function ExampleComponent({ test }: PrivateProps) {
  return <React.Fragment>{test}</React.Fragment>;
}
ExampleComponent.defaultProps = defaultProps;

export default ExampleComponent;`);
  });

  it('dont rename exported type of the class component', async () => {
    const text = `import React from 'react';

export type MyProps = { message: string };
export type MyState = $TSFixMe;

export const defaulPrs = { message: 'hello' }

class Foo extends React.Component<MyProps, MyState> {
  static defaultProps = defaulPrs;
  render() {
    return this.state.loading
      ? <div>Loading...</div>
      : <div>{this.props.message}</div>;
  }
}

export default Foo;`;

    const result = await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options }),
    );

    expect(result).toBe(`import React from 'react';

type WithDefaultProps<P, D> = Omit<P, keyof D> & { [K in keyof D & keyof P]: Exclude<P[K], undefined> | D[K] } & Omit<D, keyof P>;

export type MyProps = {
    message: string;
};
export type MyState = $TSFixMe;

export const defaulPrs = { message: 'hello' }

type PrivateMyProps = WithDefaultProps<MyProps, typeof defaulPrs>;

class Foo extends React.Component<PrivateMyProps, MyState> {
  static defaultProps = defaulPrs;
  render() {
    return this.state.loading
      ? <div>Loading...</div>
      : <div>{this.props.message}</div>;
  }
}

export default Foo;`);
  });

  it('keeps the space before the renamed annotation of an exported props type', async () => {
    const declaration = `import React from 'react';

export type Props = {
  title: string;
};

function Greeting({ title }: Props) {
  return <div>{title}</div>;
}
Greeting.defaultProps = {
  title: 'hi',
};

export default Greeting;`;

    const fromDeclaration = (await reactDefaultPropsPlugin.run(
      mockPluginParams({ text: declaration, fileName: 'file.tsx' }),
    )) as string;

    expect(fromDeclaration).toBe(`import React from 'react';

export type Props = {
    title: string;
};

type PrivateProps = Props & (typeof Greeting)["defaultProps"];

function Greeting({ title }: PrivateProps) {
  return <div>{title}</div>;
}
Greeting.defaultProps = {
  title: 'hi',
};

export default Greeting;`);
    expect(typeCheck({ '/file.tsx': fromDeclaration })).toEqual([]);

    const arrow = `import React from 'react';

export type Props = {
  title: string;
};

const Greeting = ({ title }: Props) => {
  return <div>{title}</div>;
};
Greeting.defaultProps = {
  title: 'hi',
};

export default Greeting;`;

    const fromArrow = (await reactDefaultPropsPlugin.run(
      mockPluginParams({ text: arrow, fileName: 'file.tsx' }),
    )) as string;

    expect(fromArrow).toBe(`import React from 'react';

export type Props = {
    title: string;
};

const GreetingDefaultProps = {
  title: 'hi',
};

type PrivateProps = Props & typeof GreetingDefaultProps;

const Greeting = ({ title }: PrivateProps) => {
  return <div>{title}</div>;
};
Greeting.defaultProps = GreetingDefaultProps;

export default Greeting;`);
    expect(typeCheck({ '/file.tsx': fromArrow })).toEqual([]);

    const withHelper = (await reactDefaultPropsPlugin.run(
      mockPluginParams({ text: arrow, fileName: 'file.tsx', options }),
    )) as string;

    expect(withHelper).toContain('const Greeting = ({ title }: PrivateProps) => {');
    expect(typeCheck({ '/file.tsx': withHelper })).toEqual([]);
  });

  it(`don't fix existing prop types`, async () => {
    const text = `import React from 'react';
import { WithDefaultProps } from ':ts-utils/types/WithDefaultProps';

type OwnProps = {
  kind?: 'some';
  termsUrl?: string;
};

type Props = WithDefaultProps<OwnProps, typeof Modal.defaultProps> & WithStylesProps;
type State = { modalVisible: boolean };

class Modal extends React.Component<Props, State> {
  static defaultProps = {
    kind: 'some' as const,
    termsUrl: '',
  };

  $focusedNode: HTMLElement | undefined;

  constructor(props: Props) {
    super(props);
  }

  render() {
    return <div {...css(styles.container)} />;
  }
}

export default withStyles(() => ({
  container: {
    display: 'inline-block',
    marginLeft: 3,
  },
}))(Modal);
`;

    const result = await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options }),
    );

    expect(result).toBe(`import React from 'react';
import { WithDefaultProps } from ':ts-utils/types/WithDefaultProps';

type OwnProps = {
  kind?: 'some';
  termsUrl?: string;
};

type Props = WithDefaultProps<OwnProps, typeof Modal.defaultProps> & WithStylesProps;
type State = { modalVisible: boolean };

class Modal extends React.Component<Props, State> {
  static defaultProps = {
    kind: 'some' as const,
    termsUrl: '',
  };

  $focusedNode: HTMLElement | undefined;

  constructor(props: Props) {
    super(props);
  }

  render() {
    return <div {...css(styles.container)} />;
  }
}

export default withStyles(() => ({
  container: {
    display: 'inline-block',
    marginLeft: 3,
  },
}))(Modal);
`);
  });

  it(`do not duplicate OwnProps declaration`, async () => {
    const text = `
import React from 'react';
import PropTypes from 'prop-types';
type State = {
  expanded: boolean;
};
interface OwnProps {
  onSelectInstallmentFee: (value: number) => Promise<any>;
  renderLayout: RenderLayout | null;
  isCheckoutPlatform?: boolean;
}
type Props = InstallmentFeesSelectorProps & OwnProps & WithLoggingContextProps;
class InstallmentSelector extends React.Component<Props, State> {
  static propTypes = {
    InstallmentFees: PropTypes.arrayOf(InstallmentFeeShape).isRequired,
    eligible: PropTypes.bool.isRequired,
    fetchInstallmentFees: PropTypes.func.isRequired,
    gibraltarInstrumentType: EGibraltarInstrumentTypeShape,
    onSelectInstallmentFee: PropTypes.func.isRequired,
    productPriceQuoteToken: PropTypes.string,
    renderLayout: PropTypes.func,
    selectInstallmentFee: PropTypes.func.isRequired,
    selectedBInstallmentFeeCount: PropTypes.number.isRequired,
    wrapWithLoading: PropTypes.func.isRequired,
  };
  static defaultProps = {
    renderLayout: null,
  };
  constructor(props: Props) {
    super(props);
    this.state = {
      expanded: false,
    };
    this.onChange = this.onChange.bind(this);
  }
  componentDidMount() {
  }
  componentDidUpdate(prevProps: Props) {
  }
  onChange(numStr: string) {}
  render() {
    return Component;
  }
}
export default InstallmentSelector;
`;

    const result = await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx' }),
    );

    expect(result).toBe(`
import React from 'react';
import PropTypes from 'prop-types';
type State = {
  expanded: boolean;
};
interface OwnProps {
  onSelectInstallmentFee: (value: number) => Promise<any>;
  renderLayout: RenderLayout | null;
  isCheckoutPlatform?: boolean;
}

type OwnInstallmentSelectorProps = InstallmentFeesSelectorProps & OwnProps & WithLoggingContextProps;

type Props = (OwnInstallmentSelectorProps & typeof InstallmentSelector.defaultProps);
class InstallmentSelector extends React.Component<Props, State> {
  static propTypes = {
    InstallmentFees: PropTypes.arrayOf(InstallmentFeeShape).isRequired,
    eligible: PropTypes.bool.isRequired,
    fetchInstallmentFees: PropTypes.func.isRequired,
    gibraltarInstrumentType: EGibraltarInstrumentTypeShape,
    onSelectInstallmentFee: PropTypes.func.isRequired,
    productPriceQuoteToken: PropTypes.string,
    renderLayout: PropTypes.func,
    selectInstallmentFee: PropTypes.func.isRequired,
    selectedBInstallmentFeeCount: PropTypes.number.isRequired,
    wrapWithLoading: PropTypes.func.isRequired,
  };
  static defaultProps = {
    renderLayout: null,
  };
  constructor(props: Props) {
    super(props);
    this.state = {
      expanded: false,
    };
    this.onChange = this.onChange.bind(this);
  }
  componentDidMount() {
  }
  componentDidUpdate(prevProps: Props) {
  }
  onChange(numStr: string) {}
  render() {
    return Component;
  }
}
export default InstallmentSelector;
`);
  });

  it('helper output typechecks without the Airbnb ts-utils module', async () => {
    const text = `import React from 'react';

type Props = {
  test: string;
  role?: string;
};

const defaultProps = {
  test: '',
  role: null,
};

function ExampleComponent({ test, role }: Props) {
  return <React.Fragment>{test}{role}</React.Fragment>;
}
ExampleComponent.defaultProps = defaultProps;

export default ExampleComponent;`;

    const result = (await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options }),
    )) as string;

    expect(result).toContain('type WithDefaultProps<P, D> =');
    expect(result).not.toContain(':ts-utils');

    const params = await realPluginParams({
      fileName: 'file.tsx',
      text: result,
      compilerOptions: { jsx: ts.JsxEmit.React },
      extraFiles: {
        'react-stub.d.ts': `declare namespace JSX {
  interface Element {}
  interface IntrinsicElements { [name: string]: any; }
}
declare module 'react' {
  const React: any;
  export default React;
}`,
      },
    });
    const languageService = params.getLanguageService();
    const diagnostics = [
      ...languageService.getSyntacticDiagnostics(params.fileName),
      ...languageService.getSemanticDiagnostics(params.fileName),
    ];
    expect(
      diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
    ).toEqual([]);
  });

  it('do not emit the helper again when the file already declares it', async () => {
    const text = `import React from 'react';

type WithDefaultProps<P, D> = Omit<P, keyof D> & { [K in keyof D & keyof P]: Exclude<P[K], undefined> | D[K] } & Omit<D, keyof P>;

type Props = {
  test: string;
};

const defaultProps = {
  test: '',
};

function ExampleComponent({ test }: Props) {
  return <React.Fragment>{test}</React.Fragment>;
}
ExampleComponent.defaultProps = defaultProps;

export default ExampleComponent;`;

    const result = (await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options }),
    )) as string;

    expect(result.match(/type WithDefaultProps</g)).toHaveLength(1);
    expect(result).toBe(`import React from 'react';

type WithDefaultProps<P, D> = Omit<P, keyof D> & { [K in keyof D & keyof P]: Exclude<P[K], undefined> | D[K] } & Omit<D, keyof P>;

type OwnProps = {
    test: string;
};

const defaultProps = {
  test: '',
};

type Props = WithDefaultProps<OwnProps, typeof defaultProps>;

function ExampleComponent({ test }: Props) {
  return <React.Fragment>{test}</React.Fragment>;
}
ExampleComponent.defaultProps = defaultProps;

export default ExampleComponent;`);
  });
});

describe('react-default-props plugin, modernizeDefaultProps', () => {
  const options = { modernizeDefaultProps: true };

  const modernize = (text: string, notices?: PluginFileNotice[]) =>
    reactDefaultPropsPlugin.run(
      mockPluginParams({
        text,
        fileName: 'file.tsx',
        options,
        reportFileNotice: notices ? (notice) => notices.push(notice) : undefined,
      }),
    ) as Promise<string | undefined>;

  /** The gates fall back to the typing path, which is the run without the flag. */
  const expectFallback = async (text: string, reason?: string) => {
    const notices: PluginFileNotice[] = [];
    const modernized = await modernize(text, notices);
    const legacy = await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options: {} }),
    );

    expect(modernized).toEqual(legacy);
    expect(modernized ?? text).toContain('defaultProps');
    if (reason !== undefined) {
      expect(notices.map((notice) => notice.reason)).toEqual([
        `Left defaultProps in place: ${reason}.`,
      ]);
    }
    return notices;
  };

  it('moves object literal defaults into the parameter and makes the props optional', async () => {
    const text = `import React from 'react';

type Props = {
  size: string;
  label: string;
};

function Button({ size, label }: Props) {
  return <button className={size}>{label}</button>;
}
Button.defaultProps = {
  size: 'md',
};

export default Button;`;

    expect(await modernize(text)).toBe(`import React from 'react';

type Props = {
  size?: string;
  label: string;
};

function Button({ size = 'md', label }: Props) {
  return <button className={size}>{label}</button>;
}

export default Button;`);
  });

  it('deletes the defaults object when the assignment was its only use', async () => {
    const text = `import React from 'react';

type Props = {
  size?: string;
  label: string;
};

const defaultProps = {
  size: 'md',
};

function Button({ size, label }: Props) {
  return <button className={size}>{label}</button>;
}
Button.defaultProps = defaultProps;

export default Button;`;

    expect(await modernize(text)).toBe(`import React from 'react';

type Props = {
  size?: string;
  label: string;
};

function Button({ size = 'md', label }: Props) {
  return <button className={size}>{label}</button>;
}

export default Button;`);
  });

  it('converts every literal value kind', async () => {
    const text = `import React from 'react';

type Props = {
  size: string;
  count: number;
  offset: number;
  open: boolean;
  tag: string;
  onto: string | null;
};

function Button({ size, count, offset, open, tag, onto }: Props) {
  return <button>{size}{count}{offset}{String(open)}{tag}{onto}</button>;
}
Button.defaultProps = {
  size: 'md',
  count: 0,
  offset: -1,
  open: false,
  tag: \`span\`,
  onto: null,
};

export default Button;`;

    const result = (await modernize(text)) as string;
    expect(result).toContain(
      '{ size = \'md\', count = 0, offset = -1, open = false, tag = `span`, onto = null }',
    );
    expect(result).not.toContain('Button.defaultProps');
  });

  it('converts the component shapes react-props recognizes', async () => {
    const shapes: [string, string][] = [
      [
        'const Chip = ({ size }: Props) => <span>{size}</span>;',
        "const Chip = ({ size = 'md' }: Props) => <span>{size}</span>;",
      ],
      [
        'const Chip = function ({ size }: Props) { return <span>{size}</span>; };',
        "const Chip = function ({ size = 'md' }: Props) { return <span>{size}</span>; };",
      ],
      [
        'const Chip = memo(({ size }: Props) => <span>{size}</span>);',
        "const Chip = memo(({ size = 'md' }: Props) => <span>{size}</span>);",
      ],
      [
        'const Chip = React.memo(({ size }: Props) => <span>{size}</span>);',
        "const Chip = React.memo(({ size = 'md' }: Props) => <span>{size}</span>);",
      ],
      [
        'const Chip = forwardRef(({ size }: Props, ref: any) => <span ref={ref}>{size}</span>);',
        "const Chip = forwardRef(({ size = 'md' }: Props, ref: any) => <span ref={ref}>{size}</span>);",
      ],
      [
        'const Chip = memo(forwardRef(({ size }: Props, ref: any) => <span ref={ref}>{size}</span>));',
        "const Chip = memo(forwardRef(({ size = 'md' }: Props, ref: any) => <span ref={ref}>{size}</span>));",
      ],
    ];

    for (const [component, expected] of shapes) {
      const text = `import React, { forwardRef, memo } from 'react';

type Props = {
  size: string;
};

${component}
Chip.defaultProps = { size: 'md' };

export default Chip;`;

      const result = (await modernize(text)) as string;
      expect([component, result]).toEqual([
        component,
        `import React, { forwardRef, memo } from 'react';

type Props = {
  size?: string;
};

${expected}

export default Chip;`,
      ]);
    }
  });

  it('marks props declared in an interface optional', async () => {
    const text = `import React from 'react';

interface Props {
  size: string;
}

function Button({ size }: Props) {
  return <button>{size}</button>;
}
Button.defaultProps = { size: 'md' };

export default Button;`;

    expect(await modernize(text)).toBe(`import React from 'react';

interface Props {
  size?: string;
}

function Button({ size = 'md' }: Props) {
  return <button>{size}</button>;
}

export default Button;`);
  });

  it('produces output that compiles, with the defaulted prop optional for callers', async () => {
    const text = `import React from 'react';

type Props = {
  size: string;
  label: string;
};

function Button({ size, label }: Props) {
  return <button className={size}>{label}</button>;
}
Button.defaultProps = {
  size: 'md',
};

export function Toolbar() {
  return <Button label="save" />;
}
`;

    const result = (await modernize(text)) as string;
    expect(result).toContain('size?: string;');
    expect(typeCheck({ '/file.tsx': result })).toEqual([]);
  });

  it('produces output that compiles for a component it left the defaults on', async () => {
    const text = `import React from 'react';

type Props = {
  size?: string;
  onClick?: () => void;
};

function Button({ size, onClick }: Props) {
  return <button className={size} onClick={onClick} />;
}
Button.defaultProps = {
  size: 'md',
  onClick: () => {},
};

export default Button;`;

    const notices: PluginFileNotice[] = [];
    const result = (await modernize(text, notices)) as string;
    expect(result).toContain('type Props = OwnProps & (typeof Button)["defaultProps"];');
    expect(notices.map((notice) => notice.reason)).toEqual([
      'Left defaultProps in place: a default value is not a literal.',
    ]);
    expect(typeCheck({ '/file.tsx': result })).toEqual([]);
  });

  it('produces output that compiles for an arrow component it left the defaults on', async () => {
    const text = `import React from 'react';

type Props = {
  size?: string;
  onClick?: () => void;
};

const Button = ({ size, onClick }: Props) => {
  return <button className={size} onClick={onClick} />;
};
Button.defaultProps = {
  size: 'md',
  onClick: () => {},
};

export default Button;`;

    const notices: PluginFileNotice[] = [];
    const result = (await modernize(text, notices)) as string;
    expect(result).toContain('type Props = OwnProps & typeof ButtonDefaultProps;');
    expect(result).toContain('Button.defaultProps = ButtonDefaultProps;');
    expect(notices.map((notice) => notice.reason)).toEqual([
      'Left defaultProps in place: a default value is not a literal.',
    ]);
    expect(typeCheck({ '/file.tsx': result })).toEqual([]);
  });

  it('is idempotent', async () => {
    const text = `import React from 'react';

type Props = {
  size: string;
};

function Button({ size }: Props) {
  return <button>{size}</button>;
}
Button.defaultProps = { size: 'md' };

export default Button;`;

    const first = (await modernize(text)) as string;
    const second = await modernize(first);
    expect(second).toBeUndefined();
    expect(typeCheck({ '/file.tsx': first })).toEqual([]);
  });

  it('drops an assignment that repeats a default the parameter already has', async () => {
    const text = `import React from 'react';

type Props = {
  size?: string;
};

function Button({ size = 'md' }: Props) {
  return <button>{size}</button>;
}
Button.defaultProps = { size: 'md' };

export default Button;`;

    expect(await modernize(text)).toBe(`import React from 'react';

type Props = {
  size?: string;
};

function Button({ size = 'md' }: Props) {
  return <button>{size}</button>;
}

export default Button;`);
  });

  it('leaves class components to the typing path', async () => {
    const text = `import React from 'react';

type Props = {
  size: string;
};

class Button extends React.Component<Props> {
  static defaultProps = { size: 'md' };

  render() {
    return <button>{this.props.size}</button>;
  }
}

export default Button;`;

    const notices: PluginFileNotice[] = [];
    const result = (await modernize(text, notices)) as string;
    expect(result).toContain('static defaultProps = { size: \'md\' };');
    expect(notices).toEqual([]);
  });

  it('leaves an assignment onto a class component alone, without a notice', async () => {
    const text = `import React from 'react';

type Props = {
  size: string;
};

class Button extends React.Component<Props> {
  render() {
    return <button>{this.props.size}</button>;
  }
}
Button.defaultProps = { size: 'md' };

export default Button;`;

    const notices = await expectFallback(text);
    expect(notices).toEqual([]);
  });

  it('reports what it left behind', async () => {
    const text = `import React from 'react';

type Props = {
  items: string[];
};

function List({ items }: Props) {
  return <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}
List.defaultProps = { items: [] };

export default List;`;

    const notices = await expectFallback(text);
    expect(notices).toEqual([
      {
        reason: 'Left defaultProps in place: a default value is not a literal.',
        hint: 'React 19 ignores defaultProps on function components, so these need converting by hand.',
        recovered: true,
      },
    ]);
  });

  describe('falls back to the typing path when', () => {
    const withComponent = (defaults: string, component?: string, extra = '') => `import React from 'react';

type Props = {
  size: string;
};

${component ?? 'function Button({ size }: Props) {\n  return <button>{size}</button>;\n}'}
Button.defaultProps = ${defaults};
${extra}
export default Button;`;

    const notLiteral = 'a default value is not a literal';

    it('a default is an object, array or function', async () => {
      await expectFallback(withComponent('{ size: {} }'), notLiteral);
      await expectFallback(withComponent('{ size: [] }'), notLiteral);
      await expectFallback(withComponent('{ size: () => null }'), notLiteral);
    });

    it('a default is an identifier or a call', async () => {
      await expectFallback(withComponent('{ size: DEFAULT_SIZE }'), notLiteral);
      await expectFallback(withComponent('{ size: getSize() }'), notLiteral);
    });

    it('the defaults object spreads another object', async () => {
      await expectFallback(withComponent('{ ...base, size: \'md\' }'), notLiteral);
    });

    it('the defaults are not an object literal in this file', async () => {
      await expectFallback(withComponent('shared'), 'the defaults are not an object literal in this file');
    });

    it('the defaults object is used elsewhere', async () => {
      const text = `import React from 'react';

type Props = {
  size: string;
};

const defaultProps = {
  size: 'md',
};

function Button({ size }: Props) {
  return <button>{size}</button>;
}
Button.defaultProps = defaultProps;

export { defaultProps };
export default Button;`;

      await expectFallback(text, 'the defaults object is used elsewhere in the file');
    });

    it('defaultProps is read elsewhere in the file', async () => {
      await expectFallback(
        withComponent('{ size: \'md\' }', undefined, '\nexport const keys = Object.keys(Button.defaultProps);\n'),
        'defaultProps is read elsewhere in the file',
      );
    });

    it('the props parameter is not destructured', async () => {
      await expectFallback(
        withComponent(
          '{ size: \'md\' }',
          'function Button(props: Props) {\n  return <button>{props.size}</button>;\n}',
        ),
        'the props parameter is not destructured',
      );
    });

    it('a defaulted prop is not destructured', async () => {
      const text = `import React from 'react';

type Props = {
  size: string;
  label: string;
};

function Button({ label }: Props) {
  return <button>{label}</button>;
}
Button.defaultProps = { size: 'md' };

export default Button;`;

      await expectFallback(text, 'a defaulted prop is not destructured by the component');
    });

    it('a defaulted prop only reaches the component through a rest element', async () => {
      const text = `import React from 'react';

type Props = {
  size: string;
  label: string;
};

function Button({ label, ...rest }: Props) {
  return <button {...rest}>{label}</button>;
}
Button.defaultProps = { size: 'md' };

export default Button;`;

      await expectFallback(text, 'a defaulted prop is not destructured by the component');
    });

    it('the parameter already has a different default', async () => {
      await expectFallback(
        withComponent(
          '{ size: \'md\' }',
          'function Button({ size = \'lg\' }: Props) {\n  return <button>{size}</button>;\n}',
        ),
        'a defaulted prop already has a different default',
      );
    });

    const notDeclaredInFull = 'the props type is not declared in full in this file';

    it('the props type is not declared in full in this file', async () => {
      const imported = `import React from 'react';
import { Props } from './props';

function Button({ size }: Props) {
  return <button>{size}</button>;
}
Button.defaultProps = { size: 'md' };

export default Button;`;
      await expectFallback(imported, notDeclaredInFull);

      const intersection = `import React from 'react';
import { OwnProps } from './props';

type Props = OwnProps & {
  label: string;
};

function Button({ size, label }: Props) {
  return <button>{label}{size}</button>;
}
Button.defaultProps = { size: 'md' };

export default Button;`;
      await expectFallback(intersection, notDeclaredInFull);
    });

    it('a defaulted prop is not declared in the props type', async () => {
      const text = `import React from 'react';

type Props = {
  label: string;
};

function Button({ size, label }: Props) {
  return <button>{label}{size}</button>;
}
Button.defaultProps = { size: 'md' };

export default Button;`;

      await expectFallback(text, 'a defaulted prop is not declared in a props type in this file');
    });

    it('the props type carries a heritage clause', async () => {
      const text = `import React from 'react';
import { OwnProps } from './props';

interface Props extends OwnProps {
  size: string;
}

function Button({ size }: Props) {
  return <button>{size}</button>;
}
Button.defaultProps = { size: 'md' };

export default Button;`;

      await expectFallback(text, notDeclaredInFull);
    });
  });

  it('leaves a props type shared with a component it could not convert alone', async () => {
    const text = `import React from 'react';

type Props = {
  size: string;
};

function Button({ size }: Props) {
  return <button>{size}</button>;
}
Button.defaultProps = { size: 'md' };

function Chip(props: Props) {
  return <span>{props.size}</span>;
}
Chip.defaultProps = { size: 'sm' };

export { Button, Chip };`;

    const result = (await modernize(text)) as string;
    expect(result).toBe(`import React from 'react';

type Props = {
  size?: string;
};

function Button({ size = 'md' }: Props) {
  return <button>{size}</button>;
}

function Chip(props: Props) {
  return <span>{props.size}</span>;
}
Chip.defaultProps = { size: 'sm' };

export { Button, Chip };`);
    expect(typeCheck({ '/file.tsx': result })).toEqual([]);
  });

  it('converts two components in one file', async () => {
    const text = `import React from 'react';

type ButtonProps = {
  size: string;
};

type ChipProps = {
  tone: string;
};

function Button({ size }: ButtonProps) {
  return <button>{size}</button>;
}
Button.defaultProps = { size: 'md' };

function Chip({ tone }: ChipProps) {
  return <span>{tone}</span>;
}
Chip.defaultProps = { tone: 'info' };

export { Button, Chip };`;

    const result = (await modernize(text)) as string;
    expect(result).toBe(`import React from 'react';

type ButtonProps = {
  size?: string;
};

type ChipProps = {
  tone?: string;
};

function Button({ size = 'md' }: ButtonProps) {
  return <button>{size}</button>;
}

function Chip({ tone = 'info' }: ChipProps) {
  return <span>{tone}</span>;
}

export { Button, Chip };`);
    expect(typeCheck({ '/file.tsx': result })).toEqual([]);
  });

  it('leaves the annotation of an exported props type alone when it converts', async () => {
    const text = `import React from 'react';

export type Props = {
  title: string;
};

function Greeting({ title }: Props) {
  return <div>{title}</div>;
}
Greeting.defaultProps = {
  title: 'hi',
};

export default Greeting;`;

    const result = (await modernize(text)) as string;
    expect(result).toBe(`import React from 'react';

export type Props = {
  title?: string;
};

function Greeting({ title = 'hi' }: Props) {
  return <div>{title}</div>;
}

export default Greeting;`);
    expect(typeCheck({ '/file.tsx': result })).toEqual([]);
  });

  it('keeps the space before a renamed annotation on the components it left', async () => {
    const declaration = `import React from 'react';

const DEFAULT_TITLE = 'hi';

export type Props = {
  title: string;
};

function Greeting({ title }: Props) {
  return <div>{title}</div>;
}
Greeting.defaultProps = {
  title: DEFAULT_TITLE,
};

export default Greeting;`;

    const notices: PluginFileNotice[] = [];
    const fromDeclaration = (await modernize(declaration, notices)) as string;

    expect(fromDeclaration).toBe(`import React from 'react';

const DEFAULT_TITLE = 'hi';

export type Props = {
    title: string;
};

type PrivateProps = Props & (typeof Greeting)["defaultProps"];

function Greeting({ title }: PrivateProps) {
  return <div>{title}</div>;
}
Greeting.defaultProps = {
  title: DEFAULT_TITLE,
};

export default Greeting;`);
    expect(notices.map((notice) => notice.reason)).toEqual([
      'Left defaultProps in place: a default value is not a literal.',
    ]);
    expect(typeCheck({ '/file.tsx': fromDeclaration })).toEqual([]);

    const arrow = `import React from 'react';

const DEFAULT_TITLE = 'hi';

export type Props = {
  title: string;
};

const Greeting = ({ title }: Props) => {
  return <div>{title}</div>;
};
Greeting.defaultProps = {
  title: DEFAULT_TITLE,
};

export default Greeting;`;

    const fromArrow = (await modernize(arrow)) as string;
    expect(fromArrow).toContain('const Greeting = ({ title }: PrivateProps) => {');
    expect(typeCheck({ '/file.tsx': fromArrow })).toEqual([]);
  });

  it('is off unless the option is set', async () => {
    const text = `import React from 'react';

type Props = {
  size: string;
};

function Button({ size }: Props) {
  return <button>{size}</button>;
}
Button.defaultProps = { size: 'md' };

export default Button;`;

    const result = (await reactDefaultPropsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx' }),
    )) as string;

    expect(result).toContain('Button.defaultProps = { size: \'md\' };');
    expect(result).toContain('type Props = OwnProps & (typeof Button)["defaultProps"];');
  });
});
