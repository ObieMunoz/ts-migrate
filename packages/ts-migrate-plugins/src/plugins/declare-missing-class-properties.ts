import ts from 'typescript';
import { fileNoticeReporter, Plugin } from '@obiemunoz/ts-migrate-server';
import { isDiagnosticWithLinePosition } from '../utils/type-guards';
import { isStatic } from './utils/modifiers';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';
import { AnyAliasOptions, validateAnyAliasOptions } from '../utils/validateOptions';
import { getOrCreate } from '../utils/maps';
import {
  applyTextChanges,
  createFileLanguageService,
  findNewErrors,
  getValidationOptions,
  TextChange,
  toOriginalPos,
} from '../utils/candidateValidation';
import {
  asWrite,
  blamableDiagnosticCodes,
  declareProperties,
  isBlamed,
  isEmptyObject,
  printProperties,
  Property,
  Write,
} from './utils/empty-object-properties';
import { findNodeAtSpan } from './utils/token-pos';

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
  /** Set where the constructor assigns the empty object literal. */
  properties?: Property[];
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
 * A property the constructor assigns the empty object literal to is proposed
 * as the list of the keys written on it instead, `cache: { total?: number }`,
 * which is derived in ./utils/empty-object-properties and gates itself on the
 * same evidence declare-empty-object-properties uses. The checker infers `{}`
 * for that assignment, so a bare declaration makes every key write report and
 * the property would otherwise reach the alias. Nothing later annotates it:
 * declare-empty-object-properties only reads declarations whose initializer is
 * the literal, and this plugin writes no initializer.
 *
 * Whatever is not kept takes the any alias, and so does everything with no
 * property list when `noImplicitAny` is off, where a bare declaration would be
 * an implicit any nothing reports and nothing later annotates.
 */
const declareMissingClassPropertiesPlugin: Plugin<Options> = {
  name: 'declare-missing-class-properties',

  run(params) {
    const { fileName, sourceFile, getLanguageService, options } = params;
    const languageService = getLanguageService();
    const semanticDiagnostics = languageService.getSemanticDiagnostics(fileName);
    const diagnostics = semanticDiagnostics
      .filter(isDiagnosticWithLinePosition)
      .filter((diagnostic) => diagnostic.code === 2339 || diagnostic.code === 2551);

    let candidates = collectCandidates(sourceFile, diagnostics);
    if (candidates.length === 0) {
      return sourceFile.text;
    }

    const anyType = options.anyAlias ?? 'any';
    let proven = new Set<Candidate>();
    try {
      const program = languageService.getProgram();
      const source = program && program.getSourceFile(fileName);
      if (program && source && source.text === sourceFile.text) {
        candidates = withPropertyLists(
          source,
          program.getTypeChecker(),
          semanticDiagnostics,
          candidates,
        );
        proven = new Set(provenCandidates(program, sourceFile, fileName, candidates));
      }
    } catch (e) {
      fileNoticeReporter(params, '[declare-missing-class-properties]')({
        reason: e instanceof Error ? e.message.split('\n')[0].trim() : String(e),
        hint: `The declared properties are typed ${anyType}.`,
      });
      proven = new Set();
    }

    const updates: SourceTextUpdate[] = groupByClass(candidates).map((group) => ({
      kind: 'insert',
      index: group[0].index,
      text: group
        .map(
          (candidate) =>
            `\n${candidate.indent}${declarationOf(candidate, proven.has(candidate), anyType)}`,
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
      getOrCreate(toAdd, classDeclaration, () => new Set<string>()).add(node.text);
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
    getOrCreate(groups, candidate.classDeclaration, (): Candidate[] => []).push(candidate);
  });
  return Array.from(groups.values());
}

/**
 * The declarations that hold up as proposed. Inference from constructor
 * assignments is a `noImplicitAny` feature, and without it nothing reports the
 * declarations the checker cannot type, so none are left bare there; a
 * property list is an annotation of its own and is proposed either way.
 */
function provenCandidates(
  program: ts.Program,
  sourceFile: ts.SourceFile,
  fileName: string,
  candidates: Candidate[],
): Candidate[] {
  const programOptions = program.getCompilerOptions();
  const proposed = (programOptions.noImplicitAny ?? programOptions.strict ?? false)
    ? candidates
    : candidates.filter((candidate) => candidate.properties);
  if (proposed.length === 0) {
    return [];
  }

  return validateCandidates(
    fileName,
    sourceFile,
    getValidationOptions(programOptions),
    proposed,
    program,
  );
}

/** What one declaration is written as, once it is known whether it held up. */
function declarationOf(candidate: Candidate, proven: boolean, anyType: string): string {
  if (!proven) {
    return `${candidate.name}: ${anyType};`;
  }
  if (candidate.properties) {
    return `${candidate.name}: ${printProperties(candidate.properties, anyType)};`;
  }
  return `${candidate.name};`;
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
 * Keeps the declarations that check out as proposed: no error the file did not
 * already have, and, for the bare ones, nothing that resolved to `any`. The
 * full set is checked first, which is one program for the common file; the
 * blamed declarations are then dropped and the remainder proven in one more,
 * and only an unattributable failure falls back to bisection.
 */
function validateCandidates(
  fileName: string,
  sourceFile: ts.SourceFile,
  compilerOptions: ts.CompilerOptions,
  candidates: Candidate[],
  projectProgram: ts.Program,
): Candidate[] {
  const { text } = sourceFile;
  const baseline = createFileLanguageService(fileName, text, compilerOptions, projectProgram);
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
      projectProgram,
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
    // Candidate text spells the alias `any`: the alias is declared in a file a
    // single-file program does not see.
    text: `\n${candidate.indent}${declarationOf(candidate, true, 'any')}`,
  }));
}

/** What the class assigns to one property, and what is written through it. */
interface ThisProperty {
  assigned: ts.Expression[];
  /** Whether the constructor is one of the places it is assigned. */
  constructed: boolean;
  writes: Write[];
}

/**
 * Gives each candidate whose value is an empty object literal the list of the
 * keys written on it. A property assigned anything else, or assigned only
 * outside the constructor, where the checker infers nothing from it, keeps the
 * declaration it would have had.
 */
function withPropertyLists(
  source: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: ts.Diagnostic[],
  candidates: Candidate[],
): Candidate[] {
  const blamable = diagnostics.filter((diagnostic) => blamableDiagnosticCodes.has(diagnostic.code));
  const properties = collectThisProperties(source);
  const printer = ts.createPrinter({ removeComments: true });

  return candidates.map((candidate) => {
    const property = properties.get(propertyKey(candidate.classDeclaration.pos, candidate.name));
    if (
      !property ||
      !property.constructed ||
      !property.assigned.every(isEmptyObject) ||
      !property.writes.some((write) => isBlamed(write, source, blamable))
    ) {
      return candidate;
    }
    const list = declareProperties(property.writes, {
      enclosingDeclaration: candidate.classDeclaration,
      source,
      checker,
      printer,
    });
    return list.length > 0 ? { ...candidate, properties: list } : candidate;
  });
}

function propertyKey(classPos: number, name: string): string {
  return `${classPos}:${name}`;
}

/**
 * Every `this.foo = value` and `this.foo.key = value` in the file, keyed by the
 * class the `this` belongs to and the property name. Candidates are collected
 * from the plugin's source file and these from the program's, so the class is
 * identified by position rather than by node.
 */
function collectThisProperties(source: ts.SourceFile): Map<string, ThisProperty> {
  const properties = new Map<string, ThisProperty>();

  const entryFor = (classDeclaration: ts.ClassLikeDeclaration, name: string): ThisProperty =>
    getOrCreate(properties, propertyKey(classDeclaration.pos, name), () => ({
      assigned: [],
      constructed: false,
      writes: [],
    }));

  const visit = (node: ts.Node): void => {
    const write = asWrite(node);
    if (write) {
      const target = write.access.expression;
      if (target.kind === ts.SyntaxKind.ThisKeyword) {
        const classDeclaration = findEnclosingClass(write.access);
        if (classDeclaration) {
          const property = entryFor(classDeclaration, write.key);
          property.assigned.push(write.value);
          property.constructed ||= isInConstructor(write.access, classDeclaration);
        }
      } else if (
        ts.isPropertyAccessExpression(target) &&
        target.expression.kind === ts.SyntaxKind.ThisKeyword &&
        ts.isIdentifier(target.name)
      ) {
        const classDeclaration = findEnclosingClass(target);
        if (classDeclaration) {
          entryFor(classDeclaration, target.name.text).writes.push(write);
        }
      }
    }
    node.forEachChild(visit);
  };
  source.forEachChild(visit);

  return properties;
}

function isInConstructor(node: ts.Node, classDeclaration: ts.ClassLikeDeclaration): boolean {
  let cur: ts.Node | undefined = node;
  while (cur && cur !== classDeclaration) {
    if (ts.isConstructorDeclaration(cur) && cur.parent === classDeclaration) {
      return true;
    }
    cur = cur.parent;
  }
  return false;
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
