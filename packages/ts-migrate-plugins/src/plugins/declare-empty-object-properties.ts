import ts from 'typescript';
import { fileNoticeReporter, Plugin } from '@obiemunoz/ts-migrate-server';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';
import { AnyAliasOptions, validateAnyAliasOptions } from '../utils/validateOptions';
import { getOrCreate } from '../utils/maps';
import {
  createChangeValidator,
  getValidationOptions,
  TextChange,
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

type Options = AnyAliasOptions;

// Validation programs one file may build before the declarations still
// unproven are left alone.
const maxValidationPrograms = 24;

/** An empty object literal declaration and the annotation proposed for it. */
interface Candidate {
  index: number;
  properties: Property[];
}

/** A declaration the annotation can go on. */
type Target = ts.VariableDeclaration | ts.PropertyDeclaration;

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
 * The property list itself is derived in ./utils/empty-object-properties.
 *
 * The annotation is then re-checked against the file, and a declaration whose
 * annotation introduces an error the file did not already have is left for
 * add-conversions as before. What is re-checked spells the alias `any`: the
 * alias is declared elsewhere in the project, so a single-file check would
 * reject every annotation that used it by name.
 *
 * declare-missing-class-properties runs earlier in the pipeline and covers the
 * properties a class assigns but never declares, including the ones a
 * constructor assigns the empty object literal to, which it declares from the
 * same property list. The two cannot propose a type for the same property: it
 * skips the names the class already declares, so a `foo = {}` is invisible to
 * it, and what it adds carries no initializer, so neither the bare declaration
 * it leaves where the checker can type one nor the annotated ones it writes
 * otherwise is a candidate here.
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
    getOrCreate(map, symbol, (): T[] => []).push(value);
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
      enclosingDeclaration: declaration,
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
  const { check } = createChangeValidator(
    fileName,
    text,
    compilerOptions,
    projectProgram,
    maxValidationPrograms,
  );

  const isClean = (group: Candidate[]): boolean => {
    const checked = check(() => changesOf(group, 'any'));
    return checked !== undefined && checked.newErrors.length === 0;
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
    text: `: ${printProperties(candidate.properties, anyType)}`,
  }));
}
