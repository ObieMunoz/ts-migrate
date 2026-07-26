import { pluginRunner } from '../test-utils';
import reactPropsPlugin from '../../src/plugins/react-props';

/** Every test migrates a .tsx component; each says only what it is about. */
const run = pluginRunner(reactPropsPlugin, { fileName: 'Foo.tsx' });

describe('react-props plugin, the types it writes', () => {
  it('replaces spread prop types', async () => {
    const text = `import React from 'react';
import PropTypes from 'prop-types';
import { withStyles, withStylesPropTypes } from ':dls-themes/withStyles';
import withBreakpoint, { withBreakpointPropTypes } from ':dls-core/components/breakpoints/withBreakpoint';
import { withRouter } from 'react-router';
import withRouterPropTypes from ':routing/shapes/RR4PropTypes';
import { buttonProps } from './somewhere/Button';

const propTypes = forbidExtraProps({
  foo: PropTypes.string,
  ...withStylesPropTypes,
  ...withBreakpointPropTypes,
  ...withRouterPropTypes,
  ...buttonProps,
});

function Foo({}) {
  return <div />;
}

Foo.propTypes = propTypes;

export default withStyles(() => ({}))(withBreakpoint(withRouter(Foo)));
`;

    expect(await run(text, { options: {
          shouldUpdateAirbnbImports: true,
        } })).toBe(`import React from 'react';
import { InferProps } from "prop-types";
import { withStyles, WithStylesProps } from ":dls-themes/withStyles";
import withBreakpoint, { WithBreakpointProps } from ":dls-core/components/breakpoints/withBreakpoint";
import { withRouter } from 'react-router';
import { buttonProps } from './somewhere/Button';
import { RouteConfigComponentProps } from "react-router-config";

type Props = {
    foo?: string;
} & WithStylesProps & WithBreakpointProps & RouteConfigComponentProps & InferProps<typeof buttonProps>;

function Foo({}: Props) {
  return <div />;
}

export default withStyles(() => ({}))(withBreakpoint(withRouter(Foo)));
`);
  });

  it('replaces spread prop types without an option', async () => {
    const text = `import React from 'react';
import PropTypes from 'prop-types';
import { withStyles, withStylesPropTypes } from ':dls-themes/withStyles';
import withBreakpoint, { withBreakpointPropTypes } from ':dls-core/components/breakpoints/withBreakpoint';
import { withRouter } from 'react-router';
import withRouterPropTypes from ':routing/shapes/RR4PropTypes';
import { buttonProps } from './somewhere/Button';

const propTypes = forbidExtraProps({
  foo: PropTypes.string,
  ...withStylesPropTypes,
  ...withBreakpointPropTypes,
  ...withRouterPropTypes,
  ...buttonProps,
});

function Foo({}) {
  return <div />;
}

Foo.propTypes = propTypes;

export default withStyles(() => ({}))(withBreakpoint(withRouter(Foo)));
`;

    expect(await run(text)).toBe(`import React from 'react';
import { InferProps } from "prop-types";
import { withStyles, withStylesPropTypes, WithStylesProps } from ":dls-themes/withStyles";
import withBreakpoint, { withBreakpointPropTypes, WithBreakpointProps } from ":dls-core/components/breakpoints/withBreakpoint";
import { withRouter } from 'react-router';
import withRouterPropTypes from ':routing/shapes/RR4PropTypes';
import { buttonProps } from './somewhere/Button';
import { RouteConfigComponentProps } from "react-router-config";

type Props = {
    foo?: string;
} & WithStylesProps & WithBreakpointProps & RouteConfigComponentProps & InferProps<typeof buttonProps>;

function Foo({}: Props) {
  return <div />;
}

export default withStyles(() => ({}))(withBreakpoint(withRouter(Foo)));
`);
  });

  it('uses shape type', async () => {
    const text = `import React from 'react';
import PropTypes from 'prop-types';
import UserShape from ':shapes/UserShape';

const propTypes = forbidExtraProps({
  foo: PropTypes.string,
  user: UserShape,
});

function Foo({}) {
  return <div />;
}

Foo.propTypes = propTypes;

export default Foo;
`;

    expect(await run(text)).toBe(`import React from 'react';
import UserShape from ':shapes/UserShape';

type Props = {
    foo?: string;
    user?: UserShape;
};

function Foo({}: Props) {
  return <div />;
}

export default Foo;
`);
  });

  it('comments out unprocessed props', async () => {
    const text = `import React from 'react';
import PropTypes from 'prop-types';

const b = PropTypes.string;

const propTypes = forbidExtraProps({
  foo: PropTypes.string,
  a() {
    return true;
  },
  b,
  get c() {},
});

function Foo({}) {
  return <div />;
}

Foo.propTypes = propTypes;

export default Foo;
`;

    expect(await run(text)).toBe(`import React from 'react';
import PropTypes from 'prop-types';

const b = PropTypes.string;

/*
(ts-migrate) TODO: Migrate the remaining prop types
a() {
    return true;
  }
b
get c() {}
*/
type Props = {
    foo?: string;
};

function Foo({}: Props) {
  return <div />;
}

export default Foo;
`);
  });

  it('includes children prop for sfcs', async () => {
    const text = `import React from 'react';
import PropTypes from 'prop-types';

const propTypes = forbidExtraProps({
  children: PropTypes.node,
});

function Foo({}) {
  return <div />;
}

Foo.propTypes = propTypes;

export default Foo;
`;

    expect(await run(text)).toBe(`import React from 'react';

type Props = {
    children?: React.ReactNode;
};

function Foo({}: Props) {
  return <div />;
}

export default Foo;
`);
  });

  it('excludes children prop for classes', async () => {
    const text = `import React from 'react';
import PropTypes from 'prop-types';

const propTypes = forbidExtraProps({
  children: PropTypes.node,
});

class Foo extends React.Component {
  render() {
    return <div />;
  }
}

Foo.propTypes = propTypes;

export default Foo;
`;

    expect(await run(text)).toBe(`import React from 'react';

type Props = {};

class Foo extends React.Component<Props> {
  render() {
    return <div />;
  }
}

export default Foo;
`);
  });

  it('handle textlike proptype correctly', async () => {
    const text = `import React from 'react';
import PropTypes from 'prop-types';
import textlike from 'airbnb-dls-web/build/utils/propTypes/textlike';

const propTypes = {
  foo: textlike,
};

class Foo extends React.Component {
  render() {}
}

Foo.propTypes = propTypes;

export default Foo;
`;

    expect(await run(text)).toBe(`import React from 'react';
import textlike from 'airbnb-dls-web/build/utils/propTypes/textlike';

type Props = {
    foo?: string | React.ReactNode;
};

class Foo extends React.Component<Props> {
  render() {}
}

export default Foo;
`);
  });

  it('uses the instanceOf argument as the type', async () => {
    const text = `import React from 'react';
import PropTypes from 'prop-types';
import models from './models';

const propTypes = {
  createdAt: PropTypes.instanceOf(Date).isRequired,
  pattern: PropTypes.instanceOf(RegExp),
  user: PropTypes.instanceOf(models.User),
  other: PropTypes.instanceOf(getClass()),
};

function Foo({}) {
  return <div />;
}

Foo.propTypes = propTypes;

export default Foo;
`;

    expect(await run(text)).toBe(`import React from 'react';
import models from './models';

type Props = {
    createdAt: Date;
    pattern?: RegExp;
    user?: models.User;
    other?: any; // TODO: PropTypes.instanceOf(getClass())
};

function Foo({}: Props) {
  return <div />;
}

export default Foo;
`);
  });

  it('handles exact like shape', async () => {
    const text = `import React from 'react';
import PropTypes from 'prop-types';

const propTypes = {
  user: PropTypes.exact({
    id: PropTypes.string.isRequired,
    age: PropTypes.number,
  }),
};

function Foo({}) {
  return <div />;
}

Foo.propTypes = propTypes;

export default Foo;
`;

    expect(await run(text)).toBe(`import React from 'react';

type Props = {
    user?: {
        id: string;
        age?: number;
    };
};

function Foo({}: Props) {
  return <div />;
}

export default Foo;
`);
  });

  it('distinguishes elementType from element', async () => {
    const text = `import React from 'react';
import PropTypes from 'prop-types';

const propTypes = {
  icon: PropTypes.element,
  as: PropTypes.elementType,
  Renderer: PropTypes.elementType.isRequired,
};

function Foo({}) {
  return <div />;
}

Foo.propTypes = propTypes;

export default Foo;
`;

    expect(await run(text)).toBe(`import React from 'react';

type Props = {
    icon?: React.ReactElement;
    as?: React.ElementType;
    Renderer: React.ElementType;
};

function Foo({}: Props) {
  return <div />;
}

export default Foo;
`);
  });

  it('handles non-string oneOf members', async () => {
    const text = `import React from 'react';
import PropTypes from 'prop-types';

const propTypes = {
  size: PropTypes.oneOf(['small', 'large']),
  level: PropTypes.oneOf([1, 2, 3]),
  flag: PropTypes.oneOf([true, false]),
  mixed: PropTypes.oneOf(['auto', 0, null, undefined]),
  offset: PropTypes.oneOf([-1, 0, 1]),
};

function Foo({}) {
  return <div />;
}

Foo.propTypes = propTypes;

export default Foo;
`;

    expect(await run(text)).toBe(`import React from 'react';

type Props = {
    size?: 'small' | 'large';
    level?: 1 | 2 | 3;
    flag?: true | false;
    mixed?: 'auto' | 0 | null | undefined;
    offset?: -1 | 0 | 1;
};

function Foo({}: Props) {
  return <div />;
}

export default Foo;
`);
  });

  it('handles oneOf over an enum-like object', async () => {
    const text = `import React from 'react';
import PropTypes from 'prop-types';
import STATUS from './status';
import constants from './constants';

const propTypes = {
  status: PropTypes.oneOf(Object.values(STATUS)),
  statusKey: PropTypes.oneOf(Object.keys(STATUS)),
  nested: PropTypes.oneOf(Object.values(constants.STATUS)),
};

function Foo({}) {
  return <div />;
}

Foo.propTypes = propTypes;

export default Foo;
`;

    expect(await run(text)).toBe(`import React from 'react';
import STATUS from './status';
import constants from './constants';

type Props = {
    status?: (typeof STATUS)[keyof typeof STATUS];
    statusKey?: keyof typeof STATUS;
    nested?: (typeof constants.STATUS)[keyof typeof constants.STATUS];
};

function Foo({}: Props) {
  return <div />;
}

export default Foo;
`);
  });

  it('keeps the TODO fallback for oneOf arguments it cannot type', async () => {
    const text = `import React from 'react';
import PropTypes from 'prop-types';
import STATUSES from './statuses';

const propTypes = {
  status: PropTypes.oneOf(STATUSES),
  entry: PropTypes.oneOf(Object.entries(STATUSES)),
  computed: PropTypes.oneOf([FOO, BAR]),
  empty: PropTypes.oneOf([]),
};

function Foo({}) {
  return <div />;
}

Foo.propTypes = propTypes;

export default Foo;
`;

    expect(await run(text)).toBe(`import React from 'react';
import STATUSES from './statuses';

type Props = {
    status?: any; // TODO: PropTypes.oneOf(STATUSES)
    entry?: any; // TODO: PropTypes.oneOf(Object.entries(STATUSES))
    computed?: any; // TODO: PropTypes.oneOf([FOO, BAR])
    empty?: any; // TODO: PropTypes.oneOf([])
};

function Foo({}: Props) {
  return <div />;
}

export default Foo;
`);
  });

  it('Handles destructuring of prop-types', async () => {
    const text = `import React from "react";
import { oneOf, node, func as propTypeFn } from "prop-types";
import SomeClass from "someclass";

const Foo = ({ children, className }) => {
  return <div className={className}>children</div>;
};

Foo.propTypes = {
  children: node,
  callback: propTypeFn,
  someObject: SomeClass,
};

export default Foo;`;

    expect(await run(text)).toBe(`import React from "react";
import SomeClass from "someclass";

type Props = {
    children?: React.ReactNode;
    callback?: (...args: any[]) => any;
    someObject?: SomeClass;
};

const Foo = ({ children, className }: Props) => {
  return <div className={className}>children</div>;
};

export default Foo;`);
  });

  it('do not crash on the Types.shape()', async () => {
    const text = `
import React from 'react';
import Types from 'prop-types';
import Link from ':dls-legacy-16/components/deprecated/Link_20190703';
import Spacing from ':dls-legacy-16/components/exp/Spacing';
const propTypes = {
  subtitle: Types.string.isRequired,
  learnMoreLinkText: Types.string.isRequired,
  paymentPlanModalContent: Types.shape().isRequired,
  showPaymentPlanModal: Types.func.isRequired,
};
export default class PaymentPlanOptionExplanation extends React.PureComponent {
  render() {
    const {
      subtitle,
      learnMoreLinkText,
      paymentPlanModalContent,
      showPaymentPlanModal,
    } = this.props;
    return (
      <div>
        {subtitle}
        <Spacing left={0.5} inline>
          <Link onPress={() => showPaymentPlanModal(paymentPlanModalContent)}>
            {learnMoreLinkText}
          </Link>
        </Spacing>
      </div>
    );
  }
}
PaymentPlanOptionExplanation.propTypes = propTypes;
`;

    expect(await run(text)).toBe(`
import React from 'react';
import Link from ':dls-legacy-16/components/deprecated/Link_20190703';
import Spacing from ':dls-legacy-16/components/exp/Spacing';
type Props = {
    subtitle: string;
    learnMoreLinkText: string;
    paymentPlanModalContent: any; // TODO: Types.shape()
    showPaymentPlanModal: (...args: any[]) => any;
};
export default class PaymentPlanOptionExplanation extends React.PureComponent<Props> {
  render() {
    const {
      subtitle,
      learnMoreLinkText,
      paymentPlanModalContent,
      showPaymentPlanModal,
    } = this.props;
    return (
      <div>
        {subtitle}
        <Spacing left={0.5} inline>
          <Link onPress={() => showPaymentPlanModal(paymentPlanModalContent)}>
            {learnMoreLinkText}
          </Link>
        </Spacing>
      </div>
    );
  }
}
`);
  });

  it('handles single-parameter arrow functions with no parentheses', async () => {
    const text = `\
const InfoPanel = props => {
  return null;
};

InfoPanel.propTypes = {
  foo: PropTypes.bool,
};
`;

    expect(await run(text)).toBe(`

type Props = {
    foo?: boolean;
};const InfoPanel =(props: Props) => {
  return null;
};
`);
  });
});
