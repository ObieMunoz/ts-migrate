import relaxParameterShapesPlugin from '../../src/plugins/relax-parameter-shapes';
import { realPluginParams } from '../test-utils';

const run = async (
  text: string,
  extraFiles: { [fileName: string]: string } = {},
  options: { anyAlias?: string } = {},
) =>
  relaxParameterShapesPlugin.run(
    await realPluginParams({ fileName: 'declares.ts', text, extraFiles, options }),
  );

describe('relax-parameter-shapes plugin', () => {
  it('makes a member no call supplies optional', async () => {
    const text = `export function route({ path, locale }: { path: string; locale: string }) {
  return \`\${locale}\${path}\`;
}
`;
    const result = await run(text, {
      'calls.ts': `import { route } from './declares';\nroute({ path: '/a' });\n`,
    });

    expect(result).toBe(`export function route({ path, locale }: { path: string; locale?: string }) {
  return \`\${locale}\${path}\`;
}
`);
  });

  it('drops a shape whose last required member the calls refute', async () => {
    const text = `export function stateInfo(next: { location: any }) {
  return next.location;
}
`;
    const result = await run(text, {
      'calls.ts':
        `import { stateInfo } from './declares';\nconst props = { id: 1 };\nstateInfo(props);\n`,
    });

    expect(result).toBe(`export function stateInfo(next: any) {
  return next.location;
}
`);
  });

  it('writes the any alias where one is configured', async () => {
    const text = `export function stateInfo(next: { location: any }) {
  return next.location;
}
`;
    const result = await run(
      text,
      {
        'calls.ts':
          `import { stateInfo } from './declares';\nconst props = { id: 1 };\nstateInfo(props);\n`,
      },
      { anyAlias: '$TSFixMe' },
    );

    expect(result).toBe(`export function stateInfo(next: $TSFixMe) {
  return next.location;
}
`);
  });

  it('widens a member whose type the calls contradict', async () => {
    const text = `export function validate(value: { trim: string; length: number }) {
  return value.length > 0;
}
`;
    const result = await run(text, {
      'calls.ts': `import { validate } from './declares';\nvalidate('abc');\n`,
    });

    expect(result).toBe(`export function validate(value: { trim: any; length: number }) {
  return value.length > 0;
}
`);
  });

  it('keeps an all-optional shape when a member type is contradicted', async () => {
    const text = `export function apply(config: { retries?: number; label?: string }) {
  return config.retries;
}
`;
    const result = await run(text, {
      'calls.ts': `import { apply } from './declares';\napply({ retries: 'two' });\n`,
    });

    expect(result).toBe(`export function apply(config: { retries?: any; label?: string }) {
  return config.retries;
}
`);
  });

  it('leaves a shape every call satisfies', async () => {
    const text = `export function route({ path, locale }: { path: string; locale: string }) {
  return \`\${locale}\${path}\`;
}
`;
    const result = await run(text, {
      'calls.ts': `import { route } from './declares';\nroute({ path: '/a', locale: 'en' });\n`,
    });

    expect(result).toBeUndefined();
  });

  it('leaves a declaration with no body, whose contract is someone else to keep', async () => {
    const text = `export declare function send(payload: { id: string; token: string }): void;
`;
    const result = await run(text, {
      'calls.ts': `import { send } from './declares';\nsend({ id: 'a' });\n`,
    });

    expect(result).toBeUndefined();
  });

  it('drops a relaxation the declaring body contradicts', async () => {
    const text = `export function greet(user: { name: string; title: string }) {
  const title: string = user.title;
  return \`\${title} \${user.name}\`;
}
`;
    const result = await run(text, {
      'calls.ts': `import { greet } from './declares';\ngreet({ name: 'a' });\n`,
    });

    expect(result).toBeUndefined();
  });

  it('leaves a member typed by a name the project declares', async () => {
    const text = `import { Locale } from './types';

export function route(config: { locale: Locale; retries: number }) {
  return [config.locale, config.retries];
}
`;
    const result = await run(text, {
      'types.ts': `export type Locale = { key: string; primary: boolean };\n`,
      'calls.ts':
        `import { route } from './declares';\n` +
        `const config = { locale: { key: 'en' }, retries: 1 };\n` +
        `route(config);\n`,
    });

    expect(result).toBeUndefined();
  });

  it('keeps a shape that names a project type rather than dropping it', async () => {
    const text = `import { Locale } from './types';

export function pick(config: { locale: Locale }) {
  return config.locale;
}
`;
    const result = await run(text, {
      'types.ts': `export type Locale = { key: string; primary: boolean };\n`,
      'calls.ts':
        `import { pick } from './declares';\nconst config = { id: 1 };\npick(config);\n`,
    });

    expect(result).toBeUndefined();
  });

  it('widens a member typed by a name only the standard library declares', async () => {
    const text = `export function collect(input: { items: Array<number>; label: string }) {
  return input.items.length + input.label.length;
}
`;
    const result = await run(text, {
      'calls.ts':
        `import { collect } from './declares';\n` +
        `const input = { items: ['a'], label: 'x' };\n` +
        `collect(input);\n`,
    });

    expect(result).toBe(`export function collect(input: { items: any; label: string }) {
  return input.items.length + input.label.length;
}
`);
  });

  it('relaxes each member the calls between them refute', async () => {
    const text = `export function open(target: { href: string; title: string; id: string }) {
  return [target.href, target.title, target.id];
}
`;
    const result = await run(text, {
      'calls.ts':
        `import { open } from './declares';\n` +
        `open({ href: '/a', id: 'one' });\n` +
        `open({ href: '/b', title: 'B' });\n`,
    });

    expect(result)
      .toBe(`export function open(target: { href: string; title?: string; id?: string }) {
  return [target.href, target.title, target.id];
}
`);
  });
});
