import ts from 'typescript';
import { PluginParams } from '@obiemunoz/ts-migrate-server';
import {
  createSuppressionExplainer,
  formatSuppressionReport,
  formatSuppressionSummary,
  SuppressionReport,
  SuppressionSite,
} from '../../../src/utils/suppressionExplainer';
import tsIgnorePlugin from '../../../src/plugins/ts-ignore';
import { realPluginParams } from '../../test-utils';

/** The explainer's own root, so declarations in /file.ts count as project files. */
const ROOT_DIR = '/';

async function explain(
  text: string,
  extraFiles?: { [fileName: string]: string },
): Promise<{ report: SuppressionReport; params: PluginParams<unknown> }> {
  const params = { ...(await realPluginParams({ text, extraFiles })), rootDir: ROOT_DIR };
  const explainer = createSuppressionExplainer();
  const result = await explainer.plugin.run(params);
  expect(result).toBeUndefined();
  return { report: explainer.summarize(ROOT_DIR), params };
}

/** One explainer over several files, as a run visits them. */
async function explainAll(texts: { [fileName: string]: string }): Promise<SuppressionReport> {
  const explainer = createSuppressionExplainer();
  const fileNames = Object.keys(texts);
  const paramsList = await Promise.all(
    fileNames.map((fileName) =>
      realPluginParams({
        fileName,
        text: texts[fileName],
        extraFiles: Object.fromEntries(
          fileNames.filter((other) => other !== fileName).map((other) => [other, texts[other]]),
        ),
      }),
    ),
  );
  await Promise.all(
    paramsList.map((params) => explainer.plugin.run({ ...params, rootDir: ROOT_DIR })),
  );
  return explainer.summarize(ROOT_DIR);
}

function siteFor(report: SuppressionReport, code: number): SuppressionSite {
  const site = report.sites.find((candidate) => candidate.code === code);
  if (!site) {
    throw new Error(
      `No TS${code} recorded; got ${report.sites.map((s) => `TS${s.code}`).join(', ')}`,
    );
  }
  return site;
}

describe('createSuppressionExplainer', () => {
  it('records one entry per diagnostic, including the ones that share a line', async () => {
    const { report } = await explain(
      ['function greet(name: string, greeting: string) {}', "greet('a'); greet('b');", ''].join(
        '\n',
      ),
    );

    expect(report.total).toBe(2);
    expect(report.commented).toBe(1);
    expect(report.sharedLine).toBe(1);
    expect(report.sites.map((site) => site.commented)).toEqual([true, false]);
    expect(report.sites.map((site) => site.location.line)).toEqual([2, 2]);
    expect(report.codes).toEqual([
      expect.objectContaining({ code: 2554, count: 2, comments: 1, fileCount: 1 }),
    ]);
  });

  it('records a diagnostic inside a multiline template, which the comment may not reach', async () => {
    const { report } = await explain(['const x = `', '  ${missingName}', '`;', ''].join('\n'));

    const site = siteFor(report, 2304);
    expect(site.location.line).toBe(2);
    expect(site.evidence?.unresolved).toBe('missingName');
  });

  it('leaves the file untouched', async () => {
    const text = "function greet(name: string, greeting: string) {}\ngreet('a');\n";
    const params = { ...(await realPluginParams({ text })), rootDir: ROOT_DIR };
    const explainer = createSuppressionExplainer();

    expect(await explainer.plugin.run(params)).toBeUndefined();
    expect(params.text).toBe(text);
  });

  it('does not double count a file it already visited', async () => {
    const params = {
      ...(await realPluginParams({
        text: "function greet(name: string, greeting: string) {}\ngreet('a');\n",
      })),
      rootDir: ROOT_DIR,
    };
    const explainer = createSuppressionExplainer();

    await explainer.plugin.run(params);
    await explainer.plugin.run(params);

    expect(explainer.summarize(ROOT_DIR).total).toBe(1);
  });

  // ts-ignore repairs these instead of suppressing them, so counting them here
  // would report suppressions the files do not have.
  it('does not count a value imported with `import type`, which is repaired', async () => {
    const extraFiles = { 'cn.ts': 'export function cn(a: string) { return a; }\n' };
    const { report } = await explain(
      `import type { cn } from './cn';\n\nexport const classes = cn('a');\nconst n: number = 'x';\n`,
      extraFiles,
    );

    expect(report.sites.map((site) => site.code)).toEqual([2322]);
    expect(report.total).toBe(1);
  });

  it('reports a notice instead of failing when the language service throws', async () => {
    const notices: string[] = [];
    const params = {
      ...(await realPluginParams({ text: 'const a: number = "x";\n' })),
      rootDir: ROOT_DIR,
      getLanguageService: () => {
        throw new Error('program gone');
      },
      reportFileNotice: (notice: { reason: string }) => notices.push(notice.reason),
    } as unknown as PluginParams<unknown>;
    const explainer = createSuppressionExplainer();

    expect(await explainer.plugin.run(params)).toBeUndefined();
    expect(notices).toEqual([expect.stringContaining('program gone')]);
    expect(explainer.summarize(ROOT_DIR).total).toBe(0);
  });
});

describe('checker evidence', () => {
  it('keeps the resolved signature and the callee declaration for TS2554', async () => {
    const { report } = await explain(
      ['function greet(name: string, greeting: string) {}', "greet('a');", ''].join('\n'),
    );

    const { evidence } = siteFor(report, 2554);
    expect(evidence?.signature).toBe('(name: string, greeting: string): void');
    expect(evidence?.parameters).toEqual([
      { name: 'name', type: 'string', optional: false, rest: false },
      { name: 'greeting', type: 'string', optional: false, rest: false },
    ]);
    expect(evidence?.argumentCount).toBe(1);
    expect(evidence?.requiredCount).toBe(2);
    expect(evidence?.declaredAt).toEqual({ file: 'file.ts', line: 1, column: 1 });
    expect(evidence?.declarationKind).toBe('FunctionDeclaration');
    expect(evidence?.declaredInProject).toBe(true);
    expect(report.codes[0].fixShapes).toEqual([
      { shape: 'too few arguments, trailing parameters could be optional', count: 1 },
    ]);
  });

  it('separates a trailing-optional TS2554 from one with too many arguments', async () => {
    const { report } = await explain(
      ['function two(a: number, b: number) {}', 'two(1);', 'two(1, 2, 3);', ''].join('\n'),
    );

    expect(report.codes[0].fixShapes).toEqual([
      { shape: 'too few arguments, trailing parameters could be optional', count: 1 },
      { shape: 'too many arguments for the signature', count: 1 },
    ]);
  });

  it('marks a callee declared outside the project as a different fix shape', async () => {
    const { report } = await explain('const at = "x".indexOf();\n');

    const site = siteFor(report, 2554);
    expect(site.evidence?.declaredInProject).toBe(false);
    expect(report.codes[0].fixShapes).toEqual([
      { shape: 'too few arguments, callee declared outside the project', count: 1 },
    ]);
  });

  it('keeps the parameter type, the argument type and the missing properties for TS2345', async () => {
    const { report } = await explain(
      [
        'interface Target { a: string; b: number; c: boolean }',
        'function take(t: Target) {}',
        'take({ a: "x" });',
        '',
      ].join('\n'),
    );

    const { evidence } = siteFor(report, 2345);
    expect(evidence?.signature).toBe('(t: Target): void');
    expect(evidence?.expectedType).toBe('Target');
    expect(evidence?.actualType).toBe('{ a: string; }');
    expect(evidence?.missingProperties).toEqual(['b', 'c']);
    expect(evidence?.declaredAt).toEqual({ file: 'file.ts', line: 2, column: 1 });
    expect(report.codes[0].fixShapes[0].shape).toBe('argument is missing required properties');
  });

  it('keeps the declared type and the literal type of the initializer for TS2322', async () => {
    const { report } = await explain('const n: number = "str";\n');

    const { evidence } = siteFor(report, 2322);
    expect(evidence?.expectedType).toBe('number');
    expect(evidence?.actualType).toBe('"str"');
  });

  it('reads a TS2322 on an object literal property through the contextual type', async () => {
    const { report } = await explain(
      [
        'interface Target { a: string }',
        'function take(t: Target) {}',
        'take({ a: 1 });',
        '',
      ].join('\n'),
    );

    const { evidence } = siteFor(report, 2322);
    expect(evidence?.expectedType).toBe('string');
    expect(evidence?.actualType).toBe('1');
  });

  it('keeps both member declarations for TS2416', async () => {
    const { report } = await explain(
      [
        'class Base { m(x: string): void {} }',
        'class Derived extends Base { m(x: number): void {} }',
        '',
      ].join('\n'),
    );

    const { evidence } = siteFor(report, 2416);
    expect(evidence?.derivedMember).toEqual({
      name: 'm',
      kind: 'MethodDeclaration',
      type: '(x: number) => void',
      location: { file: 'file.ts', line: 2, column: 30 },
    });
    expect(evidence?.baseMember).toEqual({
      name: 'm',
      kind: 'MethodDeclaration',
      type: '(x: string) => void',
      location: { file: 'file.ts', line: 1, column: 14 },
    });
  });

  it('records every overload the call was resolved against for TS2769', async () => {
    const { report } = await explain(
      [
        'declare function over(x: string): void;',
        'declare function over(x: number): void;',
        'over(true);',
        '',
      ].join('\n'),
    );

    const { evidence } = siteFor(report, 2769);
    expect(evidence?.candidateSignatures).toEqual([
      '(x: string): void',
      '(x: number): void',
    ]);
    expect(evidence?.argumentTypes).toEqual(['true']);
  });

  it('records the paths the compiler tried for an unresolved module', async () => {
    const { report } = await explain("import { nope } from './nowhere';\n");

    const { evidence } = siteFor(report, 2307);
    expect(evidence?.unresolved).toBe('./nowhere');
    expect(evidence?.failedLookups?.length).toBeGreaterThan(0);
    expect(evidence?.failedLookups).toEqual(
      expect.arrayContaining([expect.stringContaining('nowhere')]),
    );
  });
});

describe('type names that resolve to nothing', () => {
  const documented = (name: string, count: number): string =>
    Array.from({ length: count }, (_, index) => [
      `/** @param {${name}} value */`,
      `export function use${index}(value: ${name}) {}`,
    ])
      .flat()
      .concat('')
      .join('\n');

  it('reports one entry per name, with the count and the files', async () => {
    const report = await explainAll({
      'a.ts': documented('ASTNode', 2),
      'b.ts': documented('ASTNode', 1),
    });

    expect(report.unresolvedTypes).toEqual([
      expect.objectContaining({
        name: 'ASTNode',
        count: 3,
        fileCount: 2,
        files: ['a.ts', 'b.ts'],
        documented: 3,
      }),
    ]);
  });

  it('does not report a name that resolves', async () => {
    const { report } = await explain(
      [
        'interface Resolves { a: string }',
        '/** @param {Resolves} value */',
        'export function use(value: Resolves) {}',
        '',
      ].join('\n'),
    );

    expect(report.unresolvedTypes).toEqual([]);
  });

  it('does not report an unresolved name written in an expression', async () => {
    const { report } = await explain('export const x = missingName;\n');

    expect(siteFor(report, 2304).evidence?.unresolved).toBe('missingName');
    expect(report.unresolvedTypes).toEqual([]);
  });

  it('counts the sites a comment documents apart from the rest', async () => {
    const { report } = await explain(
      [
        '/** @param {Documented} value */',
        'export function documented(value: Documented) {}',
        'export function annotated(value: Documented) {}',
        '',
      ].join('\n'),
    );

    expect(report.unresolvedTypes).toEqual([
      expect.objectContaining({ name: 'Documented', count: 2, documented: 1 }),
    ]);
  });

  it('names the file that declares a name nothing imported', async () => {
    const { report } = await explain(documented('Declared', 1), {
      'types.ts': 'export interface Declared { a: string }\n',
    });

    expect(report.unresolvedTypes[0]).toEqual(
      expect.objectContaining({
        name: 'Declared',
        declaredAt: { file: 'types.ts', line: 1, column: 1 },
        declarationKind: 'InterfaceDeclaration',
        declaredInProject: true,
      }),
    );
  });

  it('finds a name a namespace declares, which no bare reference could reach', async () => {
    const { report } = await explain(documented('Token', 1), {
      'types.ts': 'export namespace AST {\n  export interface Token { type: string }\n}\n',
    });

    expect(report.unresolvedTypes[0]).toEqual(
      expect.objectContaining({
        name: 'Token',
        declaredAt: { file: 'types.ts', line: 2, column: 3 },
        declarationKind: 'InterfaceDeclaration',
      }),
    );
  });

  it('separates a declaration outside the project from one inside it', async () => {
    const params = {
      ...(await realPluginParams({
        fileName: 'src/file.ts',
        text: documented('Declared', 1),
        extraFiles: { 'vendor/types.ts': 'export interface Declared { a: string }\n' },
      })),
      rootDir: '/src',
    };
    const explainer = createSuppressionExplainer();
    await explainer.plugin.run(params);

    expect(explainer.summarize('/src').unresolvedTypes[0]).toEqual(
      expect.objectContaining({
        name: 'Declared',
        declaredAt: { file: '/vendor/types.ts', line: 1, column: 1 },
        declaredInProject: false,
      }),
    );
  });

  it('says nothing declares a name no file writes', async () => {
    const { report } = await explain(documented('ASTNode', 1));

    expect(report.unresolvedTypes[0]).toEqual(
      expect.objectContaining({ name: 'ASTNode', declaredAt: undefined }),
    );
    expect(report.codes[0].fixShapes).toEqual([
      { shape: 'type name is declared nowhere', count: 1 },
    ]);
  });
});

describe('message preservation', () => {
  it('keeps the whole message chain and the related information', async () => {
    const { report } = await explain(
      [
        'class Base { m(x: string): void {} }',
        'class Derived extends Base { m(x: number): void {} }',
        '',
      ].join('\n'),
    );

    const site = siteFor(report, 2416);
    expect(site.chain.length).toBeGreaterThan(1);
    expect(site.chain[0]).toEqual({
      code: 2416,
      depth: 0,
      message: expect.stringContaining("Property 'm' in type 'Derived'"),
    });
    site.chain.forEach((link) => expect(site.message).toContain(link.message));
    expect(site.chain.map((link) => link.depth)).toEqual([0, 1, 2, 3]);
    expect(site.message).toContain("Type 'string' is not assignable to type 'number'.");
    // ts-ignore keeps 50 characters of the top message and drops the rest.
    expect(site.message.length).toBeGreaterThan(150);
  });

  it('keeps the related information with its source location', async () => {
    const { report } = await explain(
      ['function greet(name: string, greeting: string) {}', "greet('a');", ''].join('\n'),
    );

    expect(siteFor(report, 2554).related).toEqual([
      {
        code: expect.any(Number),
        message: "An argument for 'greeting' was not provided.",
        location: { file: 'file.ts', line: 1, column: 30 },
      },
    ]);
  });

  it('does not truncate type strings the default formatting would cut', async () => {
    const properties = Array.from({ length: 20 }, (_, i) => `veryLongPropertyName${i}: 1`).join(
      ', ',
    );
    const { report, params } = await explain(
      [`const big = { ${properties} };`, 'const n: number = big;', ''].join('\n'),
    );

    const { actualType } = siteFor(report, 2322).evidence ?? {};
    expect(actualType).toBeDefined();
    expect(actualType).not.toContain('...');
    expect(actualType).toContain('veryLongPropertyName19');

    // The same type through the default flags, to show the flag is what keeps it.
    const program = params.getLanguageService().getProgram()!;
    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(params.fileName)!;
    const declaration = sourceFile.statements[0] as ts.VariableStatement;
    const initializer = declaration.declarationList.declarations[0].initializer!;
    const truncated = checker.typeToString(checker.getTypeAtLocation(initializer), initializer);
    expect(truncated).toContain('...');
    expect(actualType!.length).toBeGreaterThan(truncated.length);
  });
});

describe('reconciliation with the comments ts-ignore writes', () => {
  const scrapeCodes = (text: string): Record<number, number> => {
    const counts: Record<number, number> = {};
    const pattern = /@ts-(?:ignore|expect-error) TS\((\d+)\)/g;
    let match = pattern.exec(text);
    while (match) {
      const code = Number(match[1]);
      counts[code] = (counts[code] ?? 0) + 1;
      match = pattern.exec(text);
    }
    return counts;
  };

  it('predicts the per-code comment counts, and states the diagnostics that share a line', async () => {
    const text = [
      'function greet(name: string, greeting: string) {}',
      "greet('a'); greet('b');",
      'const n: number = "str";',
      "import { nope } from './nowhere';",
      '',
    ].join('\n');
    const params = { ...(await realPluginParams({ text })), rootDir: ROOT_DIR };
    const explainer = createSuppressionExplainer();
    await explainer.plugin.run(params);
    const report = explainer.summarize(ROOT_DIR);

    const written = await tsIgnorePlugin.run(params as PluginParams<Record<string, never>>);
    const scraped = scrapeCodes(written as string);

    const predicted: Record<number, number> = {};
    report.codes.forEach((group) => {
      predicted[group.code] = group.comments;
    });
    expect(predicted).toEqual(scraped);

    // The divergence the report has to state: two TS2554 on one line, one comment.
    expect(report.total).toBe(report.commented + report.sharedLine);
    expect(report.sharedLine).toBe(1);
    expect(formatSuppressionReport(report)).toContain('1 shares a line with an earlier diagnostic');
  });
});

describe('formatSuppressionReport', () => {
  it('groups by code and by fix shape, then lists every site', async () => {
    const { report } = await explain(
      [
        'function two(a: number, b: number) {}',
        'two(1);',
        'two(2);',
        'const n: number = "str";',
        '',
      ].join('\n'),
    );
    const formatted = formatSuppressionReport(report);

    expect(formatted).toContain('3 diagnostics in 1 file were suppressed.');
    expect(formatted).toContain('TS2554  2 diagnostics, 2 commented, 1 file');
    expect(formatted).toContain('2  too few arguments, trailing parameters could be optional');
    expect(formatted).toContain('signature: (a: number, b: number): void');
    expect(formatted).toContain('declared at: file.ts:1:1 (FunctionDeclaration)');
    expect(formatted).toContain("related: An argument for 'b' was not provided.");
    expect(formatted).toContain('expected type: number');
    expect(formatted).toContain('actual type: "str"');
  });

  it('groups the unresolved type names by name, with the files that wrote them', async () => {
    const { report } = await explain(
      [
        '/** @param {ASTNode} node */',
        'export function first(node: ASTNode) {}',
        '/** @param {ASTNode} node */',
        'export function second(node: ASTNode) {}',
        '/** @param {Declared} value */',
        'export function third(value: Declared) {}',
        '',
      ].join('\n'),
      { 'types.ts': 'export interface Declared { a: string }\n' },
    );
    const formatted = formatSuppressionReport(report);

    expect(formatted).toContain('Type names that resolve to nothing:');
    expect(formatted).toContain(
      'ASTNode  2 diagnostics in 1 file, 2 written by a comment, nothing declares it',
    );
    expect(formatted).toContain(
      'Declared  1 diagnostic in 1 file, 1 written by a comment, declared at types.ts:1:1 ' +
        '(InterfaceDeclaration), not in scope here',
    );
    expect(formatted).toContain('written by a JSDoc tag over the declaration it annotates');
  });
});

describe('formatSuppressionSummary', () => {
  const emptyReport: SuppressionReport = {
    rootDir: '/root',
    total: 0,
    commented: 0,
    sharedLine: 0,
    fileCount: 0,
    codes: [],
    unresolvedTypes: [],
    sites: [],
  };

  it('returns null when nothing was suppressed', () => {
    expect(formatSuppressionSummary(emptyReport)).toBeNull();
  });

  it('names the top codes and points at the flag when no report file was asked for', async () => {
    const { report } = await explain(
      ['function two(a: number, b: number) {}', 'two(1);', ''].join('\n'),
    );

    const summary = formatSuppressionSummary(report)!;
    expect(summary).toContain('1 diagnostic suppressed in 1 file.');
    expect(summary).toContain(
      'TS2554 x1 — 1 too few arguments, trailing parameters could be optional',
    );
    expect(summary).toContain('Pass --suppressionReportFile <path>');
  });

  it('names the type names that resolve to nothing, largest count first', async () => {
    const { report } = await explain(
      [
        '/** @param {ASTNode} node */',
        'export function first(node: ASTNode) {}',
        '/** @param {ASTNode} node */',
        'export function second(node: ASTNode) {}',
        '/** @param {Declared} value */',
        'export function third(value: Declared) {}',
        '',
      ].join('\n'),
      { 'types.ts': 'export interface Declared { a: string }\n' },
    );

    const summary = formatSuppressionSummary(report)!;
    expect(summary).toContain(
      '2 type names in the annotations resolve to nothing, across 3 diagnostics; ' +
        'the comments write 2 of them.',
    );
    expect(summary).toContain('ASTNode x2 in 1 file — nothing declares it');
    expect(summary).toContain('Declared x1 in 1 file — declared at types.ts:1:1');
  });

  it('names the report file once one was written', async () => {
    const { report } = await explain(
      ['function two(a: number, b: number) {}', 'two(1);', ''].join('\n'),
    );

    expect(formatSuppressionSummary(report, '/tmp/report.txt')).toContain(
      'What the compiler knew at each one is in /tmp/report.txt.',
    );
  });
});
