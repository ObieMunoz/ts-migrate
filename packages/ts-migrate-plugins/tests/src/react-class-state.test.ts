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

  it('widens the values of the state initializer', async () => {
    const text = `import React from 'react';

class Foo extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      loading: true,
      count: 0,
      label: '',
      items: [],
      ids: [1, 2],
      user: null,
    };
  }

  render() {
    return this.state.loading ? <div>Loading...</div> : <div>{this.state.label}</div>;
  }
}

export default Foo;
`;

    const result = await reactClassStatePlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options: { anyAlias: '$TSFixMe' } }),
    );

    expect(result).toBe(`import React from 'react';

type State = {
    loading: boolean;
    count: number;
    label: string;
    items: $TSFixMe[];
    ids: number[];
    user: $TSFixMe;
};

class Foo extends React.Component<object, State> {
  constructor(props) {
    super(props);
    this.state = {
      loading: true,
      count: 0,
      label: '',
      items: [],
      ids: [1, 2],
      user: null,
    };
  }

  render() {
    return this.state.loading ? <div>Loading...</div> : <div>{this.state.label}</div>;
  }
}

export default Foo;
`);
  });

  it('marks members the initializer does not set as optional', async () => {
    const text = `import React from 'react';

class Foo extends React.Component {
  state = { loading: true };

  componentDidMount() {
    this.setState({ loading: false, error: 'timeout' });
  }

  render() {
    return this.state.loading ? <div>Loading...</div> : <div>{this.state.error}</div>;
  }
}

export default Foo;
`;

    const result = await reactClassStatePlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options: { anyAlias: '$TSFixMe' } }),
    );

    expect(result).toBe(`import React from 'react';

type State = {
    loading: boolean;
    error?: string;
};

class Foo extends React.Component<object, State> {
  state: State = { loading: true };

  componentDidMount() {
    this.setState({ loading: false, error: 'timeout' });
  }

  render() {
    return this.state.loading ? <div>Loading...</div> : <div>{this.state.error}</div>;
  }
}

export default Foo;
`);
  });

  it('reads members from setState updaters', async () => {
    const text = `import React from 'react';

class Foo extends React.Component {
  state = { count: 0 };

  increment = () => {
    this.setState((prevState) => ({ count: prevState.count + 1, touched: true }));
  };

  render() {
    return <button onClick={this.increment}>{this.state.count}</button>;
  }
}

export default Foo;
`;

    const result = await reactClassStatePlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options: { anyAlias: '$TSFixMe' } }),
    );

    expect(result).toBe(`import React from 'react';

type State = {
    count: number;
    touched?: boolean;
};

class Foo extends React.Component<object, State> {
  state: State = { count: 0 };

  increment = () => {
    this.setState((prevState) => ({ count: prevState.count + 1, touched: true }));
  };

  render() {
    return <button onClick={this.increment}>{this.state.count}</button>;
  }
}

export default Foo;
`);
  });

  it('reads members destructured from this.state', async () => {
    const text = `import React from 'react';

class Foo extends React.Component {
  render() {
    const { loading, error: message } = this.state;
    return loading ? <div>Loading...</div> : <div>{message}</div>;
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
    error: $TSFixMe;
};

class Foo extends React.Component<object, State> {
  render() {
    const { loading, error: message } = this.state;
    return loading ? <div>Loading...</div> : <div>{message}</div>;
  }
}

export default Foo;
`);
  });

  it('uses the any alias for members written with conflicting types', async () => {
    const text = `import React from 'react';

class Foo extends React.Component {
  state = { size: 'large' };

  shrink() {
    this.setState({ size: 2 });
  }

  render() {
    return <div>{this.state.size}</div>;
  }
}

export default Foo;
`;

    const result = await reactClassStatePlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options: { anyAlias: '$TSFixMe' } }),
    );

    expect(result).toBe(`import React from 'react';

type State = {
    size: $TSFixMe;
};

class Foo extends React.Component<object, State> {
  state: State = { size: 'large' };

  shrink() {
    this.setState({ size: 2 });
  }

  render() {
    return <div>{this.state.size}</div>;
  }
}

export default Foo;
`);
  });

  it('quotes member names that are not identifiers', async () => {
    const text = `import React from 'react';

class Foo extends React.Component {
  state = { 'first-name': '', age: 0 };

  render() {
    return <div>{this.state['first-name']}</div>;
  }
}

export default Foo;
`;

    const result = await reactClassStatePlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options: { anyAlias: '$TSFixMe' } }),
    );

    expect(result).toBe(`import React from 'react';

type State = {
    "first-name": string;
    age: number;
};

class Foo extends React.Component<object, State> {
  state: State = { 'first-name': '', age: 0 };

  render() {
    return <div>{this.state['first-name']}</div>;
  }
}

export default Foo;
`);
  });

  it('keeps an annotation the state property already has', async () => {
    const text = `import React from 'react';

type Initial = { loading: boolean };

class Foo extends React.Component {
  state: Initial = { loading: true };

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

type Initial = { loading: boolean };

type State = {
    loading: boolean;
};

class Foo extends React.Component<object, State> {
  state: Initial = { loading: true };

  render() {
    return this.state.loading ? <div>Loading...</div> : <div />;
  }
}

export default Foo;
`);
  });

  it('falls back to any if the state initializer is not an object literal', async () => {
    const text = `import React from 'react';
import getInitialState from './getInitialState';

class Foo extends React.Component {
  constructor(props) {
    super(props);
    this.state = getInitialState(props);
  }

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
import getInitialState from './getInitialState';

type State = $TSFixMe;

class Foo extends React.Component<object, State> {
  constructor(props) {
    super(props);
    this.state = getInitialState(props);
  }

  render() {
    return this.state.loading ? <div>Loading...</div> : <div />;
  }
}

export default Foo;
`);
  });

  it('falls back to any if setState is passed an object it cannot read', async () => {
    const text = `import React from 'react';

class Foo extends React.Component {
  state = { loading: true };

  update(nextState) {
    this.setState(nextState);
  }

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

type State = $TSFixMe;

class Foo extends React.Component<object, State> {
  state = { loading: true };

  update(nextState) {
    this.setState(nextState);
  }

  render() {
    return this.state.loading ? <div>Loading...</div> : <div />;
  }
}

export default Foo;
`);
  });

  it('falls back to any if no members are used', async () => {
    const text = `import React from 'react';
import Child from './Child';

class Foo extends React.Component {
  render() {
    return <Child state={this.state} />;
  }
}

export default Foo;
`;

    const result = await reactClassStatePlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options: { anyAlias: '$TSFixMe' } }),
    );

    expect(result).toBe(`import React from 'react';
import Child from './Child';

type State = $TSFixMe;

class Foo extends React.Component<object, State> {
  render() {
    return <Child state={this.state} />;
  }
}

export default Foo;
`);
  });

  it('uses any if no any alias is configured', async () => {
    const text = `import React from 'react';

class Foo extends React.Component {
  render() {
    return this.state.loading ? <div>Loading...</div> : <div />;
  }
}

export default Foo;
`;

    const result = await reactClassStatePlugin.run(
      mockPluginParams({ text, fileName: 'file.tsx', options: {} }),
    );

    expect(result).toBe(`import React from 'react';

type State = {
    loading: any;
};

class Foo extends React.Component<object, State> {
  render() {
    return this.state.loading ? <div>Loading...</div> : <div />;
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
