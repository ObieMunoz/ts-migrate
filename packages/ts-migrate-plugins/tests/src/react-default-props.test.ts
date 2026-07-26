import { PluginFileNotice } from '@obiemunoz/ts-migrate-server';
import { withoutMarkers } from '../test-utils';
import { run, typeCheck } from './react-default-props.harness';

describe('react-default-props plugin, the components it converts', () => {
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

    expect(await run(text, { options })).toBe(`import React from 'react';

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

    expect(await run(text)).toBe(`import React from 'react';

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

    expect(await run(text, { options })).toBe(`import React from 'react';

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

    expect(await run(text, { options })).toBe(`import React from 'react';

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

    const intersection = (await run(text)) as string;
    expect(intersection).toContain('type Props = OwnProps & (typeof Button)["defaultProps"];');
    expect(typeCheck({ '/file.tsx': intersection })).toEqual([]);

    const withHelper = (await run(text, { options })) as string;
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

    const intersection = (await run(text)) as string;

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

    const withHelper = (await run(text, { options })) as string;
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
    const result = await run(text, { reportFileNotice: (notice) => notices.push(notice) });

    expect(withoutMarkers(result as string)).toBe(text);
    expect(result).toContain('// TODO(ts-migrate): Declare the defaults in a const above the');
    expect(notices).toEqual([
      {
        reason:
          'Left Greeting without a defaults type: naming its defaults would move them above a binding they read.',
        hint: 'Declare the defaults in a const above the component to have them typed.',
        recovered: true,
        marked: true,
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

    const result = (await run(text)) as string;

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

    const first = (await run(text)) as string;
    const second = await run(first);

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

    const result = (await run(text)) as string;

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

    const result = (await run(text)) as string;
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

    expect(await run(text, { options })).toBe(`import React from 'react';
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

    expect(await run(text, { options })).toBe(`import React from 'react';
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

    expect(await run(text, { options })).toBe(`import React from 'react';

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

    expect(await run(text, { options })).toBe(`import React from 'react';

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

    expect(await run(text, { options })).toBe(undefined);
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

    expect(await run(text, { options })).toBe(`import { WithDefaultProps } from ":ts-utils/types/WithDefaultProps";
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

    expect(await run(text, { options })).toBe(`import React from 'react';
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

    expect(await run(text, { options })).toBe(`import React from 'react';
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

});
