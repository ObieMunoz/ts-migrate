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
