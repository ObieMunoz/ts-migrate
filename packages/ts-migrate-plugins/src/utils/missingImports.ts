/**
 * TypeScript's own `fixMissingImport` code fix, as the add-missing-imports
 * plugin asks for it: the import an editor's quick fix menu offers for a name
 * the file uses but never brings in, applied without a person picking from the
 * menu.
 *
 * Two questions the menu answers by being a menu have to be answered here. The
 * first is which module a name comes from when several export it, which is
 * decided by asking for the fixes one diagnostic at a time and comparing where
 * each answer points. The second is whether the fix does anything beyond adding
 * an import, which is decided by reading the edits before they are applied: a
 * binding nothing here vouched for is taken back out rather than written.
 */
import ts from 'typescript';
import { ModuleResolution } from '@obiemunoz/ts-migrate-server';
import updateSourceText, { SourceTextUpdate } from './updateSourceText';

/**
 * The diagnostics TypeScript's `fixMissingImport` registers for, as its own
 * list of them stands, minus TS1361. That one reports a value used from an
 * `import type`, whose repair takes a modifier out of an import the file
 * already has rather than adding one; ts-ignore already makes it, and a second
 * plugin reaching for the same site would only race it.
 */
export const MISSING_IMPORT_CODES: ReadonlySet<number> = new Set([
  2304, 2311, 2503, 2552, 2580, 2581, 2582, 2583, 2584, 2591, 2592, 2593, 2662, 2663, 2686, 2689,
  2693, 2833, 2874, 18004,
]);

/** The name `getCodeFixesAtPosition` gives every action `fixMissingImport` produces. */
const IMPORT_FIX_NAME = 'import';

/** One name an import statement brings into a file. */
export interface ImportBinding {
  /** The name the file goes on to use. */
  local: string;
  /** What it is imported as: an export name, `default`, or `*` for a namespace. */
  exported: string;
}

/** One module TypeScript offered a name from. */
export interface ImportCandidate {
  /** The specifier as the fix would write it. */
  specifier: string;
  /**
   * What the specifier and the binding together resolve to, for telling two
   * candidates apart. Two specifiers that reach one export through different
   * paths (a module and the barrel that re-exports it) share a key and count as
   * one candidate; a specifier nothing resolves is equal only to itself, which
   * keeps a name it was offered for ambiguous rather than picking for it.
   */
  key: string;
}

/** A name the file uses that no declaration in scope provides. */
export interface MissingImport {
  /** The name as the file writes it, which is what a person recognizes it by. */
  name: string;
  /** The modules TypeScript offered, in the order it ranked them. */
  candidates: ImportCandidate[];
}

/** Whether TypeScript offered this name from more than one export. */
export function isAmbiguous({ candidates }: MissingImport): boolean {
  return new Set(candidates.map((candidate) => candidate.key)).size > 1;
}

export interface MissingImportContext {
  languageService: ts.LanguageService;
  fileName: string;
  sourceFile: ts.SourceFile;
  formatSettings: ts.FormatCodeSettings;
  preferences: ts.UserPreferences;
  /** The project's resolution, where the plugin runs inside a migration. */
  moduleResolution?: ModuleResolution;
}

/**
 * The names this file is missing an import for, with the modules TypeScript
 * would take each one from.
 *
 * Asked one diagnostic at a time, which is what makes the alternatives visible:
 * the combined fix that produces the edits picks a module per name and says
 * nothing about the ones it passed over.
 */
export function findMissingImports(context: MissingImportContext): MissingImport[] {
  const { languageService, fileName, sourceFile } = context;
  const byName = new Map<string, MissingImport>();

  languageService
    .getSemanticDiagnostics(fileName)
    .filter((diagnostic) => MISSING_IMPORT_CODES.has(diagnostic.code))
    .forEach((diagnostic) => {
      if (diagnostic.start === undefined || diagnostic.length === undefined) return;
      importActionsAt(context, diagnostic.start, diagnostic.length, diagnostic.code).forEach(
        (action) => {
          const addition = actionAddition(action, sourceFile);
          if (!addition) return;
          addition.bindings.forEach((binding) => {
            const missing = byName.get(binding.local) ?? { name: binding.local, candidates: [] };
            const key = candidateKey(context, addition.specifier, binding);
            // The same name reported at several use sites is offered the same
            // modules each time, and a repeat is not a second candidate.
            if (!missing.candidates.some((candidate) => candidate.key === key)) {
              missing.candidates.push({ specifier: addition.specifier, key });
            }
            byName.set(binding.local, missing);
          });
        },
      );
    });

  return [...byName.values()];
}

function importActionsAt(
  { languageService, fileName }: MissingImportContext,
  start: number,
  length: number,
  code: number,
): readonly ts.CodeFixAction[] {
  try {
    return languageService
      .getCodeFixesAtPosition(fileName, start, start + length, [code], {}, {})
      .filter((action) => action.fixName === IMPORT_FIX_NAME);
  } catch {
    // The service declined this position. The name keeps whatever the rest of
    // the run does with it, which is a suppression comment.
    return [];
  }
}

/** What an edit adds to a file: bindings, and the module they come from. */
interface ImportAddition {
  specifier: string;
  bindings: ImportBinding[];
}

/**
 * What one action would add, or undefined when it would do something this
 * module does not recognize as adding an import: writing to another file,
 * editing text no import declaration covers, or drawing on several modules at
 * once, which no single missing name does.
 */
function actionAddition(
  action: ts.CodeFixAction,
  sourceFile: ts.SourceFile,
): ImportAddition | undefined {
  const changes = action.changes.filter((change) => change.fileName === sourceFile.fileName);
  if (changes.length !== action.changes.length) return undefined;

  const additions: (ImportAddition | undefined)[] = changes
    .flatMap((change) => change.textChanges)
    .map((change) => changeAddition(change, sourceFile));
  if (additions.length === 0) return undefined;

  const specifiers = new Set<string>();
  const bindings: ImportBinding[] = [];
  for (const addition of additions) {
    if (!addition) return undefined;
    specifiers.add(addition.specifier);
    bindings.push(...addition.bindings);
  }
  return specifiers.size === 1 ? { specifier: [...specifiers][0], bindings } : undefined;
}

/**
 * What one text change adds. A change is either whole import statements, which
 * say on their own what they bring in, or a fragment that extends an import the
 * file already has, which only says so once it is read back inside that
 * statement.
 */
function changeAddition(
  change: ts.TextChange,
  sourceFile: ts.SourceFile,
): ImportAddition | undefined {
  const statements = parseImportStatements(change.newText);
  if (statements) {
    const specifiers = new Set(statements.map(specifierOf));
    if (specifiers.size !== 1) return undefined;
    return { specifier: [...specifiers][0], bindings: statements.flatMap(bindingsOf) };
  }

  const extended = extendedImport(sourceFile, change);
  if (!extended) return undefined;
  return { specifier: specifierOf(extended.declaration), bindings: extended.added };
}

/** An import the file already has, as one text change would leave it. */
interface ExtendedImport {
  declaration: ts.ImportDeclaration;
  /** The statement re-parsed with the change in it. */
  statement: ts.ImportDeclaration;
  /** The bindings the change brings in, which the declaration did not have. */
  added: ImportBinding[];
}

function extendedImport(
  sourceFile: ts.SourceFile,
  change: ts.TextChange,
): ExtendedImport | undefined {
  const declaration = enclosingImport(sourceFile, change.span.start);
  if (!declaration) return undefined;

  const start = declaration.getStart(sourceFile);
  const text = sourceFile.text.slice(start, declaration.getEnd());
  const offset = change.span.start - start;
  const spliced = `${text.slice(0, offset)}${change.newText}${text.slice(
    offset + change.span.length,
  )}`;

  const statements = parseImportStatements(spliced);
  if (!statements || statements.length !== 1) return undefined;

  const before = new Set(bindingsOf(declaration).map((binding) => binding.local));
  return {
    declaration,
    statement: statements[0],
    added: bindingsOf(statements[0]).filter((binding) => !before.has(binding.local)),
  };
}

/**
 * The import declarations a generated edit consists of, or undefined when the
 * edit is not import declarations at all. Anything the parser makes something
 * else of is a fragment of a statement rather than a statement.
 */
function parseImportStatements(text: string): ts.ImportDeclaration[] | undefined {
  if (!/\bimport\b/.test(text)) return undefined;
  const parsed = ts.createSourceFile('import.ts', text, ts.ScriptTarget.Latest, true);
  const statements = parsed.statements.filter(ts.isImportDeclaration);
  return statements.length > 0 && statements.length === parsed.statements.length
    ? statements
    : undefined;
}

/** The declaration a position falls inside, for a change that extends one. */
function enclosingImport(sourceFile: ts.SourceFile, pos: number): ts.ImportDeclaration | undefined {
  return sourceFile.statements.find(
    (statement): statement is ts.ImportDeclaration =>
      ts.isImportDeclaration(statement) &&
      statement.getStart(sourceFile) <= pos &&
      pos <= statement.getEnd(),
  );
}

function specifierOf(declaration: ts.ImportDeclaration): string {
  const { moduleSpecifier } = declaration;
  return ts.isStringLiteralLike(moduleSpecifier) ? moduleSpecifier.text : moduleSpecifier.getText();
}

function bindingsOf(declaration: ts.ImportDeclaration): ImportBinding[] {
  const clause = declaration.importClause;
  if (!clause) return [];

  const bindings: ImportBinding[] = [];
  if (clause.name) bindings.push({ local: clause.name.text, exported: 'default' });
  if (clause.namedBindings) {
    if (ts.isNamespaceImport(clause.namedBindings)) {
      bindings.push({ local: clause.namedBindings.name.text, exported: '*' });
    } else {
      clause.namedBindings.elements.forEach((element) =>
        bindings.push({
          local: element.name.text,
          exported: element.propertyName?.text ?? element.name.text,
        }),
      );
    }
  }
  return bindings;
}

/**
 * What a candidate points at, as a value two candidates can be compared by.
 *
 * The specifier alone does not answer that: a module and a barrel that
 * re-exports it are two specifiers for one export, and a name offered from both
 * is not a name with two homes.
 */
function candidateKey(
  context: MissingImportContext,
  specifier: string,
  binding: ImportBinding,
): string {
  const declaration = exportedSymbol(context, specifier, binding)?.declarations?.[0];
  if (!declaration) return `specifier:${specifier}:${binding.exported}`;
  return `declaration:${declaration.getSourceFile().fileName}:${declaration.pos}`;
}

function exportedSymbol(
  context: MissingImportContext,
  specifier: string,
  binding: ImportBinding,
): ts.Symbol | undefined {
  const program = context.languageService.getProgram();
  if (!program) return undefined;

  const resolved = resolveSpecifier(context, program, specifier);
  const target = resolved === undefined ? undefined : program.getSourceFile(resolved);
  if (!target) return undefined;

  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(target);
  if (!moduleSymbol) return undefined;
  if (binding.exported === '*') return moduleSymbol;

  const exported = checker
    .getExportsOfModule(moduleSymbol)
    .find((symbol) => symbol.name === binding.exported);
  if (!exported) return undefined;
  // A re-export is an alias to the declaration the other module holds, which is
  // the thing two candidates have to be compared by.
  if (!(exported.flags & ts.SymbolFlags.Alias)) return exported;
  try {
    return checker.getAliasedSymbol(exported);
  } catch {
    return exported;
  }
}

function resolveSpecifier(
  context: MissingImportContext,
  program: ts.Program,
  specifier: string,
): string | undefined {
  const { moduleResolution, fileName } = context;
  const base: ts.ModuleResolutionHost = moduleResolution?.host ?? {
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
  };
  // Files the run has already edited live in the program rather than on disk,
  // and the module a name comes from is often one of them.
  const host: ts.ModuleResolutionHost = {
    ...base,
    fileExists: (name) => program.getSourceFile(name) !== undefined || base.fileExists(name),
    readFile: (name) => program.getSourceFile(name)?.text ?? base.readFile(name),
  };

  try {
    return ts.resolveModuleName(
      specifier,
      fileName,
      moduleResolution?.compilerOptions ?? program.getCompilerOptions(),
      host,
      moduleResolution?.cache,
    ).resolvedModule?.resolvedFileName;
  } catch {
    return undefined;
  }
}

/**
 * Every import the file is missing, in one edit. TypeScript merges the names it
 * takes from one module into a single statement, and matches the quoting and
 * specifier style of the imports the file already has, neither of which asking
 * per diagnostic and splicing the answers together does.
 */
export function combinedImportChanges({
  languageService,
  fileName,
  formatSettings,
  preferences,
}: MissingImportContext): readonly ts.TextChange[] {
  let changes: readonly ts.FileTextChanges[];
  try {
    changes = languageService.getCombinedCodeFix(
      { type: 'file', fileName },
      'fixMissingImport',
      formatSettings,
      preferences,
    ).changes;
  } catch {
    // Nothing is added rather than some of it: the file keeps the diagnostics it
    // had, which the rest of the run already handles.
    return [];
  }
  return changes
    .filter((change) => change.fileName === fileName)
    .flatMap((change) => change.textChanges);
}

/**
 * The file with those changes applied, minus every binding the caller did not
 * allow.
 *
 * The allowed set is both how the ambiguous names are left out and how the file
 * is held to what this plugin claims to do: a name the combined fix adds that
 * the candidate scan never classified is a name nothing here vouched for, so it
 * comes back out too.
 */
export function applyImportChanges(
  sourceFile: ts.SourceFile,
  changes: readonly ts.TextChange[],
  allowed: ReadonlySet<string>,
): string {
  const updates: SourceTextUpdate[] = [];

  changes.forEach((change) => {
    const statements = parseImportStatements(change.newText);
    const restricted = statements
      ? blockWithout(change, statements, allowed)
      : extensionWithout(sourceFile, change, allowed);
    if (restricted) updates.push(restricted);
  });

  return updateSourceText(sourceFile.text, updates);
}

/**
 * A generated block of import statements as an update, minus the bindings that
 * are not allowed. Undefined when nothing in the block survives, which leaves
 * the file byte for byte as it was rather than keeping the block's blank lines.
 */
function blockWithout(
  change: ts.TextChange,
  statements: ts.ImportDeclaration[],
  allowed: ReadonlySet<string>,
): SourceTextUpdate | undefined {
  if (statements.every((statement) => keepsEveryBinding(statement, allowed))) {
    return changeAsUpdate(change, change.newText);
  }

  const block = statements[0].getSourceFile();
  const updates: SourceTextUpdate[] = [];
  let kept = 0;
  statements.forEach((statement) => {
    const rewritten = withoutBindings(statement, allowed);
    if (rewritten) {
      kept += 1;
      updates.push(...rewritten);
      return;
    }
    // The whole line, so a dropped statement leaves no empty one behind.
    const start = block.text.lastIndexOf('\n', statement.getStart(block) - 1) + 1;
    const lineEnd = block.text.indexOf('\n', statement.getEnd());
    const end = lineEnd === -1 ? block.text.length : lineEnd + 1;
    updates.push({ kind: 'delete', index: start, length: end - start });
  });
  if (kept === 0) return undefined;

  return changeAsUpdate(change, updateSourceText(block.text, updates));
}

/**
 * An edit that extends an import the file already has, minus the bindings that
 * are not allowed. Where some but not all of them go, the declaration is
 * rewritten whole: the edit is a fragment positioned inside it, and a fragment
 * has no structure to take a binding out of.
 */
function extensionWithout(
  sourceFile: ts.SourceFile,
  change: ts.TextChange,
  allowed: ReadonlySet<string>,
): SourceTextUpdate | undefined {
  const extended = extendedImport(sourceFile, change);
  if (!extended) return undefined;

  const { declaration, statement, added } = extended;
  if (added.every((binding) => allowed.has(binding.local))) {
    return changeAsUpdate(change, change.newText);
  }
  if (!added.some((binding) => allowed.has(binding.local))) return undefined;

  // Everything the declaration already imported stays, whether or not this
  // plugin would have added it.
  const keep = new Set(bindingsOf(declaration).map((binding) => binding.local));
  added.forEach((binding) => {
    if (allowed.has(binding.local)) keep.add(binding.local);
  });
  const rewritten = withoutBindings(statement, keep);
  if (!rewritten) return undefined;

  const start = declaration.getStart(sourceFile);
  return {
    kind: 'replace',
    index: start,
    length: declaration.getEnd() - start,
    text: updateSourceText(statement.getSourceFile().text, rewritten),
  };
}

/** Text written where a change asks for it: an empty span is an insertion. */
function changeAsUpdate(change: ts.TextChange, text: string): SourceTextUpdate {
  return change.span.length === 0
    ? { kind: 'insert', index: change.span.start, text }
    : { kind: 'replace', index: change.span.start, length: change.span.length, text };
}

function keepsEveryBinding(statement: ts.ImportDeclaration, allowed: ReadonlySet<string>): boolean {
  return bindingsOf(statement).every((binding) => allowed.has(binding.local));
}

/**
 * The edits that take the disallowed bindings out of one statement, as offsets
 * into the text it was parsed from. Undefined when the statement imports
 * nothing once they are gone, so the caller drops it whole rather than leaving
 * `import {} from '...'`, which is an import for the side effect.
 */
function withoutBindings(
  statement: ts.ImportDeclaration,
  allowed: ReadonlySet<string>,
): SourceTextUpdate[] | undefined {
  const clause = statement.importClause;
  if (!clause) return [];

  const parsed = statement.getSourceFile();
  const named = clause.namedBindings;
  const defaultName = clause.name;
  const dropsDefault = defaultName !== undefined && !allowed.has(defaultName.text);
  const elements = named && ts.isNamedImports(named) ? named.elements : undefined;
  const kept = elements?.filter((element) => allowed.has(element.name.text)) ?? [];
  const dropsNamed =
    named !== undefined &&
    (ts.isNamespaceImport(named) ? !allowed.has(named.name.text) : kept.length === 0);

  if ((defaultName === undefined || dropsDefault) && (named === undefined || dropsNamed)) {
    return undefined;
  }

  const updates: SourceTextUpdate[] = [];
  if (defaultName && dropsDefault) {
    // The comma between the default and what follows goes with the default.
    const start = defaultName.getStart(parsed);
    const end = named ? named.getStart(parsed) : defaultName.getEnd();
    updates.push({ kind: 'delete', index: start, length: end - start });
  }
  if (named && dropsNamed) {
    const start = defaultName && !dropsDefault ? defaultName.getEnd() : named.getStart(parsed);
    updates.push({ kind: 'delete', index: start, length: named.getEnd() - start });
  } else if (elements && kept.length < elements.length) {
    // Rewritten as a list rather than element by element, so the commas between
    // the survivors are the ones this writes rather than the ones left over.
    const open = elements[0].getStart(parsed);
    const close = elements[elements.length - 1].getEnd();
    updates.push({
      kind: 'replace',
      index: open,
      length: close - open,
      text: kept.map((element) => element.getText(parsed)).join(', '),
    });
  }
  return updates;
}
