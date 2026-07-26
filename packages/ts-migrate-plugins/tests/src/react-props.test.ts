import { pluginRunner } from '../test-utils';
import reactPropsPlugin from '../../src/plugins/react-props';

/** Every test migrates a .tsx component; each says only what it is about. */
const run = pluginRunner(reactPropsPlugin, { fileName: 'Foo.tsx' });

describe('react-props plugin, the components it recognizes', () => {
  it('handles class with propTypes declared as a separate variable', async () => {
    const text = `import React from 'react';
import PropTypes from 'prop-types';

const propTypes = {
  foo: PropTypes.string.isRequired,
};

class Foo extends React.Component {
  render() {}
}

Foo.propTypes = propTypes;

export default Foo;
`;

    expect(await run(text)).toBe(`import React from 'react';

type Props = {
    foo: string;
};

class Foo extends React.Component<Props> {
  render() {}
}

export default Foo;
`);

    expect(await run(text, { options: { shouldKeepPropTypes: true } })).toBe(`import React from 'react';
import PropTypes from 'prop-types';

const propTypes = {
  foo: PropTypes.string.isRequired,
};

type Props = {
    foo: string;
};

class Foo extends React.Component<Props> {
  render() {}
}

Foo.propTypes = propTypes;

export default Foo;
`);
  });

  it('handles functional component with forwardRef', async () => {
    const text = `import React, { forwardRef } from 'react';
import PropTypes from 'prop-types';

const propTypes = {
  foo: PropTypes.string.isRequired,
};

const Foo = forwardRef(({ foo }, ref) => <div ref={ref}>{foo}</div>)

Foo.propTypes = propTypes;

export default Foo;
`;

    expect(await run(text)).toBe(`import React, { forwardRef } from 'react';

type Props = {
    foo: string;
};

const Foo = forwardRef<HTMLDivElement, Props>(({ foo }, ref) => <div ref={ref}>{foo}</div>)

export default Foo;
`);

    expect(await run(text, { options: { shouldKeepPropTypes: true } })).toBe(`import React, { forwardRef } from 'react';
import PropTypes from 'prop-types';

const propTypes = {
  foo: PropTypes.string.isRequired,
};

type Props = {
    foo: string;
};

const Foo = forwardRef<HTMLDivElement, Props>(({ foo }, ref) => <div ref={ref}>{foo}</div>)

Foo.propTypes = propTypes;

export default Foo;
`);
  });

  it('handles react functional component if forward ref is not destructured', async () => {
    const text = `import React from 'react';
import PropTypes from 'prop-types';

const propTypes = {
  foo: PropTypes.string.isRequired,
};

const Foo = React.forwardRef(({ foo }, ref) => <div ref={ref}>{foo}</div>)

Foo.propTypes = propTypes;

export default Foo;
`;

    expect(await run(text)).toBe(`import React from 'react';

type Props = {
    foo: string;
};

const Foo = React.forwardRef<HTMLDivElement, Props>(({ foo }, ref) => <div ref={ref}>{foo}</div>)

export default Foo;
`);
  });

  it('handles forwardRef being used separately from component', async () => {
    const text = `import React, { forwardRef } from 'react';
import PropTypes from 'prop-types';

const propTypes = {
  foo: PropTypes.string.isRequired,
};

const Foo = ({ foo }, ref) => <div ref={ref}>{foo}</div>;

Foo.propTypes = propTypes;

const WrappedComponent = forwardRef(Foo);

export default WrappedComponent;
`;

    expect(await run(text)).toBe(`import React, { forwardRef } from 'react';

type FooProps = {
    foo: string;
};

const Foo = ({ foo }: FooProps, ref) => <div ref={ref}>{foo}</div>;

const WrappedComponent = forwardRef(Foo);

export default WrappedComponent;
`);

    expect(await run(text, { options: { shouldKeepPropTypes: true } })).toBe(`import React, { forwardRef } from 'react';
import PropTypes from 'prop-types';

const propTypes = {
  foo: PropTypes.string.isRequired,
};

type FooProps = {
    foo: string;
};

const Foo = ({ foo }: FooProps, ref) => <div ref={ref}>{foo}</div>;

Foo.propTypes = propTypes;

const WrappedComponent = forwardRef(Foo);

export default WrappedComponent;
`);
  });

  it('handles functional component wrapped in memo', async () => {
    const text = `import React, { memo } from 'react';
import PropTypes from 'prop-types';

const propTypes = {
  foo: PropTypes.string.isRequired,
};

const Foo = memo(({ foo }) => <div>{foo}</div>);

Foo.propTypes = propTypes;

export default Foo;
`;

    expect(await run(text)).toBe(`import React, { memo } from 'react';

type Props = {
    foo: string;
};

const Foo = memo(({ foo }: Props) => <div>{foo}</div>);

export default Foo;
`);
  });

  it('handles functional component wrapped in React.memo', async () => {
    const text = `import React from 'react';
import PropTypes from 'prop-types';

const propTypes = {
  foo: PropTypes.string.isRequired,
};

const Foo = React.memo(({ foo }) => <div>{foo}</div>);

Foo.propTypes = propTypes;

export default Foo;
`;

    expect(await run(text)).toBe(`import React from 'react';

type Props = {
    foo: string;
};

const Foo = React.memo(({ foo }: Props) => <div>{foo}</div>);

export default Foo;
`);
  });

  it('handles memo wrapping forwardRef', async () => {
    const text = `import React, { forwardRef, memo } from 'react';
import PropTypes from 'prop-types';

const propTypes = {
  foo: PropTypes.string.isRequired,
};

const Foo = memo(forwardRef(({ foo }, ref) => <section ref={ref}>{foo}</section>));

Foo.propTypes = propTypes;

export default Foo;
`;

    expect(await run(text)).toBe(`import React, { forwardRef, memo } from 'react';

type Props = {
    foo: string;
};

const Foo = memo(forwardRef<HTMLElement, Props>(({ foo }, ref) => <section ref={ref}>{foo}</section>));

export default Foo;
`);
  });

  it('handles a component declared as a function expression', async () => {
    const text = `import React from 'react';
import PropTypes from 'prop-types';

const propTypes = {
  foo: PropTypes.string.isRequired,
};

const Foo = function (props) {
  return <div>{props.foo}</div>;
};

Foo.propTypes = propTypes;

export default Foo;
`;

    expect(await run(text)).toBe(`import React from 'react';

type Props = {
    foo: string;
};

const Foo = function (props: Props) {
  return <div>{props.foo}</div>;
};

export default Foo;
`);
  });

  it('counts a memo-wrapped component when naming props types', async () => {
    const text = `import React, { memo } from 'react';
import PropTypes from 'prop-types';

const Foo = memo(({ foo }) => <div>{foo}</div>);

Foo.propTypes = {
  foo: PropTypes.string.isRequired,
};

const Bar = ({ bar }) => <div>{bar}</div>;

Bar.propTypes = {
  bar: PropTypes.string.isRequired,
};

export { Foo, Bar };
`;

    expect(await run(text)).toBe(`import React, { memo } from 'react';

type FooProps = {
    foo: string;
};

const Foo = memo(({ foo }: FooProps) => <div>{foo}</div>);

type BarProps = {
    bar: string;
};

const Bar = ({ bar }: BarProps) => <div>{bar}</div>;

export { Foo, Bar };
`);
  });

  describe('forwardRef ref type', () => {
    const buildSource = (component: string, imports: string) =>
      `import React, { ${imports} } from 'react';
import PropTypes from 'prop-types';

${component}

Foo.propTypes = {
  foo: PropTypes.string.isRequired,
};
`;

    const buildExpected = (component: string, imports: string) =>
      `import React, { ${imports} } from 'react';

type Props = {
    foo: string;
};

${component}
`;

    const expectConversion = async (
      component: string,
      converted: string,
      { imports = 'forwardRef', options = {} }: { imports?: string; options?: object } = {},
    ) => {
      const result = await run(buildSource(component, imports), { options });
      expect(result).toBe(buildExpected(converted, imports));
    };

    it('infers the element type of the single tag the ref is attached to', () =>
      expectConversion(
        'const Foo = forwardRef(({ foo }, ref) => <input ref={ref} placeholder={foo} />);',
        'const Foo = forwardRef<HTMLInputElement, Props>(({ foo }, ref) => <input ref={ref} placeholder={foo} />);',
      ));

    it('infers from a ref parameter under any name', () =>
      expectConversion(
        'const Foo = forwardRef(({ foo }, inputRef) => <textarea ref={inputRef} value={foo} />);',
        'const Foo = forwardRef<HTMLTextAreaElement, Props>(({ foo }, inputRef) => <textarea ref={inputRef} value={foo} />);',
      ));

    it('infers from a function expression component', () =>
      expectConversion(
        `const Foo = forwardRef(function Foo({ foo }, ref) {
  return <button ref={ref}>{foo}</button>;
});`,
        `const Foo = forwardRef<HTMLButtonElement, Props>(function Foo({ foo }, ref) {
  return <button ref={ref}>{foo}</button>;
});`,
      ));

    it('infers when the ref reaches the same tag more than once', () =>
      expectConversion(
        'const Foo = forwardRef(({ foo }, ref) => foo ? <input ref={ref} /> : <input ref={ref} disabled />);',
        'const Foo = forwardRef<HTMLInputElement, Props>(({ foo }, ref) => foo ? <input ref={ref} /> : <input ref={ref} disabled />);',
      ));

    it('ignores ref attributes that hold some other ref', () =>
      expectConversion(
        'const Foo = forwardRef(({ foo }, ref) => <div ref={ref}><span ref={localRef}>{foo}</span></div>);',
        'const Foo = forwardRef<HTMLDivElement, Props>(({ foo }, ref) => <div ref={ref}><span ref={localRef}>{foo}</span></div>);',
      ));

    it('keeps any when the ref is never attached', () =>
      expectConversion(
        'const Foo = forwardRef(({ foo }, ref) => <div>{foo}</div>);',
        'const Foo = forwardRef<any, Props>(({ foo }, ref) => <div>{foo}</div>);',
      ));

    it('keeps any when the component takes no ref parameter', () =>
      expectConversion(
        'const Foo = forwardRef(({ foo }) => <div>{foo}</div>);',
        'const Foo = forwardRef<any, Props>(({ foo }) => <div>{foo}</div>);',
      ));

    it('keeps any when the ref reaches tags of different types', () =>
      expectConversion(
        'const Foo = forwardRef(({ foo }, ref) => <div ref={ref}><span ref={ref}>{foo}</span></div>);',
        'const Foo = forwardRef<any, Props>(({ foo }, ref) => <div ref={ref}><span ref={ref}>{foo}</span></div>);',
      ));

    it('keeps any when the ref is attached to a component', () =>
      expectConversion(
        'const Foo = forwardRef(({ foo }, ref) => <Inner ref={ref}>{foo}</Inner>);',
        'const Foo = forwardRef<any, Props>(({ foo }, ref) => <Inner ref={ref}>{foo}</Inner>);',
      ));

    it('keeps any when the ref is spread onto an element', () =>
      expectConversion(
        'const Foo = forwardRef(({ foo }, ref) => <div {...{ ref }}>{foo}</div>);',
        'const Foo = forwardRef<any, Props>(({ foo }, ref) => <div {...{ ref }}>{foo}</div>);',
      ));

    it('keeps any when the ref is forwarded through a helper', () =>
      expectConversion(
        'const Foo = forwardRef(({ foo }, ref) => <div ref={mergeRefs(ref, innerRef)}>{foo}</div>);',
        'const Foo = forwardRef<any, Props>(({ foo }, ref) => <div ref={mergeRefs(ref, innerRef)}>{foo}</div>);',
      ));

    it('keeps any when the ref is read directly', () =>
      expectConversion(
        `const Foo = forwardRef(({ foo }, ref) => {
  const value = ref.current;
  return <input ref={ref} defaultValue={value} />;
});`,
        `const Foo = forwardRef<any, Props>(({ foo }, ref) => {
  const value = ref.current;
  return <input ref={ref} defaultValue={value} />;
});`,
      ));

    it('keeps any when useImperativeHandle is present', () =>
      expectConversion(
        `const Foo = forwardRef(({ foo }, ref) => {
  useImperativeHandle(ref, () => ({ focus() {} }));
  return <input ref={ref} placeholder={foo} />;
});`,
        `const Foo = forwardRef<any, Props>(({ foo }, ref) => {
  useImperativeHandle(ref, () => ({ focus() {} }));
  return <input ref={ref} placeholder={foo} />;
});`,
        { imports: 'forwardRef, useImperativeHandle' },
      ));

    it('keeps any for tags outside the map', () =>
      expectConversion(
        'const Foo = forwardRef(({ foo }, ref) => <svg ref={ref}>{foo}</svg>);',
        'const Foo = forwardRef<any, Props>(({ foo }, ref) => <svg ref={ref}>{foo}</svg>);',
      ));

    it('falls back to anyAlias rather than any', () =>
      expectConversion(
        'const Foo = forwardRef(({ foo }, ref) => <div>{foo}</div>);',
        'const Foo = forwardRef<$TSFixMe, Props>(({ foo }, ref) => <div>{foo}</div>);',
        { options: { anyAlias: '$TSFixMe' } },
      ));

    it('prefers the inferred element type over anyAlias', () =>
      expectConversion(
        'const Foo = forwardRef(({ foo }, ref) => <textarea ref={ref} value={foo} />);',
        'const Foo = forwardRef<HTMLTextAreaElement, Props>(({ foo }, ref) => <textarea ref={ref} value={foo} />);',
        { options: { anyAlias: '$TSFixMe' } },
      ));
  });
});
