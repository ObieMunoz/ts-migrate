import ts from 'typescript';
import { mockPluginParams, realPluginRunner, typeCheck } from '../test-utils';
import declareEmptyObjectPropertiesPlugin from '../../src/plugins/declare-empty-object-properties';
import declareMissingClassPropertiesPlugin from '../../src/plugins/declare-missing-class-properties';

const runPlugin = realPluginRunner(declareEmptyObjectPropertiesPlugin, {
  options: { anyAlias: '$TSFixMe' },
});
const runDeclareMissingProperties = realPluginRunner(declareMissingClassPropertiesPlugin, {
  options: { anyAlias: '$TSFixMe' },
});

// A test asserts on text, so a plugin that made no change reads as the input.
async function run(text: string, compilerOptions?: ts.CompilerOptions): Promise<string> {
  return (await runPlugin(text, { compilerOptions })) ?? text;
}

async function declareMissingProperties(text: string): Promise<string> {
  return (await runDeclareMissingProperties(text)) ?? text;
}

describe('declare-empty-object-properties plugin', () => {
  it('types an accumulator from its property assignments', async () => {
    const text = `const cache = {};
cache.total = 1;
cache.label = 'x';
export default cache;
`;

    const result = await run(text);

    expect(result).toBe(`const cache: { total?: number; label?: string } = {};
cache.total = 1;
cache.label = 'x';
export default cache;
`);
    expect(typeCheck(result)).toEqual([]);
  });

  it('leaves an accumulator with no reported write alone', async () => {
    const text = `const cache: { total?: number } = {};
cache.total = 1;
export default cache;
`;

    expect(await run(text)).toBe(text);
  });

  it('is idempotent', async () => {
    const text = `const cache = {};
cache.total = 1;
export default cache;
`;

    const once = await run(text);
    expect(await run(once)).toBe(once);
  });

  it('unions the types of repeated assignments to one key', async () => {
    const text = `declare const flag: boolean;
const cache = {};
cache.value = 1;
if (flag) {
  cache.value = 'x';
}
export default cache;
`;

    const result = await run(text);

    expect(result).toContain('const cache: { value?: number | string } = {};');
    expect(typeCheck(result)).toEqual([]);
  });

  it('declares string-literal keys and quotes the ones that need it', async () => {
    const text = `const cache = {};
cache['total'] = 1;
cache['a-b'] = 'x';
export default cache;
`;

    const result = await run(text);

    expect(result).toContain(`const cache: { total?: number; "a-b"?: string } = {};`);
    expect(typeCheck(result)).toEqual([]);
  });

  it('leaves computed keys for add-conversions', async () => {
    const text = `declare const key: string;
const cache = {};
cache[key] = 1;
export default cache;
`;

    expect(await run(text)).toBe(text);
  });

  it('keeps a computed key writable alongside a declared one', async () => {
    const text = `declare const key: string;
const cache = {};
cache.total = 1;
cache[key] = 2;
export default cache;
`;

    const result = await run(text);

    expect(result).toContain('const cache: { total?: number } = {};');
  });

  it('takes the alias for a value the checker only types any', async () => {
    const text = `declare const thing: any;
const cache = {};
cache.total = thing;
export default cache;
`;

    const result = await run(text);

    expect(result).toContain('const cache: { total?: $TSFixMe } = {};');
  });

  it.each([
    ['an empty array', 'cache.items = [];\ncache.items.push(1);'],
    ['an empty object', 'cache.items = {};\ncache.items.nested = 1;'],
    ['null', 'cache.items = null;'],
  ])('takes the alias for %s', async (_name, body) => {
    const text = `const cache = {};
${body}
export default cache;
`;

    const result = await run(text);

    expect(result).toContain('const cache: { items?: $TSFixMe } = {};');
  });

  it('leaves the file untouched when the annotation would introduce an error', async () => {
    const text = `let cache = {};
cache.total = 1;
cache = { label: 'x' };
export default cache;
`;

    expect(await run(text)).toBe(text);
  });

  it('leaves the file untouched when a value type has no name in scope', async () => {
    const text = `const cache = {};
function make() {
  class Local {
    x = 1;
  }
  return new Local();
}
cache.node = make();
export default cache;
`;

    expect(await run(text)).toBe(text);
  });

  it('keeps the declarations that check when another one does not', async () => {
    const text = `let broken = {};
broken.total = 1;
broken = { label: 'x' };
const kept = {};
kept.count = 2;
export { broken, kept };
`;

    const result = await run(text);

    expect(result).toContain('let broken = {};');
    expect(result).toContain('const kept: { count?: number } = {};');
    // The write `broken` kept is the one add-conversions casts, and the only
    // error left: annotating it would have made the reassignment below fail.
    const diagnostics = typeCheck(result);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toContain('TS2339');
  });

  it('types an accumulator whose values are objects and functions', async () => {
    const text = `const config = {};
config.options = { retries: 2, label: 'x' };
config.load = () => 1;
export default config;
`;

    const result = await run(text);

    expect(result).toContain(
      'const config: { options?: { retries: number; label: string; }; load?: () => number } = {};',
    );
    expect(typeCheck(result)).toEqual([]);
  });

  it('works without strictNullChecks', async () => {
    const text = `const cache = {};
cache.total = 1;
cache.items = [];
export default cache;
`;

    const result = await run(text, { strict: false, noImplicitAny: false });

    expect(result).toContain('const cache: { total?: number; items?: $TSFixMe } = {};');
  });

  it('does nothing without a program', () => {
    const text = `const cache = {};
cache.total = 1;
`;

    expect(declareEmptyObjectPropertiesPlugin.run(mockPluginParams({ text }))).toBe(text);
  });

  describe('class properties', () => {
    it('types a property from the writes through this', async () => {
      const text = `class C {
  cache = {};
  load() {
    this.cache.total = 1;
    this.cache.label = 'x';
  }
}
export default C;
`;

      const result = await run(text);

      expect(result).toContain('cache: { total?: number; label?: string } = {};');
      expect(typeCheck(result)).toEqual([]);
    });

    it('is idempotent', async () => {
      const text = `class C {
  cache = {};
  load() {
    this.cache.total = 1;
  }
}
export default C;
`;

      const once = await run(text);
      expect(await run(once)).toBe(once);
    });

    it('types a static property from the writes through the class', async () => {
      const text = `class C {
  static cache = {};
}
C.cache.total = 1;
export default C;
`;

      const result = await run(text);

      expect(result).toContain('static cache: { total?: number } = {};');
      expect(typeCheck(result)).toEqual([]);
    });

    it('types a private property', async () => {
      const text = `class C {
  #cache = {};
  load() {
    this.#cache.total = 1;
  }
  read() {
    return this.#cache;
  }
}
export default C;
`;

      const result = await run(text, { target: ts.ScriptTarget.ES2020 });

      expect(result).toContain('#cache: { total?: number } = {};');
      expect(typeCheck(result)).toEqual([]);
    });

    it('takes the alias for a value the checker only types any', async () => {
      const text = `class C {
  cache = {};
  load(thing: any) {
    this.cache.total = thing;
  }
}
export default C;
`;

      const result = await run(text);

      expect(result).toContain('cache: { total?: $TSFixMe } = {};');
    });

    it('leaves the property alone when the annotation would introduce an error', async () => {
      const text = `class C {
  cache = {};
  load() {
    this.cache.total = 1;
    this.cache = { label: 'x' };
  }
}
export default C;
`;

      expect(await run(text)).toBe(text);
    });
  });

  describe('deferred assignment', () => {
    it('types a let whose first assignment is the empty object', async () => {
      const text = `let cache;
cache = {};
cache.total = 1;
cache.label = 'x';
export default cache;
`;

      const result = await run(text);

      expect(result).toBe(`let cache: { total?: number; label?: string };
cache = {};
cache.total = 1;
cache.label = 'x';
export default cache;
`);
      expect(typeCheck(result)).toEqual([]);
    });

    it('is idempotent', async () => {
      const text = `let cache;
cache = {};
cache.total = 1;
export default cache;
`;

      const once = await run(text);
      expect(await run(once)).toBe(once);
    });

    it('takes the alias for a value the checker found nothing for', async () => {
      const text = `let cache;
cache = {};
cache.items = [];
export default cache;
`;

      const result = await run(text);

      expect(result).toContain('let cache: { items?: $TSFixMe };');
    });

    it('leaves a let whose first assignment is not the empty object alone', async () => {
      const text = `let cache;
cache = { total: 0 };
cache.label = 'x';
export default cache;
`;

      expect(await run(text)).toBe(text);
    });

    it('leaves the declaration alone when the annotation would introduce an error', async () => {
      const text = `let cache;
cache = {};
cache.total = 1;
cache = 'x';
export default cache;
`;

      expect(await run(text)).toBe(text);
    });

    it('leaves the declaration alone without noImplicitAny, where nothing reports', async () => {
      const text = `let cache;
cache = {};
cache.total = 1;
export default cache;
`;

      expect(await run(text, { strict: false, noImplicitAny: false })).toBe(text);
    });
  });

  describe('alongside declare-missing-class-properties', () => {
    it('types the empty object property it skipped', async () => {
      const text = `class C {
  cache = {};
  constructor() {
    this.pending = true;
  }
  load() {
    this.cache.total = 1;
  }
}
export default C;
`;

      const declared = await declareMissingProperties(text);
      expect(declared).toContain('pending;');
      expect(declared).toContain('cache = {};');

      const result = await run(declared);

      expect(result).toContain('cache: { total?: number } = {};');
      expect(result).toContain('pending;');
      expect(typeCheck(result)).toEqual([]);
    });

    it('types its own empty object property and not the one it declared', async () => {
      const text = `class C {
  cache = {};
  constructor() {
    this.pending = {};
  }
  load() {
    this.cache.total = 1;
    this.pending.id = 'x';
  }
}
export default C;
`;

      const declared = await declareMissingProperties(text);
      expect(declared).toContain(`pending: { id?: string };`);
      expect(declared).toContain('cache = {};');

      const result = await run(declared);

      expect(result).toContain('cache: { total?: number } = {};');
      expect(result).toContain(`pending: { id?: string };`);
      expect(typeCheck(result)).toEqual([]);
    });

    it('leaves the declarations it added alone', async () => {
      const text = `class C {
  constructor() {
    this.pending = true;
    this.cache = {};
  }
  load() {
    this.cache.total = 1;
  }
}
export default C;
`;

      const declared = await declareMissingProperties(text);
      expect(declared).toContain('pending;');
      expect(declared).toContain('cache: { total?: number };');

      expect(await run(declared)).toBe(declared);
      expect(typeCheck(declared)).toEqual([]);
    });
  });
});
