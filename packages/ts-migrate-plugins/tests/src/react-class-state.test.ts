import reactClassStatePlugin from '../../src/plugins/react-class-state';
import { mockPluginParams } from '../test-utils';

describe('react-class-state plugin', () => {
  it('annotates state if used', async () => {
    const text = `import React from 'react';

class Foo extends React.Component {
  render() {
    return this.state.loading ? <div>Loading...</div> : <div />;
  }
}

export default Foo;
`;

    const result = await reactClassStatePlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options: { anyAlias: '$TSFixMe' } }),
    );

    expect(result).toBe(`import React from 'react';

type State = {
    loading: $TSFixMe;
};

class Foo extends React.Component<object, State> {
  render() {
    return this.state.loading ? <div>Loading...</div> : <div />;
  }
}

export default Foo;
`);
  });

  it('ignores if already annotated', async () => {
    const text = `import React from 'react';

type Props = { message: string };
type State = { loading: boolean };

class Foo extends React.Component<Props, State> {
  state = {};

  render() {
    return this.state.loading
      ? <div>Loading...</div>
      : <div>{this.props.message}</div>;
  }
}

export default Foo;
`;

    const result = await reactClassStatePlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options: { anyAlias: '$TSFixMe' } }),
    );

    expect(result).toBe(text);
  });

  it('ignores if state is unused', async () => {
    const text = `import React from 'react';

type Props = { loading: boolean };

class Foo extends React.Component<Props> {
  render() {
    return this.props.loading ? <div>Loading...</div> : <div />;
  }
}

export default Foo;
`;

    const result = await reactClassStatePlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options: { anyAlias: '$TSFixMe' } }),
    );

    expect(result).toBe(text);
  });

  it('scopes by component name if there are multiple in the file', async () => {
    const text = `import React from 'react';

class Bar extends React.Component {
  render() {
    return this.state.loading ? <div>Loading...</div> : <div>Bar</div>;
  }
}

class Foo extends React.Component {
  render() {
    return this.state.loading ? <div>Loading...</div> : <div>Foo</div>;
  }
}

export default Foo;
`;

    const result = await reactClassStatePlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options: { anyAlias: '$TSFixMe' } }),
    );

    expect(result).toBe(`import React from 'react';

type BarState = {
    loading: $TSFixMe;
};

class Bar extends React.Component<object, BarState> {
  render() {
    return this.state.loading ? <div>Loading...</div> : <div>Bar</div>;
  }
}

type FooState = {
    loading: $TSFixMe;
};

class Foo extends React.Component<object, FooState> {
  render() {
    return this.state.loading ? <div>Loading...</div> : <div>Foo</div>;
  }
}

export default Foo;
`);
  });

  it('uses prefix of props name', async () => {
    const text = `import React from 'react';

type MyProps = { message: string };

class Foo extends React.Component<MyProps> {
  render() {
    return this.state.loading
      ? <div>Loading...</div>
      : <div>{this.props.message}</div>;
  }
}

export default Foo;
`;

    const result = await reactClassStatePlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options: { anyAlias: '$TSFixMe' } }),
    );

    expect(result).toBe(`import React from 'react';

type MyProps = { message: string };

type MyState = {
    loading: $TSFixMe;
};

class Foo extends React.Component<MyProps, MyState> {
  render() {
    return this.state.loading
      ? <div>Loading...</div>
      : <div>{this.props.message}</div>;
  }
}

export default Foo;
`);
  });
});
