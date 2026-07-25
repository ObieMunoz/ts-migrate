import ts from 'typescript';
import { fileNoticeReporter, Plugin } from '@obiemunoz/ts-migrate-server';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';
import { AnyAliasOptions, validateAnyAliasOptions } from '../utils/validateOptions';
import {
  applyTextChanges,
  createFileLanguageService,
  findNewErrors,
  getValidationOptions,
  TextChange,
} from '../utils/candidateValidation';

type Options = AnyAliasOptions;

// Validation programs one file may build before the declarations still
// unproven are left alone.
const maxValidationPrograms = 24;

// What a write to an unannotated `= {}` reports. TS2339 spans the property
// name, TS7053 the whole element access.
const blamableDiagnosticCodes = new Set([
  // TS2339: Property '{0}' does not exist on type '{1}'.
  2339,
  // TS7053: Element implicitly has an 'any' type because expression of type
  // '{0}' can't be used to index type '{1}'.
  7053,
]);

// How deep a type is walked looking for the spellings that mean "no evidence".
const maxTypeDepth = 4;

const identifierNameRegex = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** One property to declare, name and type already printed. */
interface Property {
  name: string;
  /** Absent where the assigned values gave no evidence and the alias is used. */
  type?: string;
}

/** An empty object literal declaration and the annotation proposed for it. */
interface Candidate {
  index: number;
  properties: Property[];
}

/** A declaration the annotation can go on. */
type Target = ts.VariableDeclaration | ts.PropertyDeclaration;

/** A `name.key = value` or `name['key'] = value` assignment. */
interface Write {
  key: string;
  access: ts.PropertyAccessExpression | ts.ElementAccessExpression;
  value: ts.Expression;
}

/**
 * Types the accumulator idiom `const cache = {}; cache.total = 1;` from the
 * values assigned to it, so one annotation replaces the cast add-conversions
 * would otherwise write at every access site.
 *
 * The same idiom on a class property, `foo = {}` written through `this.foo.x`,
 * and on a `let` whose value arrives later, `let cache; cache = {};`, are the
 * same declaration with the empty object literal somewhere else. All three take
 * the annotation after the declared name. Writes are matched to a declaration
 * by symbol, so a class property is reached through `this`, through an
 * instance, or through the class for a static, without each spelling needing
 * its own rule.
 *
 * Properties are declared optional: required ones would not match the empty
 * initializer, and optional reads the same whether or not strictNullChecks is
 * on. Each property takes the widened checker type of the values assigned to
 * it, except where that type is `any` or one of the spellings the checker
 * uses when it found nothing (`never[]`, `{}`, `null`), which take the any
 * alias instead of a type nothing supports.
 *
 * The annotation is then re-checked against the file, and a declaration whose
 * annotation introduces an error the file did not already have is left for
 * add-conversions as before. What is re-checked spells the alias `any`: the
 * alias is declared elsewhere in the project, so a single-file check would
 * reject every annotation that used it by name.
 *
 * declare-missing-class-properties runs earlier in the pipeline and covers the
 * properties a class assigns but never declares. The two cannot propose a type
 * for the same property: it skips the names the class already declares, so a
 * `foo = {}` is invisible to it, and what it adds carries no initializer, so
 * neither the bare declaration it leaves where the checker can type one nor the
 * aliased declaration it falls back to is a candidate here.
 *
 * A deferred declaration only reports under `noImplicitAny`. Without it
 * `let cache;` is a plain any, the writes contradict nothing, and with no
 * diagnostic to blame the declaration is left alone.
 */
const declareEmptyObjectPropertiesPlugin: Plugin<Options> = {
  name: 'declare-empty-object-properties',

  run(params) {
    const { fileName, sourceFile, getLanguageService, options } = params;
    const languageService = getLanguageService();
    const program = languageService.getProgram();
    const source = program && program.getSourceFile(fileName);
    if (!program || !source || source.isDeclarationFile || source.text !== sourceFile.text) {
      return sourceFile.text;
    }

    const diagnostics = languageService
      .getSemanticDiagnostics(fileName)
      .filter((diagnostic) => blamableDiagnosticCodes.has(diagnostic.code));
    if (diagnostics.length === 0) {
      return sourceFile.text;
    }

    const candidates = collectCandidates(source, program.getTypeChecker(), diagnostics);
    if (candidates.length === 0) {
      return sourceFile.text;
    }

    let accepted: Candidate[] = [];
    try {
      accepted = validateCandidates(
        fileName,
        source.text,
        getValidationOptions(program.getCompilerOptions()),
        candidates,
        program,
      );
    } catch (e) {
      fileNoticeReporter(params, '[declare-empty-object-properties]')({
        reason: e instanceof Error ? e.message.split('\n')[0].trim() : String(e),
        hint: 'The empty object literals are left as they are.',
      });
      return sourceFile.text;
    }

    const updates: SourceTextUpdate[] = changesOf(accepted, options.anyAlias ?? 'any').map(
      (change) => ({ kind: 'insert', index: change.start, text: change.text }),
    );
    return updateSourceText(sourceFile.text, updates);
  },

  validate: validateAnyAliasOptions,
};

export default declareEmptyObjectPropertiesPlugin;

/**
 * The unannotated `= {}` declarations that are assigned through and reported
 * at least once. Without a diagnostic to blame there is nothing the
 * annotation would fix, and it would only narrow a declaration that was doing
 * no harm.
 */
function collectCandidates(
  source: ts.SourceFile,
  checker: ts.TypeChecker,
  diagnostics: ts.Diagnostic[],
): Candidate[] {
  const declarations: Target[] = [];
  const writes = new Map<ts.Symbol, Write[]>();
  const assignments = new Map<ts.Symbol, ts.Expression[]>();

  const record = <T>(map: Map<ts.Symbol, T[]>, symbol: ts.Symbol, value: T): void => {
    const existing = map.get(symbol);
    if (existing) {
      existing.push(value);
    } else {
      map.set(symbol, [value]);
    }
  };

  const visit = (node: ts.Node): void => {
    if (isEmptyObjectDeclaration(node) || isDeferredDeclaration(node)) {
      declarations.push(node);
    }
    const write = asWrite(node);
    const written = write && checker.getSymbolAtLocation(write.access.expression);
    if (write && written) {
      record(writes, written, write);
    }
    const assignment = asAssignment(node);
    const assigned = assignment && checker.getSymbolAtLocation(assignment.name);
    if (assignment && assigned) {
      record(assignments, assigned, assignment.value);
    }
    node.forEachChild(visit);
  };
  source.forEachChild(visit);

  const printer = ts.createPrinter({ removeComments: true });
  const candidates: Candidate[] = [];
  declarations.forEach((declaration) => {
    const symbol = checker.getSymbolAtLocation(declaration.name);
    if (!symbol) {
      return;
    }
    // A declaration with no initializer is the idiom only where the first
    // value it takes is the empty object literal.
    if (declaration.initializer === undefined && !isEmptyObject(assignments.get(symbol)?.[0])) {
      return;
    }

    const declarationWrites = writes.get(symbol) ?? [];
    if (!declarationWrites.some((write) => isBlamed(write, source, diagnostics))) {
      return;
    }

    const properties = declareProperties(declarationWrites, {
      declaration,
      source,
      checker,
      printer,
    });
    if (properties.length > 0) {
      candidates.push({ index: annotationIndex(declaration), properties });
    }
  });

  return candidates;
}

function isEmptyObject(node: ts.Node | undefined): boolean {
  return node !== undefined && ts.isObjectLiteralExpression(node) && node.properties.length === 0;
}

/** A name a symbol can be looked up from, as opposed to a binding or computed one. */
function isDeclaredName(name: ts.Node): boolean {
  return ts.isIdentifier(name) || ts.isPrivateIdentifier(name);
}

/** `const cache = {}` and the `foo = {}` class property. */
function isEmptyObjectDeclaration(node: ts.Node): node is Target {
  return (
    (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
    isDeclaredName(node.name) &&
    node.type === undefined &&
    isEmptyObject(node.initializer)
  );
}

/** `let cache;`, whose value arrives in a later assignment. */
function isDeferredDeclaration(node: ts.Node): node is ts.VariableDeclaration {
  return (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.type === undefined &&
    node.initializer === undefined &&
    // `for` bindings and catch parameters are variable declarations too, and
    // an assignment to either stands in for no initializer.
    ts.isVariableDeclarationList(node.parent) &&
    ts.isVariableStatement(node.parent.parent)
  );
}

/** Where the annotation goes, past whatever follows the declared name. */
function annotationIndex(declaration: Target): number {
  const token = ts.isPropertyDeclaration(declaration)
    ? (declaration.questionToken ?? declaration.exclamationToken)
    : declaration.exclamationToken;
  return (token ?? declaration.name).end;
}

/**
 * Assignments through a fixed key: the ones a property list can describe. What
 * is written to is left to the checker, so `this.foo.x`, `C.foo.x` and
 * `cache.x` all resolve to whichever declaration owns the symbol.
 */
function asWrite(node: ts.Node): Write | undefined {
  if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) {
    return undefined;
  }
  const { left } = node;
  if (ts.isPropertyAccessExpression(left) && ts.isIdentifier(left.name)) {
    return { key: left.name.text, access: left, value: node.right };
  }
  if (ts.isElementAccessExpression(left) && ts.isStringLiteralLike(left.argumentExpression)) {
    return { key: left.argumentExpression.text, access: left, value: node.right };
  }
  return undefined;
}

/** `cache = value`, the assignment that can carry a deferred declaration's first value. */
function asAssignment(node: ts.Node): { name: ts.Identifier; value: ts.Expression } | undefined {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(node.left)
  ) {
    return { name: node.left, value: node.right };
  }
  return undefined;
}

function isBlamed(write: Write, source: ts.SourceFile, diagnostics: ts.Diagnostic[]): boolean {
  const start = write.access.getStart(source);
  const { end } = write.access;
  return diagnostics.some(
    (diagnostic) =>
      diagnostic.start != null &&
      diagnostic.start < end &&
      diagnostic.start + (diagnostic.length ?? 0) > start,
  );
}

interface PrintContext {
  declaration: Target;
  source: ts.SourceFile;
  checker: ts.TypeChecker;
  printer: ts.Printer;
}

/**
 * One optional property per key, in the order the keys are first assigned,
 * typed as the union of the widened types assigned to it.
 */
function declareProperties(writes: Write[], context: PrintContext): Property[] {
  const byKey = new Map<string, string[]>();
  const aliased = new Set<string>();

  writes.forEach((write) => {
    let types = byKey.get(write.key);
    if (!types) {
      types = [];
      byKey.set(write.key, types);
    }
    const type = printType(write.value, context);
    if (type === undefined) {
      aliased.add(write.key);
    } else if (!types.includes(type)) {
      types.push(type);
    }
  });

  return Array.from(byKey, ([key, types]) => ({
    name: identifierNameRegex.test(key) ? key : JSON.stringify(key),
    ...(aliased.has(key) || types.length === 0 ? undefined : { type: types.join(' | ') }),
  }));
}

/**
 * The assigned value's type as it would be written at the declaration, or
 * undefined where the checker knows nothing worth writing down.
 */
function printType(value: ts.Expression, context: PrintContext): string | undefined {
  const { declaration, source, checker, printer } = context;
  const type = checker.getBaseTypeOfLiteralType(checker.getTypeAtLocation(value));
  if (isNoEvidence(type, checker)) {
    return undefined;
  }
  const typeNode = checker.typeToTypeNode(type, declaration, ts.NodeBuilderFlags.NoTruncation);
  if (!typeNode) {
    return undefined;
  }
  try {
    return printer.printNode(ts.EmitHint.Unspecified, typeNode, source);
  } catch {
    return undefined;
  }
}

/** `null`, `undefined` and `void`: real types that describe no value. */
function isVacuous(type: ts.Type): boolean {
  return (
    (type.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) !== 0
  );
}

/**
 * Whether a type says nothing an annotation could rest on. `any` is
 * assignable in both directions, so no re-check rejects it and it has to be
 * ruled out here; the empty object type and an array with no element type are
 * what the checker prints where it found no evidence at all, and an
 * annotation built from either rejects every value added later.
 */
function isNoEvidence(type: ts.Type, checker: ts.TypeChecker, depth = 0): boolean {
  if ((type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Never)) !== 0 || isVacuous(type)) {
    return true;
  }
  if (depth >= maxTypeDepth) {
    return false;
  }
  if (type.isUnion()) {
    return type.types.every((member) => isNoEvidence(member, checker, depth + 1));
  }
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const elements = checker.getTypeArguments(type as ts.TypeReference);
    return (
      elements.length === 0 || elements.some((element) => isNoEvidence(element, checker, depth + 1))
    );
  }
  return (
    (type.flags & ts.TypeFlags.Object) !== 0 &&
    ((type as ts.ObjectType).objectFlags & ts.ObjectFlags.ObjectLiteral) !== 0 &&
    checker.getPropertiesOfType(type).length === 0
  );
}

/**
 * The declarations the file still checks under once annotated. Every accepted
 * set is checked as a whole, so an annotation that only breaks alongside
 * another one is dropped with it.
 */
function validateCandidates(
  fileName: string,
  text: string,
  compilerOptions: ts.CompilerOptions,
  candidates: Candidate[],
  projectProgram: ts.Program,
): Candidate[] {
  const baseline = createFileLanguageService(fileName, text, compilerOptions, projectProgram);
  let programsLeft = maxValidationPrograms;

  const isClean = (group: Candidate[]): boolean => {
    if (programsLeft <= 0) return false;
    programsLeft -= 1;
    const changes = changesOf(group, 'any');
    const candidate = createFileLanguageService(
      fileName,
      applyTextChanges(text, changes),
      compilerOptions,
      projectProgram,
    );
    return findNewErrors(baseline, candidate, changes, fileName).length === 0;
  };

  if (isClean(candidates)) {
    return candidates;
  }

  const accepted: Candidate[] = [];
  candidates.forEach((candidate) => {
    if (isClean([...accepted, candidate])) {
      accepted.push(candidate);
    }
  });
  return accepted;
}

function changesOf(candidates: Candidate[], anyType: string): TextChange[] {
  return candidates.map((candidate) => ({
    start: candidate.index,
    length: 0,
    text: `: { ${candidate.properties
      .map((property) => `${property.name}?: ${property.type ?? anyType}`)
      .join('; ')} }`,
  }));
}
