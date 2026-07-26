import ts from 'typescript';
import { caseReader, realPluginParams } from '../test-utils';
import { run, typeCheck } from './react-default-props.harness';

const readCase = caseReader('react-default-props');

describe('react-default-props plugin, the types it writes', () => {
  const options = { useDefaultPropsHelper: true };
  it('complex file with multiple component and mupltiple default props', async () => {
    const text = readCase('multiple-components-with-multiple-defaults.input.tsx');

    expect(await run(text, { options })).toBe(readCase('multiple-components-with-multiple-defaults.expected.tsx'));
  });

  it('multiple components in one file', async () => {
    const text = readCase('multiple-components-in-one-file.input.tsx');
    expect(await run(text, { options })).toBe(readCase('multiple-components-in-one-file.expected.tsx'));
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
    expect(await run(text, { options })).toBe(`import PropTypes from 'prop-types';
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
    const text = readCase('proptype-that-is-only-a-type-reference.input.tsx');
    const result = await run(text, { options });
    expect(result).toBe(readCase('proptype-that-is-only-a-type-reference.expected.tsx'));
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

    expect(await run(text, { options })).toBe(`import React from 'react';

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

    expect(await run(text, { options })).toBe(`import React from 'react';

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

    expect(await run(text, { options })).toBe(`import React from 'react';

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

    const fromDeclaration = (await run(declaration)) as string;

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

    const fromArrow = (await run(arrow)) as string;

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

    const withHelper = (await run(arrow, { options })) as string;

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

    expect(await run(text, { options })).toBe(`import React from 'react';
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
    const text = readCase('duplicate-ownprops-declaration.input.tsx');

    expect(await run(text)).toBe(readCase('duplicate-ownprops-declaration.expected.tsx'));
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

    const result = (await run(text, { options })) as string;

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

    const result = (await run(text, { options })) as string;

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
