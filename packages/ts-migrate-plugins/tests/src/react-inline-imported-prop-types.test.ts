import { mockPluginParams, realPluginParams } from '../test-utils';
import reactInlineImportedPropTypesPlugin from '../../src/plugins/react-inline-imported-prop-types';
import reactPropsPlugin from '../../src/plugins/react-props';

describe('react-inline-imported-prop-types plugin', () => {
  const messagePropTypesModule = `import PropTypes from 'prop-types';

export const messagePropTypes = {
  messages: PropTypes.arrayOf(PropTypes.string).isRequired,
  title: PropTypes.string,
};
`;

  it('inlines a named import assigned to propTypes', async () => {
    const text = `import React from 'react';
import { messagePropTypes } from './messagePropTypes';

const MessageList = (props) => {
  return <div>{props.messages.length}</div>;
};

MessageList.propTypes = messagePropTypes;

export default MessageList;
`;

    const result = await reactInlineImportedPropTypesPlugin.run(
      await realPluginParams({
        fileName: 'components/MessageList.tsx',
        text,
        extraFiles: { 'components/messagePropTypes.ts': messagePropTypesModule },
      }),
    );

    expect(result).toBe(`import React from 'react';
import PropTypes from "prop-types";

const MessageList = (props) => {
  return <div>{props.messages.length}</div>;
};

MessageList.propTypes = {
  messages: PropTypes.arrayOf(PropTypes.string).isRequired,
  title: PropTypes.string,
};

export default MessageList;
`);
  });

  it('converts inlined propTypes to a structural type via react-props', async () => {
    const text = `import React from 'react';
import { messagePropTypes } from './messagePropTypes';

const MessageList = (props) => {
  return <div>{props.messages.length}</div>;
};

MessageList.propTypes = messagePropTypes;

export default MessageList;
`;

    const inlined = await reactInlineImportedPropTypesPlugin.run(
      await realPluginParams({
        fileName: 'components/MessageList.tsx',
        text,
        extraFiles: { 'components/messagePropTypes.ts': messagePropTypesModule },
      }),
    );

    const result = await reactPropsPlugin.run(
      mockPluginParams({ text: inlined as string, fileName: 'MessageList.tsx' }),
    );

    expect(result).toBe(`import React from 'react';

type Props = {
    messages: string[];
    title?: string;
};

const MessageList = (props: Props) => {
  return <div>{props.messages.length}</div>;
};

export default MessageList;
`);
  });

  it('inlines a default import', async () => {
    const text = `import React from 'react';
import messageProps from './messagePropTypes';

const MessageList = (props) => {
  return <div />;
};

MessageList.propTypes = messageProps;
`;

    const result = await reactInlineImportedPropTypesPlugin.run(
      await realPluginParams({
        fileName: 'components/MessageList.tsx',
        text,
        extraFiles: {
          'components/messagePropTypes.ts': `import PropTypes from 'prop-types';

const messagePropTypes = {
  text: PropTypes.string,
};

export default messagePropTypes;
`,
        },
      }),
    );

    expect(result).toBe(`import React from 'react';
import PropTypes from "prop-types";

const MessageList = (props) => {
  return <div />;
};

MessageList.propTypes = {
  text: PropTypes.string,
};
`);
  });

  it('inlines a namespace member', async () => {
    const text = `import React from 'react';
import * as propTypeShapes from './shapes';

const Foo = (props) => <div />;

Foo.propTypes = propTypeShapes.fooPropTypes;
`;

    const result = await reactInlineImportedPropTypesPlugin.run(
      await realPluginParams({
        fileName: 'components/Foo.tsx',
        text,
        extraFiles: {
          'components/shapes.ts': `import PropTypes from 'prop-types';

export const fooPropTypes = {
  foo: PropTypes.bool,
};
`,
        },
      }),
    );

    expect(result).toBe(`import React from 'react';
import PropTypes from "prop-types";

const Foo = (props) => <div />;

Foo.propTypes = {
  foo: PropTypes.bool,
};
`);
  });

  it('inlines an imported static propTypes', async () => {
    const text = `import React from 'react';
import { messagePropTypes } from './messagePropTypes';

class MessageList extends React.Component {
  static propTypes = messagePropTypes;

  render() {
    return null;
  }
}
`;

    const result = await reactInlineImportedPropTypesPlugin.run(
      await realPluginParams({
        fileName: 'components/MessageList.tsx',
        text,
        extraFiles: { 'components/messagePropTypes.ts': messagePropTypesModule },
      }),
    );

    expect(result).toBe(`import React from 'react';
import PropTypes from "prop-types";

class MessageList extends React.Component {
  static propTypes = {
  messages: PropTypes.arrayOf(PropTypes.string).isRequired,
  title: PropTypes.string,
};

  render() {
    return null;
  }
}
`);
  });

  it('inlines inside a forbidExtraProps wrapper without double-wrapping', async () => {
    const text = `import React from 'react';
import { forbidExtraProps } from 'airbnb-prop-types';
import { messagePropTypes } from './messagePropTypes';

const MessageList = (props) => <div />;

MessageList.propTypes = forbidExtraProps(messagePropTypes);
`;

    const result = await reactInlineImportedPropTypesPlugin.run(
      await realPluginParams({
        fileName: 'components/MessageList.tsx',
        text,
        extraFiles: { 'components/messagePropTypes.ts': messagePropTypesModule },
      }),
    );

    expect(result).toBe(`import React from 'react';
import { forbidExtraProps } from 'airbnb-prop-types';
import PropTypes from "prop-types";

const MessageList = (props) => <div />;

MessageList.propTypes = forbidExtraProps({
  messages: PropTypes.arrayOf(PropTypes.string).isRequired,
  title: PropTypes.string,
});
`);
  });

  it('copies a source-side forbidExtraProps wrapper along with its import', async () => {
    const text = `import React from 'react';
import { rowPropTypes } from './rowPropTypes';

const Row = (props) => <div />;

Row.propTypes = rowPropTypes;
`;

    const result = await reactInlineImportedPropTypesPlugin.run(
      await realPluginParams({
        fileName: 'components/Row.tsx',
        text,
        extraFiles: {
          'components/rowPropTypes.ts': `import PropTypes from 'prop-types';
import { forbidExtraProps } from 'airbnb-prop-types';

export const rowPropTypes = forbidExtraProps({
  id: PropTypes.number.isRequired,
});
`,
        },
      }),
    );

    expect(result).toBe(`import React from 'react';
import { forbidExtraProps } from "airbnb-prop-types";
import PropTypes from "prop-types";

const Row = (props) => <div />;

Row.propTypes = forbidExtraProps({
  id: PropTypes.number.isRequired,
});
`);
  });

  it('inlines spreads of imported propTypes into colocated literals', async () => {
    const text = `import React from 'react';
import PropTypes from 'prop-types';
import { sharedPropTypes } from './shared';

const propTypes = {
  ...sharedPropTypes,
  bar: PropTypes.string.isRequired,
};

const Foo = (props) => <div />;

Foo.propTypes = propTypes;
`;

    const result = await reactInlineImportedPropTypesPlugin.run(
      await realPluginParams({
        fileName: 'components/Foo.tsx',
        text,
        extraFiles: {
          'components/shared.ts': `import PropTypes from 'prop-types';

export const sharedPropTypes = {
  baz: PropTypes.number,
};
`,
        },
      }),
    );

    expect(result).toBe(`import React from 'react';
import PropTypes from 'prop-types';

const propTypes = {
  baz: PropTypes.number,
  bar: PropTypes.string.isRequired,
};

const Foo = (props) => <div />;

Foo.propTypes = propTypes;
`);
  });

  it('carries supporting imports with re-resolved relative paths', async () => {
    const text = `import React from 'react';
import { cardPropTypes } from '../shapes/cardPropTypes';

const Card = (props) => <div />;

Card.propTypes = cardPropTypes;
`;

    const result = await reactInlineImportedPropTypesPlugin.run(
      await realPluginParams({
        fileName: 'components/Card.tsx',
        text,
        extraFiles: {
          'shapes/cardPropTypes.ts': `import PropTypes from 'prop-types';
import userShape from './userShape';

export const cardPropTypes = {
  user: userShape.isRequired,
  label: PropTypes.string,
};
`,
        },
      }),
    );

    expect(result).toBe(`import React from 'react';
import userShape from "../shapes/userShape";
import PropTypes from "prop-types";

const Card = (props) => <div />;

Card.propTypes = {
  user: userShape.isRequired,
  label: PropTypes.string,
};
`);
  });

  it('keeps the import when the binding has other references', async () => {
    const text = `import React from 'react';
import { messagePropTypes } from './messagePropTypes';

const MessageList = (props) => <div />;

MessageList.propTypes = messagePropTypes;

export const keys = Object.keys(messagePropTypes);
`;

    const result = await reactInlineImportedPropTypesPlugin.run(
      await realPluginParams({
        fileName: 'components/MessageList.tsx',
        text,
        extraFiles: { 'components/messagePropTypes.ts': messagePropTypesModule },
      }),
    );

    expect(result).toBe(`import React from 'react';
import { messagePropTypes } from './messagePropTypes';
import PropTypes from "prop-types";

const MessageList = (props) => <div />;

MessageList.propTypes = {
  messages: PropTypes.arrayOf(PropTypes.string).isRequired,
  title: PropTypes.string,
};

export const keys = Object.keys(messagePropTypes);
`);
  });

  it('bails when the object references module locals', async () => {
    const text = `import React from 'react';
import { badPropTypes } from './badPropTypes';

const Foo = (props) => <div />;

Foo.propTypes = badPropTypes;
`;

    const result = await reactInlineImportedPropTypesPlugin.run(
      await realPluginParams({
        fileName: 'components/Foo.tsx',
        text,
        extraFiles: {
          'components/badPropTypes.ts': `import PropTypes from 'prop-types';

const validators = {
  custom: () => null,
};

export const badPropTypes = {
  thing: validators.custom,
  other: PropTypes.string,
};
`,
        },
      }),
    );

    expect(result).toBeUndefined();
  });

  it('bails on non-relative module specifiers', async () => {
    const text = `import React from 'react';
import { libPropTypes } from 'some-lib';

const Foo = (props) => <div />;

Foo.propTypes = libPropTypes;
`;

    const result = await reactInlineImportedPropTypesPlugin.run(
      await realPluginParams({ fileName: 'components/Foo.tsx', text }),
    );

    expect(result).toBeUndefined();
  });

  it('bails when a carried import name is already taken in the file', async () => {
    const text = `import React from 'react';
import { cardPropTypes } from './cardPropTypes';

const userShape = { local: true };

const Card = (props) => <div />;

Card.propTypes = cardPropTypes;
`;

    const result = await reactInlineImportedPropTypesPlugin.run(
      await realPluginParams({
        fileName: 'components/Card.tsx',
        text,
        extraFiles: {
          'components/cardPropTypes.ts': `import userShape from './userShape';

export const cardPropTypes = {
  user: userShape,
};
`,
        },
      }),
    );

    expect(result).toBeUndefined();
  });
});
