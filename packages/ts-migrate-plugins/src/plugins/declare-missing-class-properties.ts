import ts from 'typescript';
import { fileNoticeReporter, Plugin } from '@obiemunoz/ts-migrate-server';
import { isDiagnosticWithLinePosition } from '../utils/type-guards';
import { isStatic } from './utils/modifiers';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';
import { AnyAliasOptions, validateAnyAliasOptions } from '../utils/validateOptions';
import {
  applyTextChanges,
  createFileLanguageService,
  findNewErrors,
  getValidationOptions,
  TextChange,
  toOriginalPos,
} from '../utils/candidateValidation';

type Options = AnyAliasOptions;

// Validation programs one file may build before the declarations still
// unproven take the alias.
const maxValidationPrograms = 24;

/** A property declaration to add, and where it goes. */
interface Candidate {
  classDeclaration: ts.ClassLikeDeclaration;
  name: string;
  index: number;
  indent: string;
}

/**
 * Declares the properties a class assigns through `this` but never declares.
 *
 * A declaration with no type annotation takes the type the checker infers
 * from the constructor assignments, so that is what is proposed first: the
 * file is re-checked with the bare declarations in place, and each one is
 * kept only where the checker gives it a type of its own. Producing no new
 * error is not enough on its own, since a property assigned from an `any`
 * infers `any` and reports nothing.
 *
 * Whatever is not kept takes the any alias, and so does everything when
 * `noImplicitAny` is off, where a bare declaration would be an implicit any
 * nothing reports and nothing later annotates.
 */
const declareMissingClassPropertiesPlugin: Plugin<Options> = {
  name: 'declare-missing-class-properties',

  run(params) {
    const { fileName, sourceFile, getLanguageService, options } = params;
    const languageService = getLanguageService();
    const diagnostics = languageService
      .getSemanticDiagnostics(fileName)
      .filter(isDiagnosticWithLinePosition)
      .filter((diagnostic) => diagnostic.code === 2339 || diagnostic.code === 2551);

    const candidates = collectCandidates(sourceFile, diagnostics);
    if (candidates.length === 0) {
      return sourceFile.text;
    }

    const anyType = options.anyAlias ?? 'any';
    let inferred = new Set<Candidate>();
    try {
      inferred = new Set(inferrableCandidates(languageService, sourceFile, fileName, candidates));
    } catch (e) {
      fileNoticeReporter(params, '[declare-missing-class-properties]')({
        reason: e instanceof Error ? e.message.split('\n')[0].trim() : String(e),
        hint: `The declared properties are typed ${anyType}.`,
      });
    }

    const updates: SourceTextUpdate[] = groupByClass(candidates).map((group) => ({
      kind: 'insert',
      index: group[0].index,
      text: group
        .map(
          (candidate) =>
            `\n${candidate.indent}${candidate.name}${
              inferred.has(candidate) ? '' : `: ${anyType}`
            };`,
        )
        .join(''),
    }));

    return updateSourceText(sourceFile.text, updates);
  },

  validate: validateAnyAliasOptions,
};

export default declareMissingClassPropertiesPlugin;

function collectCandidates(
  sourceFile: ts.SourceFile,
  diagnostics: ts.DiagnosticWithLocation[],
): Candidate[] {
  const toAdd = new Map<ts.ClassLikeDeclaration, Set<string>>();

  diagnostics.forEach((diagnostic) => {
    const node = findNodeAtSpan(sourceFile, diagnostic);
    if (!node || !ts.isIdentifier(node)) return;
    const access = node.parent;
    if (
      !ts.isPropertyAccessExpression(access) ||
      access.name !== node ||
      access.expression.kind !== ts.SyntaxKind.ThisKeyword
    ) {
      return;
    }

    const classDeclaration = findEnclosingClass(access);
    if (classDeclaration) {
      let propertyNames = toAdd.get(classDeclaration);
      if (!propertyNames) {
        propertyNames = new Set();
        toAdd.set(classDeclaration, propertyNames);
      }
      propertyNames.add(node.text);
    }
  });

  const candidates: Candidate[] = [];
  toAdd.forEach((propertyNameSet, classDeclaration) => {
    const propertyNames = Array.from(propertyNameSet)
      .filter((propertyName) => {
        const existingProperty = classDeclaration.members.find(
          (member) =>
            ts.isPropertyDeclaration(member) &&
            ts.isIdentifier(member.name) &&
            member.name.text === propertyName,
        );
        return existingProperty == null;
      })
      .sort();
    if (propertyNames.length === 0) return;

    // Declarations go after the last static property, so instance properties
    // don't separate the statics from each other.
    let anchor: ts.ClassElement | undefined;
    classDeclaration.members.forEach((member) => {
      if (ts.isPropertyDeclaration(member) && isStatic(member)) {
        anchor = member;
      }
    });

    const index = anchor != null ? anchor.end : getOpenBraceEnd(classDeclaration, sourceFile);
    const indent = getMemberIndentation(classDeclaration, anchor, sourceFile);
    propertyNames.forEach((name) => candidates.push({ classDeclaration, name, index, indent }));
  });

  return sortByIndex(candidates);
}

function groupByClass(candidates: Candidate[]): Candidate[][] {
  const groups = new Map<ts.ClassLikeDeclaration, Candidate[]>();
  candidates.forEach((candidate) => {
    const group = groups.get(candidate.classDeclaration);
    if (group) {
      group.push(candidate);
    } else {
      groups.set(candidate.classDeclaration, [candidate]);
    }
  });
  return Array.from(groups.values());
}

/**
 * The declarations the checker types on its own. Inference from constructor
 * assignments is a `noImplicitAny` feature, and without it nothing reports
 * the declarations the checker cannot type, so none are left bare.
 */
function inferrableCandidates(
  languageService: ts.LanguageService,
  sourceFile: ts.SourceFile,
  fileName: string,
  candidates: Candidate[],
): Candidate[] {
  const program = languageService.getProgram();
  const source = program && program.getSourceFile(fileName);
  if (!program || !source || source.text !== sourceFile.text) {
    return [];
  }
  const programOptions = program.getCompilerOptions();
  if (!(programOptions.noImplicitAny ?? programOptions.strict ?? false)) {
    return [];
  }

  return validateCandidates(fileName, sourceFile, getValidationOptions(programOptions), candidates);
}

/** What one program says about the group it was built for. */
interface CheckResult {
  newErrors: ts.Diagnostic[];
  /** Declarations the checker resolved to `any`. */
  inferredAny: Set<Candidate>;
}

function isProven(result: CheckResult): boolean {
  return result.newErrors.length === 0 && result.inferredAny.size === 0;
}

/**
 * Keeps the bare declarations the checker gives a type of its own: no error
 * the file did not already have, and nothing that resolved to `any`. The full
 * set is checked first, which is one program for the common file; the blamed
 * declarations are then dropped and the remainder proven in one more, and
 * only an unattributable failure falls back to bisection.
 */
function validateCandidates(
  fileName: string,
  sourceFile: ts.SourceFile,
  compilerOptions: ts.CompilerOptions,
  candidates: Candidate[],
): Candidate[] {
  const { text } = sourceFile;
  const baseline = createFileLanguageService(fileName, text, compilerOptions);
  let programsLeft = maxValidationPrograms;

  // A candidate left out of a group stays undeclared, so the accesses that
  // named it keep reporting the error the baseline already has and read as
  // the same any the alias would give them.
  const check = (group: Candidate[]): CheckResult | undefined => {
    if (group.length === 0) return { newErrors: [], inferredAny: new Set() };
    if (programsLeft <= 0) return undefined;
    programsLeft -= 1;
    const changes = changesOf(group);
    const candidate = createFileLanguageService(
      fileName,
      applyTextChanges(text, changes),
      compilerOptions,
    );
    return {
      newErrors: findNewErrors(baseline, candidate, changes, fileName),
      inferredAny: inferredAnyCandidates(candidate, fileName, group, changes),
    };
  };

  const result = check(candidates);
  if (result && isProven(result)) {
    return candidates;
  }

  if (result) {
    const blamed = attributeErrors(result.newErrors, candidates, sourceFile);
    result.inferredAny.forEach((candidate) => blamed.add(candidate));
    if (blamed.size >= candidates.length) {
      return [];
    }
    if (blamed.size > 0) {
      const remainder = candidates.filter((candidate) => !blamed.has(candidate));
      const remainderResult = check(remainder);
      if (remainderResult && isProven(remainderResult)) {
        return remainder;
      }
    }
  }

  // Every branch below keeps the invariant that `fixed` has already been
  // proven, so whatever it returns has been checked as a whole.
  const bisect = (fixed: Candidate[], group: Candidate[]): Candidate[] => {
    if (group.length === 0) return [];
    const groupResult = check(sortByIndex([...fixed, ...group]));
    if (groupResult && isProven(groupResult)) return group;
    if (group.length === 1) return [];
    const mid = Math.floor(group.length / 2);
    const first = bisect(fixed, group.slice(0, mid));
    const second = bisect([...fixed, ...first], group.slice(mid));
    return [...first, ...second];
  };

  if (candidates.length === 1) {
    return [];
  }
  const mid = Math.floor(candidates.length / 2);
  const first = bisect([], candidates.slice(0, mid));
  return [...first, ...bisect(first, candidates.slice(mid))];
}

/**
 * The declarations that came out `any`. A property assigned only from an
 * expression the checker already types `any` infers `any` and reports
 * nothing, so no error proves it wrong; leaving it bare would hide the same
 * any the alias makes visible, and nothing later annotates it.
 */
function inferredAnyCandidates(
  service: ts.LanguageService,
  fileName: string,
  candidates: Candidate[],
  changes: TextChange[],
): Set<Candidate> {
  const inferredAny = new Set<Candidate>();
  const program = service.getProgram();
  const source = program && program.getSourceFile(fileName);
  if (!program || !source) return inferredAny;

  const checker = program.getTypeChecker();
  const spans = insertedSpans(changes);
  candidates.forEach((candidate, i) => {
    const declaration = propertyDeclarationIn(source, spans[i]);
    if (!declaration) return;
    const symbol = checker.getSymbolAtLocation(declaration.name);
    if (!symbol) return;
    const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
    if ((type.flags & ts.TypeFlags.Any) !== 0) {
      inferredAny.add(candidate);
    }
  });
  return inferredAny;
}

function propertyDeclarationIn(
  source: ts.SourceFile,
  span: { start: number; end: number },
): ts.PropertyDeclaration | undefined {
  let result: ts.PropertyDeclaration | undefined;
  const visit = (node: ts.Node): void => {
    if (node.end <= span.start || node.getStart(source) >= span.end) return;
    if (
      ts.isPropertyDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.getStart(source) >= span.start &&
      node.end <= span.end
    ) {
      result = node;
    }
    node.forEachChild(visit);
  };
  source.forEachChild(visit);
  return result;
}

function sortByIndex(candidates: Candidate[]): Candidate[] {
  return [...candidates].sort((a, b) => a.index - b.index);
}

function changesOf(candidates: Candidate[]): TextChange[] {
  return candidates.map((candidate) => ({
    start: candidate.index,
    length: 0,
    text: `\n${candidate.indent}${candidate.name};`,
  }));
}

/** Where each change's text lands in the candidate file. */
function insertedSpans(changes: TextChange[]): { start: number; end: number }[] {
  let shift = 0;
  return changes.map((change) => {
    const start = change.start + shift;
    shift += change.text.length - change.length;
    return { start, end: start + change.text.length };
  });
}

/**
 * Blames each error on the declarations that could have caused it: the one it
 * is reported on, or, for an error an inferred type pushed into the class
 * body, every declaration the statement reads through `this`.
 */
function attributeErrors(
  errors: ts.Diagnostic[],
  candidates: Candidate[],
  sourceFile: ts.SourceFile,
): Set<Candidate> {
  const changes = changesOf(candidates);
  const spans = insertedSpans(changes);
  const blamed = new Set<Candidate>();

  errors.forEach((error) => {
    const { start } = error;
    if (start == null) return;

    const declaration = spans.findIndex((span) => span.start <= start && start < span.end);
    if (declaration !== -1) {
      blamed.add(candidates[declaration]);
      return;
    }

    const statement = enclosingStatement(sourceFile, toOriginalPos(start, changes));
    if (!statement) return;
    thisAccesses(statement).forEach((access) => {
      const classDeclaration = findEnclosingClass(access);
      candidates.forEach((candidate) => {
        if (
          candidate.name === access.name.text &&
          candidate.classDeclaration === classDeclaration
        ) {
          blamed.add(candidate);
        }
      });
    });
  });

  return blamed;
}

function enclosingStatement(sourceFile: ts.SourceFile, position: number): ts.Node | undefined {
  let result: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (position < node.getStart(sourceFile) || position >= node.end) return;
    if (ts.isStatement(node)) result = node;
    node.forEachChild(visit);
  };
  sourceFile.forEachChild(visit);
  return result;
}

function thisAccesses(node: ts.Node): ts.PropertyAccessExpression[] {
  const accesses: ts.PropertyAccessExpression[] = [];
  const visit = (child: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(child) &&
      child.expression.kind === ts.SyntaxKind.ThisKeyword &&
      ts.isIdentifier(child.name)
    ) {
      accesses.push(child);
    }
    child.forEachChild(visit);
  };
  visit(node);
  return accesses;
}

/** The innermost node whose span matches the diagnostic exactly. */
function findNodeAtSpan(
  sourceFile: ts.SourceFile,
  diagnostic: ts.DiagnosticWithLocation,
): ts.Node | undefined {
  const end = diagnostic.start + diagnostic.length;
  let result: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (node.getStart(sourceFile) > diagnostic.start || node.end < end) return;
    if (node.getStart(sourceFile) === diagnostic.start && node.end === end) {
      result = node;
    }
    node.forEachChild(visit);
  };
  visit(sourceFile);
  return result;
}

function findEnclosingClass(node: ts.Node): ts.ClassLikeDeclaration | undefined {
  let cur: ts.Node | undefined = node;
  while (cur && !ts.isSourceFile(cur)) {
    if (ts.isClassLike(cur)) {
      return cur;
    }

    // These rebind `this`, so the member expression does not refer to the
    // enclosing class instance.
    if (ts.isFunctionDeclaration(cur) || ts.isFunctionExpression(cur)) {
      return undefined;
    }
    if (
      (ts.isMethodDeclaration(cur) || ts.isAccessor(cur)) &&
      ts.isObjectLiteralExpression(cur.parent)
    ) {
      return undefined;
    }

    cur = cur.parent;
  }

  return undefined;
}

function getOpenBraceEnd(
  classDeclaration: ts.ClassLikeDeclaration,
  sourceFile: ts.SourceFile,
): number {
  const openBrace = classDeclaration
    .getChildren(sourceFile)
    .find((child) => child.kind === ts.SyntaxKind.OpenBraceToken);
  return openBrace != null ? openBrace.end : classDeclaration.members.pos;
}

function getMemberIndentation(
  classDeclaration: ts.ClassLikeDeclaration,
  anchor: ts.ClassElement | undefined,
  sourceFile: ts.SourceFile,
): string {
  const reference = anchor ?? classDeclaration.members[0];
  if (reference != null) {
    return getLineIndentation(reference, sourceFile);
  }
  return `${getLineIndentation(classDeclaration, sourceFile)}  `;
}

function getLineIndentation(node: ts.Node, sourceFile: ts.SourceFile): string {
  const start = node.getStart(sourceFile);
  const { line } = sourceFile.getLineAndCharacterOfPosition(start);
  const lineStart = sourceFile.getPositionOfLineAndCharacter(line, 0);
  const match = /^[ \t]*/.exec(sourceFile.text.slice(lineStart, start));
  return match ? match[0] : '';
}
