import { PluginFileNotice } from '@obiemunoz/ts-migrate-server';
import { withoutMarkers } from '../test-utils';
import { run, typeCheck } from './react-default-props.harness';

/** Enough of the hint to recognize the marker without restating its wording. */
const REACT_19_HINT_START = 'React 19 ignores defaultProps on function components.';

describe('react-default-props plugin, modernizeDefaultProps', () => {
  const options = { modernizeDefaultProps: true };

  const modernize = (text: string, notices?: PluginFileNotice[]) =>
    run(text, { options, reportFileNotice: notices ? (notice) => notices.push(notice) : undefined }) as Promise<string | undefined>;

  /** The gates fall back to the typing path, which is the run without the flag. */
  const expectFallback = async (text: string, reason?: string) => {
    const notices: PluginFileNotice[] = [];
    const modernized = await modernize(text, notices);
    const legacy = await run(text, { options: {} });

    // The marker is the only thing the modernize run adds over the typing path.
    expect(withoutMarkers(modernized) ?? text).toEqual(legacy ?? text);
    expect(modernized ?? text).toContain('defaultProps');
    if (reason !== undefined) {
      expect(notices.map((notice) => notice.reason)).toEqual([
        `Left defaultProps in place: ${reason}.`,
      ]);
      expect(modernized).toContain(`// TODO(ts-migrate): ${REACT_19_HINT_START}`);
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
        hint:
          'React 19 ignores defaultProps on function components. Convert to destructured ' +
          'parameter defaults by hand.',
        recovered: true,
        marked: true,
      },
    ]);
  });

  it('marks the site it left, so the file carries the work the log would bury', async () => {
    const text = `import React from 'react';

type Props = {
  items: string[];
};

function List({ items }: Props) {
  return <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}
List.defaultProps = { items: [] };

export default List;`;

    const marked = (await modernize(text)) as string;

    expect(marked).toContain(`// TODO(ts-migrate): ${REACT_19_HINT_START} Convert to
// destructured parameter defaults by hand.
// Left defaultProps in place: a default value is not a literal.
List.defaultProps = { items: [] };`);
    expect(typeCheck({ '/file.tsx': marked })).toEqual([]);
  });

  it('leaves the marker it already wrote alone when the run repeats', async () => {
    const text = `import React from 'react';

type Props = {
  items: string[];
};

function List({ items }: Props) {
  return <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>;
}
List.defaultProps = { items: [] };

export default List;`;

    const notices: PluginFileNotice[] = [];
    const once = (await modernize(text)) as string;
    const twice = await modernize(once, notices);

    // Identical text is what the runner reads as unchanged, so nothing is rewritten.
    expect(twice).toBe(once);
    expect(once.match(/TODO\(ts-migrate\)/g)).toHaveLength(1);
    // Still reported: the work is outstanding whether or not this run wrote the marker.
    expect(notices.map((notice) => notice.marked)).toEqual([true]);
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
    expect(withoutMarkers(result)).toBe(`import React from 'react';

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

    expect(withoutMarkers(fromDeclaration)).toBe(`import React from 'react';

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

    const result = (await run(text)) as string;

    expect(result).toContain('Button.defaultProps = { size: \'md\' };');
    expect(result).toContain('type Props = OwnProps & (typeof Button)["defaultProps"];');
  });
});
