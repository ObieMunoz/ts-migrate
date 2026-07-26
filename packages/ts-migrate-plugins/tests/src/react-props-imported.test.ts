import { pluginRunner } from '../test-utils';
import reactPropsPlugin from '../../src/plugins/react-props';

/** Every test migrates a .tsx component; each says only what it is about. */
const run = pluginRunner(reactPropsPlugin, { fileName: 'Foo.tsx' });

describe('react-props plugin, propTypes imported from another module', () => {
  it('handles sfc with imported propTypes', async () => {
    const text = `import React from 'react';
import { messagePropTypes } from './messagePropTypes';

const MessageList = (props) => {
  return <div>{props.messages.length}</div>;
};

MessageList.propTypes = messagePropTypes;

export default MessageList;
`;

    expect(await run(text, { fileName: 'MessageList.tsx' })).toBe(`import React from 'react';
import { messagePropTypes } from './messagePropTypes';
import { InferProps } from "prop-types";

type Props = InferProps<typeof messagePropTypes>;

const MessageList = (props: Props) => {
  return <div>{props.messages.length}</div>;
};

export default MessageList;
`);

    expect(await run(text, { fileName: 'MessageList.tsx', options: { shouldKeepPropTypes: true } })).toBe(`import React from 'react';
import { messagePropTypes } from './messagePropTypes';
import { InferProps } from "prop-types";

type Props = InferProps<typeof messagePropTypes>;

const MessageList = (props: Props) => {
  return <div>{props.messages.length}</div>;
};

MessageList.propTypes = messagePropTypes;

export default MessageList;
`);
  });

  it('handles class with imported propTypes', async () => {
    const text = `import React from 'react';
import componentPropTypes from './componentPropTypes';

class Foo extends React.Component {
  render() {
    return null;
  }
}

Foo.propTypes = componentPropTypes;

export default Foo;
`;

    expect(await run(text)).toBe(`import React from 'react';
import componentPropTypes from './componentPropTypes';
import { InferProps } from "prop-types";

type Props = InferProps<typeof componentPropTypes>;

class Foo extends React.Component<Props> {
  render() {
    return null;
  }
}

export default Foo;
`);
  });

  it('handles class with imported static propTypes', async () => {
    const text = `import React from 'react';
import { fooPropTypes } from './propTypes';

class Foo extends React.Component {
  static propTypes = fooPropTypes;

  render() {
    return null;
  }
}
`;

    expect(await run(text)).toBe(`import React from 'react';
import { fooPropTypes } from './propTypes';
import { InferProps } from "prop-types";

type Props = InferProps<typeof fooPropTypes>;

class Foo extends React.Component<Props> {

  render() {
    return null;
  }
}
`);
  });

  it('handles propTypes imported via namespace', async () => {
    const text = `import React from 'react';
import * as shapes from './shapes';

function Foo(props) {
  return <div />;
}

Foo.propTypes = shapes.fooPropTypes;
`;

    expect(await run(text)).toBe(`import React from 'react';
import * as shapes from './shapes';
import { InferProps } from "prop-types";

type Props = InferProps<typeof shapes.fooPropTypes>;

function Foo(props: Props) {
  return <div />;
}
`);
  });

  it('handles imported propTypes wrapped in forbidExtraProps', async () => {
    const text = `import React from 'react';
import { forbidExtraProps } from 'airbnb-prop-types';
import { cardPropTypes } from './cardPropTypes';

function Card(props) {
  return <div />;
}

Card.propTypes = forbidExtraProps(cardPropTypes);
`;

    expect(await run(text, { fileName: 'Card.tsx', options: { shouldUpdateAirbnbImports: true } })).toBe(`import React from 'react';
import { cardPropTypes } from './cardPropTypes';
import { InferProps } from "prop-types";

type Props = InferProps<typeof cardPropTypes>;

function Card(props: Props) {
  return <div />;
}
`);
  });

  it('handles forwardRef with imported propTypes', async () => {
    const text = `import React, { forwardRef } from 'react';
import { fieldPropTypes } from './fieldPropTypes';

const Field = forwardRef((props, ref) => <input ref={ref} />);

Field.propTypes = fieldPropTypes;
`;

    expect(await run(text, { fileName: 'Field.tsx' })).toBe(`import React, { forwardRef } from 'react';
import { fieldPropTypes } from './fieldPropTypes';
import { InferProps } from "prop-types";

type Props = InferProps<typeof fieldPropTypes>;

const Field = forwardRef<HTMLInputElement, Props>((props, ref) => <input ref={ref} />);
`);
  });

  it('does not modify propTypes assigned a local non-object identifier', async () => {
    const text = `import React from 'react';

const propTypes = getPropTypes();

function Foo(props) {
  return <div />;
}

Foo.propTypes = propTypes;
`;

    expect(await run(text)).toBe(text);
  });
});
