import { realPluginParams } from '../test-utils';
import addConversionsPlugin from '../../src/plugins/add-conversions';

describe('add-conversions plugin', () => {
  const text = `\
const a = {};
const b = {};

a.b = 1;
a.b = b.c;

if (a.b) {
  b.c = 1;
}

class C extends a.b {
}

enum E {
  A = a.b
}

console.log(a.c);
`;

  it('adds conversions', async () => {
    const result = addConversionsPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`\
const a = {};
const b = {};

(a as any).b = 1;
(a as any).b = (b as any).c;

if ((a as any).b) {
  (b as any).c = 1;
}

class C  extends (a as any).b {
}

enum E {
  A = (a as any).b
}

console.log((a as any).c);
`);
  });

  it('adds conversions with alias', async () => {
    const result = addConversionsPlugin.run(
      await realPluginParams({ text, options: { anyAlias: '$TSFixMe' } }),
    );

    expect(result).toBe(`\
const a = {};
const b = {};

(a as $TSFixMe).b = 1;
(a as $TSFixMe).b = (b as $TSFixMe).c;

if ((a as $TSFixMe).b) {
  (b as $TSFixMe).c = 1;
}

class C  extends (a as $TSFixMe).b {
}

enum E {
  A = (a as $TSFixMe).b
}

console.log((a as $TSFixMe).c);
`);
  });

  it('guards replacements against ASI merging in semicolon-free code', async () => {
    const text = `\
const cache = {}
const result = { value: 1 }
cache.lastFetched = result

if (result) {
}
cache.other = 2
`;
    const result = addConversionsPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`\
const cache = {}
const result = { value: 1 }
;(cache as any).lastFetched = result;

if (result) {
}
(cache as any).other = 2;
`);
  });

  it('adds conversions to unknown types', async () => {
    const text = `\
function f(u: unknown) {
    console.log(u.prop);
}
`;

    const result = addConversionsPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`\
function f(u: unknown) {
    console.log((u as any).prop);
}
`);
  });

  it('replaces only the necessary code in class property arrow functions (issue #134)', async () => {
    const text = `\
class PublishEvent {
  constructor(opts = {}) {
    this._eventName = opts.eventName;
  }

  addEventListener = () => document.addEventListener(this._eventName, this.publish);
}
`;
    const result = addConversionsPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`\
class PublishEvent {
  constructor(opts = {}) {
    (this as any)._eventName = (opts as any).eventName;
  }

  addEventListener = () => document.addEventListener((this as any)._eventName, (this as any).publish);
}
`);
  });

  it('Nested Expression Statements (issue #144) Part 1: Expression Statement -> Expression Statement', async () => {
    const text = `var window = { onResetData: function () { this.clearNextPush = function () { this.setState({ history: [] }); }; } };`;
    const result = addConversionsPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(
      `var window = { onResetData: function () { (this as any).clearNextPush = function () { (this as any).setState({ history: [] }); }; } };`,
    );
  });

  it('Nested Expression Statements (issue #144) Part 2: Expression Statement -> If Statement -> Expression Statement', async () => {
    const text = `const window = { onResetData() { this.clearNextPush = function () {\n    if (this.setState) {\n    this.setState({ history: [] });\n} }; } };`;
    const result = addConversionsPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(
      `const window = { onResetData() { (this as any).clearNextPush = function () {\n    if ((this as any).setState) {\n        (this as any).setState({ history: [] });\n    }\n}; } };`,
    );
  });

  it('replaces nested conversions once when the outer statement is not an expression statement', async () => {
    const text = `\
const registry = {};
const entry = { id: 1 };
function buildList(allowed) {
  return registry.sortOrder.reduce((acc, id) => {
    if (entry.id === id) {
      entry.hidden = !allowed.includes(id);
      acc.push(entry);
    }
    return acc;
  }, []);
}
`;
    const result = addConversionsPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`\
const registry = {};
const entry = { id: 1 };
function buildList(allowed) {
  return (registry as any).sortOrder.reduce((acc, id) => {
    if (entry.id === id) {
        (entry as any).hidden = !allowed.includes(id);
        acc.push(entry);
    }
    return acc;
}, []);
}
`);
  });

  it('casts the key of a lookup table to keyof typeof', async () => {
    const text = `\
const colors = { red: '#f00', blue: '#00f' };

export function pick(name: string) {
  return colors[name].toUpperCase();
}
`;
    const result = addConversionsPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`\
const colors = { red: '#f00', blue: '#00f' };

export function pick(name: string) {
  return colors[name as keyof typeof colors].toUpperCase();
}
`);
  });

  it('casts the key through a qualified object and a numeric index', async () => {
    const text = `\
const config = { theme: { dark: 1, light: 2 } };
const byCode = { 0: 'a', 1: 'b' };

export function read(key: string, code: number) {
  config.theme[key] = 3;
  return byCode[code];
}
`;
    const result = addConversionsPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`\
const config = { theme: { dark: 1, light: 2 } };
const byCode = { 0: 'a', 1: 'b' };

export function read(key: string, code: number) {
  config.theme[key as keyof typeof config.theme] = 3;
  return byCode[code as keyof typeof byCode];
}
`);
  });

  it('falls back to the any cast for open-typed objects', async () => {
    const text = `\
const cache = {};
const rows = [1, 2, 3];
const mixed = { a: 1, b: 'x' };

export function read(key: string) {
  return [cache[key], rows[key], mixed[key], globalThis.myGlobal];
}
`;
    const result = addConversionsPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`\
const cache = {};
const rows = [1, 2, 3];
const mixed = { a: 1, b: 'x' };

export function read(key: string) {
  return [(cache as any)[key], (rows as any)[key], (mixed as any)[key], (globalThis as any).myGlobal];
}
`);
  });

  it('falls back to the any cast when the key type cannot name a property', async () => {
    const text = `\
const colors = { red: 1, blue: 2 };

export function pick(index: number, get: () => { a: number }, key: string) {
  return [colors[index], get()[key]];
}
`;
    const result = addConversionsPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`\
const colors = { red: 1, blue: 2 };

export function pick(index: number, get: () => { a: number }, key: string) {
  return [(colors as any)[index], (get() as any)[key]];
}
`);
  });

  it('uses the any alias for the index access fallback', async () => {
    const text = `\
const cache = {};

export function read(key: string) {
  return cache[key];
}
`;
    const result = addConversionsPlugin.run(
      await realPluginParams({ text, options: { anyAlias: '$TSFixMe' } }),
    );

    expect(result).toBe(`\
const cache = {};

export function read(key: string) {
  return (cache as $TSFixMe)[key];
}
`);
  });

  it('leaves no diagnostics behind for either index access tier', async () => {
    const text = `\
const colors = { red: '#f00', blue: '#00f' };
const cache = {};
const rows = [1, 2, 3];
const mixed = { a: 1, b: 'x' };

export function read(key: string, index: number) {
  mixed[key] = 1;
  return [colors[key], cache[key], rows[key], colors[index], globalThis.myGlobal];
}
`;
    const before = await realPluginParams({ text });
    expect(
      before
        .getLanguageService()
        .getSemanticDiagnostics(before.fileName)
        .map((diag) => diag.code)
        .sort(),
    ).toEqual([7015, 7017, 7053, 7053, 7053, 7053]);

    const result = addConversionsPlugin.run(before) as string;
    const after = await realPluginParams({ text: result });
    expect(after.getLanguageService().getSemanticDiagnostics(after.fileName)).toEqual([]);
  });

  it('handles dollar amounts', async () => {
    const text = `\
import customUtils from "custom-utils";

it("tests", () => {
  thing.fn("$1");

  const thing = {
    value: "$1"
  };
});
`;
    const result = addConversionsPlugin.run(await realPluginParams({ text }));

    expect(result).toBe(`\
import customUtils from "custom-utils";

it("tests", () => {
  (thing as any).fn("$1");

  const thing = {
    value: "$1"
  };
});
`);
  });
});
