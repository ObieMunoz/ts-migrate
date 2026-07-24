import fs from 'fs';
import path from 'path';
import ts from 'typescript';

export interface FileDebt {
  tsExpectError: number;
  tsIgnore: number;
  anyAlias: number;
  any: number;
  /** Error codes embedded in suppression comments, e.g. { TS2304: 3 }. */
  codes: Record<string, number>;
}

export interface TypeDebtReport {
  rootDir: string;
  filesScanned: number;
  /** Global any-aliases declared by the project's .d.ts files, e.g. $TSFixMe. */
  aliasNames: string[];
  totals: FileDebt;
  /** Per-file counts keyed by rootDir-relative path, worst file first. Zero-debt files are omitted. */
  files: Record<string, FileDebt>;
}

function emptyDebt(): FileDebt {
  return { tsExpectError: 0, tsIgnore: 0, anyAlias: 0, any: 0, codes: {} };
}

export function debtTotal(debt: FileDebt): number {
  return debt.tsExpectError + debt.tsIgnore + debt.anyAlias + debt.any;
}

function addDebt(into: FileDebt, debt: FileDebt): void {
  into.tsExpectError += debt.tsExpectError;
  into.tsIgnore += debt.tsIgnore;
  into.anyAlias += debt.anyAlias;
  into.any += debt.any;
  Object.entries(debt.codes).forEach(([code, count]) => {
    into.codes[code] = (into.codes[code] ?? 0) + count;
  });
}

function projectFileNames(rootDir: string): string[] {
  const configFile = path.join(rootDir, 'tsconfig.json');
  if (!fs.existsSync(configFile)) {
    throw new Error(`Could not find tsconfig.json at ${configFile}`);
  }

  const { config, error } = ts.readConfigFile(configFile, ts.sys.readFile);
  if (error || !config) {
    const message = error
      ? ts.flattenDiagnosticMessageText(error.messageText, ts.sys.newLine)
      : 'empty config';
    throw new Error(`Error parsing TypeScript config file: ${configFile}\n${message}`);
  }

  const { fileNames, errors } = ts.parseJsonConfigFileContent(config, ts.sys, rootDir);
  if (errors.length > 0) {
    const errorMessage = ts.formatDiagnostics(errors, {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => rootDir,
      getNewLine: () => ts.sys.newLine,
    });
    throw new Error(`Errors parsing TypeScript config file content: ${configFile}\n${errorMessage}`);
  }

  return fileNames;
}

function isDeclarationFile(fileName: string): boolean {
  return /\.d\.[cm]?ts$/.test(fileName);
}

/**
 * Global aliases for any, discovered from the .d.ts files the tsconfig
 * includes rather than hardcoded: any type alias declared as `any` or as a
 * function type returning `any` counts (covers the generated
 * ts-migrate-aliases.d.ts and pre-existing project declarations alike).
 */
function discoverAliasNames(declarationFiles: string[]): string[] {
  const names = new Set<string>();
  declarationFiles.forEach((fileName) => {
    let text: string;
    try {
      text = fs.readFileSync(fileName, 'utf-8');
    } catch {
      return;
    }
    const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest);
    const visit = (node: ts.Node): void => {
      if (ts.isTypeAliasDeclaration(node)) {
        const aliased = node.type;
        if (
          aliased.kind === ts.SyntaxKind.AnyKeyword ||
          (ts.isFunctionTypeNode(aliased) && aliased.type.kind === ts.SyntaxKind.AnyKeyword)
        ) {
          names.add(node.name.text);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  });
  return [...names].sort();
}

/**
 * The comment range containing pos, or undefined if pos is not inside a
 * comment (string contents, JSX text). Same trivia walk as the ts-ignore
 * plugin: descend the full token tree, then check the covering token's
 * comment ranges.
 */
function coveringCommentRange(
  sourceFile: ts.SourceFile,
  pos: number,
): ts.CommentRange | undefined {
  let token: ts.Node = sourceFile;
  let child: ts.Node | undefined;
  do {
    child = token
      .getChildren(sourceFile)
      .find((candidate) => candidate.pos <= pos && pos < candidate.end);
    if (child) token = child;
  } while (child);

  // pos must be in the token's leading trivia to be a comment.
  if (pos >= token.getStart(sourceFile)) return undefined;
  const commentRanges = [
    ...(ts.getLeadingCommentRanges(sourceFile.text, token.pos) ?? []),
    ...(ts.getTrailingCommentRanges(sourceFile.text, token.pos) ?? []),
  ];
  return commentRanges.find((range) => range.pos <= pos && pos < range.end);
}

export function scanFileDebt(
  fileName: string,
  text: string,
  aliasNames: ReadonlySet<string>,
): FileDebt {
  const debt = emptyDebt();
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest);

  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      debt.any += 1;
    } else if (
      ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      aliasNames.has(node.typeName.text)
    ) {
      debt.anyAlias += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  // Regex candidates verified against the AST so directives inside strings,
  // template literals, and JSX text are not counted.
  const directiveRegExp = /@ts-(ignore|expect-error)\b(?:[ \t]*TS\((\d+)\))?/g;
  const countedComments = new Set<number>();
  let match: RegExpExecArray | null;
  while ((match = directiveRegExp.exec(text)) != null) {
    const commentRange = coveringCommentRange(sourceFile, match.index);
    if (commentRange && !countedComments.has(commentRange.pos)) {
      countedComments.add(commentRange.pos);
      if (match[1] === 'expect-error') {
        debt.tsExpectError += 1;
      } else {
        debt.tsIgnore += 1;
      }
      if (match[2]) {
        const code = `TS${match[2]}`;
        debt.codes[code] = (debt.codes[code] ?? 0) + 1;
      }
    }
  }

  return debt;
}

function collectDebt(rootDir: string, sourceFiles: string[], aliasNames: string[]): TypeDebtReport {
  const aliasNameSet = new Set(aliasNames);

  const totals = emptyDebt();
  const scanned: Array<{ file: string; debt: FileDebt }> = [];
  sourceFiles.forEach((fileName) => {
    let text: string;
    try {
      text = fs.readFileSync(fileName, 'utf-8');
    } catch {
      return;
    }
    const debt = scanFileDebt(fileName, text, aliasNameSet);
    addDebt(totals, debt);
    if (debtTotal(debt) > 0) {
      scanned.push({ file: path.relative(rootDir, fileName).split(path.sep).join('/'), debt });
    }
  });

  scanned.sort(
    (a, b) => debtTotal(b.debt) - debtTotal(a.debt) || (a.file < b.file ? -1 : 1),
  );
  const files: Record<string, FileDebt> = {};
  scanned.forEach(({ file, debt }) => {
    files[file] = debt;
  });

  return { rootDir, filesScanned: sourceFiles.length, aliasNames, totals, files };
}

function isCountableSourceFile(fileName: string): boolean {
  return !isDeclarationFile(fileName) && /\.[cm]?[jt]sx?$/.test(fileName);
}

/**
 * Scans the files of the tsconfig in rootDir for suppression comments and
 * any-type annotations. Single-file ASTs only; no type-checker program is
 * created. Declaration files are used to discover alias names but are not
 * counted. Throws if the tsconfig is missing or invalid.
 */
export function scanTypeDebt(rootDir: string): TypeDebtReport {
  const fileNames = projectFileNames(rootDir);
  const aliasNames = discoverAliasNames(fileNames.filter(isDeclarationFile));
  return collectDebt(rootDir, fileNames.filter(isCountableSourceFile), aliasNames);
}

/**
 * The same scan restricted to the given files (absolute paths). Alias names
 * are still discovered from the tsconfig's declaration files so the counts
 * match scanTypeDebt for the same files. Used for run-scoped summaries of
 * the files a migration changed.
 */
export function scanTypeDebtForFiles(rootDir: string, files: string[]): TypeDebtReport {
  const fileNames = projectFileNames(rootDir);
  const aliasNames = discoverAliasNames(fileNames.filter(isDeclarationFile));
  return collectDebt(rootDir, files.filter(isCountableSourceFile), aliasNames);
}

/** The per-file listing shows only the worst offenders; --json has them all. */
const MAX_REPORT_FILES = 10;

function formatCodes(debt: FileDebt): string {
  const coded = Object.values(debt.codes).reduce((sum, count) => sum + count, 0);
  const uncoded = debt.tsExpectError + debt.tsIgnore - coded;
  const parts = Object.entries(debt.codes)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([code, count]) => `${code} x${count}`);
  if (uncoded > 0) parts.push(`uncoded x${uncoded}`);
  return parts.join(', ');
}

export function formatTypeDebtReport(report: TypeDebtReport, folder: string): string {
  const { totals, aliasNames } = report;
  const lines = [`Type debt report for ${folder} (${report.filesScanned} files scanned)`, ''];

  if (debtTotal(totals) === 0) {
    lines.push('  No suppression comments or any-type annotations found.');
    return lines.join('\n');
  }

  const aliasLabel = aliasNames.length > 0 ? ` (${aliasNames.join(', ')})` : '';
  lines.push(`  @ts-expect-error comments: ${totals.tsExpectError}`);
  lines.push(`  @ts-ignore comments: ${totals.tsIgnore}`);
  lines.push(`  any-alias annotations${aliasLabel}: ${totals.anyAlias}`);
  lines.push(`  explicit any annotations: ${totals.any}`);
  if (totals.tsExpectError + totals.tsIgnore > 0) {
    lines.push(`  Suppressed error codes: ${formatCodes(totals)}`);
  }

  lines.push('', 'Per-file counts, worst first (zero-debt files omitted):');
  const entries = Object.entries(report.files);
  entries.slice(0, MAX_REPORT_FILES).forEach(([file, debt]) => {
    const parts = [
      debt.tsExpectError > 0 ? `${debt.tsExpectError} @ts-expect-error` : '',
      debt.tsIgnore > 0 ? `${debt.tsIgnore} @ts-ignore` : '',
      debt.anyAlias > 0 ? `${debt.anyAlias} any-alias` : '',
      debt.any > 0 ? `${debt.any} any` : '',
    ].filter(Boolean);
    lines.push(`  ${String(debtTotal(debt)).padStart(5)}  ${file} (${parts.join(', ')})`);
  });
  const remaining = entries.length - MAX_REPORT_FILES;
  if (remaining > 0) {
    lines.push(
      `  ...and ${remaining} more ${remaining === 1 ? 'file' : 'files'} with debt. ` +
        `Re-run with --json for the complete per-file list.`,
    );
  }

  return lines.join('\n');
}

export function formatTypeDebtSummary(report: TypeDebtReport, folder: string): string {
  const { totals } = report;
  if (debtTotal(totals) === 0) {
    return `Type debt: none (${report.filesScanned} files scanned).`;
  }
  const suppressions = totals.tsExpectError + totals.tsIgnore;
  return (
    `Type debt: ${suppressions} suppression comments ` +
    `(${totals.tsExpectError} @ts-expect-error, ${totals.tsIgnore} @ts-ignore), ` +
    `${totals.anyAlias} any-alias annotations, and ${totals.any} explicit any ` +
    `in ${Object.keys(report.files).length} of ${report.filesScanned} files. ` +
    `Run \`npx -p @obiemunoz/ts-migrate ts-migrate report ${folder}\` for per-file counts.`
  );
}
