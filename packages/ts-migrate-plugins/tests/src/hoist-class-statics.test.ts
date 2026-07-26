import { caseReader, mockPluginParams } from '../test-utils';
import hoistClassStaticsPlugin from '../../src/plugins/hoist-class-statics';

const readCase = caseReader('hoist-class-statics');

describe('hoist-class-statics plugin', () => {
  it('hoists static class properties', async () => {
    const text = `import React from 'react';
import PropTypes from 'prop-types';

class Foo extends React.Component {
  render() {}
}

Foo.propTypes = {
  foo: PropTypes.string.isRequired,
};

Foo.fragments = \`some graphql fragment\`;

class Bar extends React.Component {
  render() {}
}

Bar.propTypes = {
  bar: PropTypes.string,
};

Bar.defaultProps = {
  bar: 'bar value',
};
`;

    const result = await hoistClassStaticsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx' }),
    );

    expect(result).toBe(`import React from 'react';
import PropTypes from 'prop-types';

class Foo extends React.Component {
  static propTypes = {
      foo: PropTypes.string.isRequired,
  };

  static fragments = \`some graphql fragment\`;

  render() {}
}

class Bar extends React.Component {
  static propTypes = {
      bar: PropTypes.string,
  };

  static defaultProps = {
      bar: 'bar value',
  };

  render() {}
}
`);
  });

  it('hoist statics along with their dependencies', async () => {
    const text = `import React from 'react';

class Foo extends React.Component {
  render() {}
}

const LOGGING_ID = 'foo.bar';

Foo.loggingId = LOGGING_ID;
`;

    const result = await hoistClassStaticsPlugin.run(
      mockPluginParams({
        fileName: 'file.tsx',
        options: { anyAlias: '$TSFixMe' },
        text,
      }),
    );

    expect(result).toBe(`import React from 'react';

class Foo extends React.Component {
  static loggingId: $TSFixMe;

  render() {}
}

const LOGGING_ID = 'foo.bar';

Foo.loggingId = LOGGING_ID;
`);
  });

  it('when hoisting global variables are considered defined', async () => {
    const text = `import React from 'react';
import { buttonProps } from './private';

class Foo extends React.Component {
  render() {}
}

Foo.propTypes = {
  date: new Date(),
  max: Number.MAX_SAFE_INTEGER,
  buttonProps: Object.assign({}, buttonProps)
};
`;

    const result = await hoistClassStaticsPlugin.run(
      mockPluginParams({
        fileName: 'file.tsx',
        options: { anyAlias: '$TSFixMe' },
        text,
      }),
    );

    expect(result).toBe(`import React from 'react';
import { buttonProps } from './private';

class Foo extends React.Component {
  static propTypes = {
      date: new Date(),
      max: Number.MAX_SAFE_INTEGER,
      buttonProps: Object.assign({}, buttonProps)
  };

  render() {}
}
`);
  });

  it('works with spread withStylePropsTypes', async () => {
    const text = `import React from 'react';
import PropTypes from 'prop-types';
import { withStyles, withStylesPropTypes } from ':dls-themes/withStyles';

const propTypes = {
  ...withStylesPropTypes,
  data: PropTypes.shape({
    mantaro: PropTypes.shape({
      initialLoadForNewListingOnWeb: PropTypes.shape({
        ownedListings: PropTypes.arrayOf(OwnedListingShape),
      }),
    }),
  }),
};

const defaultProps = {
  data: null,
};

class DuplicateListing extends React.Component {
  render() {

  }
}

DuplicateListing.propTypes = propTypes;
DuplicateListing.defaultProps = defaultProps;
`;
    const result = await hoistClassStaticsPlugin.run(
      mockPluginParams({
        fileName: 'file.tsx',
        options: { anyAlias: '$TSFixMe' },
        text,
      }),
    );

    expect(result).toBe(`import React from 'react';
import PropTypes from 'prop-types';
import { withStyles, withStylesPropTypes } from ':dls-themes/withStyles';

const propTypes = {
  ...withStylesPropTypes,
  data: PropTypes.shape({
    mantaro: PropTypes.shape({
      initialLoadForNewListingOnWeb: PropTypes.shape({
        ownedListings: PropTypes.arrayOf(OwnedListingShape),
      }),
    }),
  }),
};

const defaultProps = {
  data: null,
};

class DuplicateListing extends React.Component {
  static propTypes = propTypes;

  static defaultProps = defaultProps;

  render() {

  }
}
`);
  });

  it('works with functional shorthand property defintions', async () => {
    const text = `import React from 'react';

class AsyncComponent extends React.Component {
  render() {}
}

AsyncComponent.defaultProps = {
  onComponentFinishLoading() {},
  placeholderHeight: null,
  renderPlaceholder: null,
  /**
   * Some comment
   */
  loadReady: true,
};
`;

    const result = await hoistClassStaticsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx' }),
    );

    expect(result).toBe(`import React from 'react';

class AsyncComponent extends React.Component {
  static defaultProps = {
      onComponentFinishLoading() { },
      placeholderHeight: null,
      renderPlaceholder: null,
      /**
       * Some comment
       */
      loadReady: true,
  };

  render() {}
}
`);
  });

  it('indents hoisted statics to match existing members', async () => {
    const text = `import React from 'react';
import PropTypes from 'prop-types';

class Foo extends React.Component {
    render() {}
}

Foo.propTypes = {
  foo: PropTypes.string,
};
`;

    const result = await hoistClassStaticsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx' }),
    );

    expect(result).toBe(`import React from 'react';
import PropTypes from 'prop-types';

class Foo extends React.Component {
    static propTypes = {
        foo: PropTypes.string,
    };

    render() {}
}
`);
  });

  it('should be idempotent', async () => {
    const text = `import React from 'react';

class Foo extends React.Component {
  render() {}
}

const BLUE = 'blue';

Foo.defaultProps = {
  theme: BLUE,
};
`;

    const firstResult = await hoistClassStaticsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options: { anyAlias: '$TSFixMe' } }),
    );

    expect(firstResult).toBe(`import React from 'react';

class Foo extends React.Component {
  static defaultProps: $TSFixMe;

  render() {}
}

const BLUE = 'blue';

Foo.defaultProps = {
  theme: BLUE,
};
`);

    const secondResult = await hoistClassStaticsPlugin.run(
      mockPluginParams({ text: firstResult || '', fileName: 'file.tsx' }),
    );

    expect(secondResult).toBe(firstResult);
  });

  it('should be idempotent -- real example', async () => {
    const text = readCase('idempotent-real-example.input.tsx');

    const firstResult = await hoistClassStaticsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options: { anyAlias: '$TSFixMe' } }),
    );

    expect(firstResult).toBe(readCase('idempotent-real-example.expected.tsx'));

    const secondResult = await hoistClassStaticsPlugin.run(
      mockPluginParams({ text: firstResult || '', fileName: 'file.tsx' }),
    );

    expect(secondResult).toBe(firstResult);
  });

  it('does not hoist a value past an intervening reassignment of its binding', async () => {
    const text = `let version = 1;
class App {}
version = 2;
App.version = version;
`;

    const result = (await hoistClassStaticsPlugin.run(
      mockPluginParams({ fileName: 'file.ts', text }),
    )) as string;

    // Hoisting the initializer would capture 1 instead of 2.
    expect(result).not.toContain('static version = version');
    expect(result).toContain('App.version = version;');
    expect(result).toContain('static version');
  });

  it('does not hoist a call expression past intervening statements', async () => {
    const text = `const track = (name: any) => name;
class Widget {}
track('setup');
Widget.label = track('label');
`;

    const result = (await hoistClassStaticsPlugin.run(
      mockPluginParams({ fileName: 'file.ts', text }),
    )) as string;

    // Hoisting would run track('label') before track('setup').
    expect(result).not.toContain("static label = track('label')");
    expect(result).toContain("Widget.label = track('label');");
    expect(result).toContain('static label');
  });

  it('does not declare duplicate members for repeated assignments to one static', async () => {
    const text = `class Config {}
Config.mode = 'dev';
Config.mode = 'prod';
`;

    const result = (await hoistClassStaticsPlugin.run(
      mockPluginParams({ fileName: 'file.ts', text }),
    )) as string;

    expect(result.match(/static mode/g)).toHaveLength(1);
    expect(result).toContain("static mode = 'dev';");
    expect(result).toContain("Config.mode = 'prod';");
  });

  it('hoists defaultProps containing undefined', async () => {
    const text = `import React from 'react';

class Foo extends React.Component {
  render() {}
}

Foo.defaultProps = {
  onChange: undefined,
};
`;

    const result = await hoistClassStaticsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx' }),
    );

    expect(result).toBe(`import React from 'react';

class Foo extends React.Component {
  static defaultProps = {
      onChange: undefined,
  };

  render() {}
}
`);
  });

  it('hoists statics following one that references standard globals', async () => {
    const text = `import React from 'react';
import PropTypes from 'prop-types';

class Foo extends React.Component {
  render() {}
}

Foo.defaultProps = {
  pattern: new RegExp('^foo'),
  limit: Math.max(10, 20),
  onSelect: undefined,
};

Foo.propTypes = {
  pattern: PropTypes.instanceOf(RegExp),
  limit: PropTypes.number,
  onSelect: PropTypes.func,
};

Foo.fragments = \`some graphql fragment\`;
`;

    const result = await hoistClassStaticsPlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx' }),
    );

    expect(result).toBe(`import React from 'react';
import PropTypes from 'prop-types';

class Foo extends React.Component {
  static defaultProps = {
      pattern: new RegExp('^foo'),
      limit: Math.max(10, 20),
      onSelect: undefined,
  };

  static propTypes = {
      pattern: PropTypes.instanceOf(RegExp),
      limit: PropTypes.number,
      onSelect: PropTypes.func,
  };

  static fragments = \`some graphql fragment\`;

  render() {}
}
`);
  });
});
