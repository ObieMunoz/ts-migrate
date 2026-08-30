import ts from 'typescript';
import { fileNoticeReporter, Plugin } from '@obiemunoz/ts-migrate-server';
import { AnyAliasOptions, validateAnyAliasOptions } from '../utils/validateOptions';
import {
  applyTextChanges,
  createChangeValidator,
  getValidationOptions,
  TextChange,
} from '../utils/candidateValidation';
import { elementTypesByTag } from './utils/intrinsic-elements';
import { intrinsicTagOfJsxAttribute } from './utils/jsx-tag-names';

type Options = AnyAliasOptions;

// Validation programs one file may build before the candidates still unproven
// take the alias.
const maxValidationPrograms = 16;

// A type argument longer than this is unreadable inline, and a structural type
// that big is rarely what the state is meant to hold.
const maxTypeTextLength = 200;

/**
 * The initializers whose inferred type carries no information: `null` and
 * `undefined` type as themselves, `[]` as `never[]`, `{}` as `{}`, and a
 * `createContext` call with no argument at all, which is an arity error. Every
 * other initializer, including `0` and `''`, infers the type the call should
 * have.
 */
type EmptyInitializer = 'null' | 'undefined' | 'array' | 'object' | 'absent';

interface HookCall {
  hook: 'useState' | 'useRef' | 'createContext';
  call: ts.CallExpression;
  declaration: ts.VariableDeclaration;
  initializer: EmptyInitializer;
  /** Every reference to the value the call is bound to. */
  valueReferences: ts.Identifier[];
  /** Every reference to the setter, for a destructured `useState`. */
  setterReferences: ts.Identifier[];
}

interface Candidate {
  /** Where the type argument list goes: between the callee and its arguments. */
  index: number;
  /** Where the default value goes, for a `createContext` call missing one. */
  defaultValueIndex?: number;
  /** The type text same-file evidence supports, when there is any. */
  evidence?: string;
}

/**
 * Writes the type argument a React hook call needs when its initializer gives
 * the checker nothing to infer from: `useState(null)`, `useState(undefined)`,
 * `useState([])`, `useState({})`, `useRef(null)`, and `createContext` called
 * with `null`, with `undefined`, or with no argument at all.
 *
 * Only calls an error already blames are touched, so a hook whose inferred
 * type is doing no harm is left as it is.
 *
 * Evidence is same-file and specific to the hook. `useState` reads the
 * arguments its setter is called with; a setter that leaves the file, or an
 * argument the checker types `any`, is no evidence, because `any` is
 * assignable in both directions and would make the check below pass on a type
 * the compiler knows nothing about. `useRef` reads the intrinsic tag its ref
 * is attached to, which names the element interface outright. `createContext`
 * reads the `value` prop of the Providers in the same file, which is the only
 * place the context is given a value this file can see; a context whose
 * Providers are all elsewhere has no evidence here.
 *
 * The type a `createContext` call takes has to admit the default value the
 * call keeps, so it is always a union with `null` or `undefined`, and a call
 * written with no argument has `undefined` written in, which is the value it
 * already has at runtime and what the required parameter is missing.
 *
 * A proposed type argument is written only when re-checking the file with it
 * in place reports no error the file did not already have, which is what
 * rejects a type that is not in scope or not what the state really holds.
 * Everything else takes the any alias: one visible `any` in place of the
 * suppressions the useless inference would otherwise earn.
 */
const reactHookTypesPlugin: Plugin<Options> = {
  name: 'react-hook-types',

  run(params) {
    const { fileName, sourceFile, options } = params;
    const languageService = params.getLanguageService();
    const program = languageService.getProgram();
    const source = program && program.getSourceFile(fileName);
    if (!program || !source || source.text !== sourceFile.text) {
      return sourceFile.text;
    }

    const errors = languageService
      .getSemanticDiagnostics(fileName)
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
    const candidates = collectCandidates(source, program.getTypeChecker(), errors);
    if (candidates.length === 0) {
      return sourceFile.text;
    }

    const anyType = options.anyAlias ?? 'any';
    let proven = new Set<Candidate>();
    try {
      proven = provenCandidates(
        fileName,
        source,
        getValidationOptions(program.getCompilerOptions()),
        candidates,
        program,
      );
    } catch (e) {
      fileNoticeReporter(params, '[react-hook-types]')({
        reason: e instanceof Error ? e.message.split('\n')[0].trim() : String(e),
        hint: `The hook calls take a ${anyType} type argument.`,
      });
    }

    const changes = candidates.flatMap((candidate) =>
      changesFor(candidate, proven.has(candidate) ? candidate.evidence : anyType),
    );

    return applyTextChanges(sourceFile.text, changes);
  },

  validate: validateAnyAliasOptions,
};

export default reactHookTypesPlugin;

function collectCandidates(
  source: ts.SourceFile,
  checker: ts.TypeChecker,
  errors: ts.Diagnostic[],
): Candidate[] {
  return collectHookCalls(source, checker)
    .filter((hookCall) => isBlamedByAnError(hookCall, errors, source))
    .map((hookCall) => ({
      index: hookCall.call.expression.end,
      defaultValueIndex:
        hookCall.initializer === 'absent' ? hookCall.call.arguments.end : undefined,
      evidence: evidenceFor(hookCall, checker, source),
    }));
}

/** The type argument a candidate takes, plus the default value it may need. */
function changesFor(candidate: Candidate, typeText: string | undefined): TextChange[] {
  const changes: TextChange[] = [{ start: candidate.index, length: 0, text: `<${typeText}>` }];
  if (candidate.defaultValueIndex !== undefined) {
    changes.push({ start: candidate.defaultValueIndex, length: 0, text: 'undefined' });
  }
  return changes;
}

/** The hook calls in scope, with every reference to what they are bound to. */
function collectHookCalls(source: ts.SourceFile, checker: ts.TypeChecker): HookCall[] {
  const hookCalls: HookCall[] = [];
  const byBinding = new Map<ts.Symbol, { hookCall: HookCall; isSetter: boolean }>();
  const boundNames = new Set<ts.Identifier>();

  const bind = (name: ts.BindingName, hookCall: HookCall, isSetter: boolean) => {
    if (!ts.isIdentifier(name)) return;
    const symbol = checker.getSymbolAtLocation(name);
    if (!symbol) return;
    byBinding.set(symbol, { hookCall, isSetter });
    boundNames.add(name);
  };

  const visitCalls = (node: ts.Node): void => {
    const hookCall = toHookCall(node);
    if (hookCall) {
      const { name } = hookCall.declaration;
      if (ts.isArrayBindingPattern(name)) {
        const [value, setter] = name.elements;
        if (value != null && ts.isBindingElement(value)) bind(value.name, hookCall, false);
        if (setter != null && ts.isBindingElement(setter)) bind(setter.name, hookCall, true);
      } else {
        bind(name, hookCall, false);
      }
      hookCalls.push(hookCall);
    }
    node.forEachChild(visitCalls);
  };
  source.forEachChild(visitCalls);

  if (byBinding.size === 0) {
    return [];
  }

  const visitReferences = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && !boundNames.has(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const binding = symbol && byBinding.get(symbol);
      if (binding) {
        const { hookCall, isSetter } = binding;
        (isSetter ? hookCall.setterReferences : hookCall.valueReferences).push(node);
      }
    }
    node.forEachChild(visitReferences);
  };
  source.forEachChild(visitReferences);

  return hookCalls;
}

/** A hook call with no type argument whose initializer infers nothing useful. */
function toHookCall(node: ts.Node): HookCall | undefined {
  if (!ts.isCallExpression(node) || node.typeArguments != null) {
    return undefined;
  }
  const hook = hookNameOf(node);
  if (hook === undefined) return undefined;

  const initializer = emptyArgumentOf(hook, node.arguments);
  if (initializer === undefined) return undefined;

  const declaration = node.parent;
  if (!ts.isVariableDeclaration(declaration) || declaration.initializer !== node) {
    return undefined;
  }
  const bindsSetter = ts.isArrayBindingPattern(declaration.name);
  if (hook === 'useState' ? !bindsSetter : !ts.isIdentifier(declaration.name)) {
    return undefined;
  }

  return { hook, call: node, declaration, initializer, valueReferences: [], setterReferences: [] };
}

function hookNameOf(call: ts.CallExpression): HookCall['hook'] | undefined {
  const { expression } = call;
  let name: string | undefined;
  if (ts.isIdentifier(expression)) {
    name = expression.text;
  } else if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.name)) {
    name = expression.name.text;
  }
  return name === 'useState' || name === 'useRef' || name === 'createContext' ? name : undefined;
}

/** The argument the call was written with, when it infers nothing useful. */
function emptyArgumentOf(
  hook: HookCall['hook'],
  args: ts.NodeArray<ts.Expression>,
): EmptyInitializer | undefined {
  if (hook === 'createContext' && args.length === 0) {
    return 'absent';
  }
  if (args.length !== 1) return undefined;

  const initializer = emptyInitializerOf(args[0]);
  if (initializer === undefined) return undefined;
  // useRef holds an element, which only `null` stands in for. `useRef([])`
  // holds a real array and infers it.
  if (hook === 'useRef' && initializer !== 'null') return undefined;

  return initializer;
}

function emptyInitializerOf(argument: ts.Expression): EmptyInitializer | undefined {
  if (argument.kind === ts.SyntaxKind.NullKeyword) return 'null';
  if (ts.isIdentifier(argument) && argument.text === 'undefined') return 'undefined';
  if (ts.isArrayLiteralExpression(argument) && argument.elements.length === 0) return 'array';
  if (ts.isObjectLiteralExpression(argument) && argument.properties.length === 0) return 'object';
  return undefined;
}

/**
 * Whether an error the file already has is reported on what the hook is bound
 * to. Each reference's span is grown through the accesses, calls and JSX
 * attributes that read it, since the error lands on the argument or the
 * property rather than on the reference itself. A `createContext` call with no
 * argument is blamed by the arity error on the call itself.
 */
function isBlamedByAnError(
  hookCall: HookCall,
  errors: ts.Diagnostic[],
  source: ts.SourceFile,
): boolean {
  const spans = [...hookCall.valueReferences, ...hookCall.setterReferences].map((reference) => {
    let node: ts.Node = reference;
    while (readsThrough(node)) node = node.parent;
    const start = node.getStart(source);
    return { start, end: node.end };
  });
  if (hookCall.initializer === 'absent') {
    spans.push({ start: hookCall.call.getStart(source), end: hookCall.call.end });
  }

  return errors.some((error) => {
    const { start } = error;
    return start != null && spans.some((span) => start >= span.start && start < span.end);
  });
}

function readsThrough(node: ts.Node): boolean {
  const { parent } = node;
  if (parent == null) return false;
  if (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) {
    return parent.expression === node;
  }
  if (ts.isBinaryExpression(parent)) {
    return parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.left === node;
  }
  // The whole opening element, so the errors its props report count.
  if (ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) {
    return parent.tagName === node;
  }
  return (
    ts.isCallExpression(parent) ||
    ts.isNonNullExpression(parent) ||
    ts.isParenthesizedExpression(parent) ||
    ts.isJsxExpression(parent) ||
    ts.isJsxAttribute(parent)
  );
}

function evidenceFor(
  hookCall: HookCall,
  checker: ts.TypeChecker,
  source: ts.SourceFile,
): string | undefined {
  switch (hookCall.hook) {
    case 'useRef':
      return refEvidence(hookCall);
    case 'createContext':
      return contextEvidence(hookCall, checker, source);
    default:
      return stateEvidence(hookCall, checker, source);
  }
}

/**
 * The union the setter is called with, plus whatever the initializer already
 * holds. Anything else the setter is used for hands it to code this file
 * cannot see, which is no evidence at all.
 */
function stateEvidence(
  hookCall: HookCall,
  checker: ts.TypeChecker,
  source: ts.SourceFile,
): string | undefined {
  const parts: string[] = [];

  for (const reference of hookCall.setterReferences) {
    const { parent } = reference;
    if (!ts.isCallExpression(parent) || parent.expression !== reference) return undefined;
    if (parent.arguments.length !== 1) return undefined;

    const [argument] = parent.arguments;
    // The updater form is typed by the state, so it says nothing about it.
    if (ts.isArrowFunction(argument) || ts.isFunctionExpression(argument)) continue;

    const type = checker.getBaseTypeOfLiteralType(checker.getTypeAtLocation(argument));
    // Setting the initializer back says nothing the type below does not.
    if (type.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)) continue;

    const text = writableTypeText(type, checker, source);
    if (text === undefined) return undefined;
    parts.push(text);
  }

  return unionText(parts, hookCall.initializer);
}

/**
 * The union of the `value` props the Providers in this file pass. Every other
 * use of a context reads the value rather than sets it, so it says nothing
 * about the type; a Provider whose value cannot be read here does, which
 * leaves this file with no evidence at all.
 */
function contextEvidence(
  hookCall: HookCall,
  checker: ts.TypeChecker,
  source: ts.SourceFile,
): string | undefined {
  // A `{}` default accepts every value, so a Provider in another file is clean
  // against this context today and nothing here can see whether one exists.
  // The alias accepts everything too, which is what makes it the safe answer.
  if (hookCall.initializer === 'object') {
    return undefined;
  }

  const parts: string[] = [];

  for (const reference of hookCall.valueReferences) {
    const element = providerElement(reference);
    if (element === undefined) continue;

    const value = providerValue(element);
    if (value === undefined) return undefined;

    const type = checker.getBaseTypeOfLiteralType(checker.getTypeAtLocation(value));
    const text = writableTypeText(type, checker, source);
    if (text === undefined) return undefined;
    parts.push(text);
  }

  return unionText(parts, hookCall.initializer);
}

/** The `<Ctx.Provider>` element the reference is the tag of. */
function providerElement(reference: ts.Identifier): ts.JsxOpeningLikeElement | undefined {
  const tagName = reference.parent;
  if (
    !ts.isPropertyAccessExpression(tagName) ||
    tagName.expression !== reference ||
    tagName.name.text !== 'Provider'
  ) {
    return undefined;
  }
  const element = tagName.parent;
  return ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)
    ? element
    : undefined;
}

/** The expression the Provider's `value` prop is given, when it has one. */
function providerValue(element: ts.JsxOpeningLikeElement): ts.Expression | undefined {
  let value: ts.Expression | undefined;

  for (const property of element.attributes.properties) {
    // A spread carries whatever the object it spreads holds, value included.
    if (!ts.isJsxAttribute(property)) return undefined;
    if (ts.isIdentifier(property.name) && property.name.text === 'value') {
      const { initializer } = property;
      value = initializer && ts.isJsxExpression(initializer) ? initializer.expression : undefined;
    }
  }

  return value;
}

/** The type text the collected parts make, widened by the default value. */
function unionText(parts: string[], initializer: EmptyInitializer): string | undefined {
  const distinct = Array.from(new Set(parts));
  if (distinct.length === 0) {
    return undefined;
  }
  const nullish = nullishOf(initializer);
  return (nullish ? [...distinct, nullish] : distinct).join(' | ');
}

function nullishOf(initializer: EmptyInitializer): string | undefined {
  if (initializer === 'null') return 'null';
  if (initializer === 'undefined' || initializer === 'absent') return 'undefined';
  return undefined;
}

/**
 * The element interface of the single intrinsic tag the ref is attached to.
 * A ref that reaches two kinds of tag, a component, or anything other than a
 * `.current` read has no tag to name.
 */
function refEvidence(hookCall: HookCall): string | undefined {
  let tag: string | undefined;

  for (const reference of hookCall.valueReferences) {
    const attachment = refAttachmentTag(reference);
    if (attachment !== undefined) {
      if (tag !== undefined && tag !== attachment) return undefined;
      tag = attachment;
    } else if (!isCurrentAccess(reference)) {
      return undefined;
    }
  }

  const elementType = tag === undefined ? undefined : elementTypesByTag[tag];
  return elementType && `${elementType} | null`;
}

/** The lowercase tag of the `ref={x}` attribute the reference is the value of. */
function refAttachmentTag(reference: ts.Identifier): string | undefined {
  const expression = reference.parent;
  if (!ts.isJsxExpression(expression) || expression.expression !== reference) return undefined;
  const attribute = expression.parent;
  if (
    !ts.isJsxAttribute(attribute) ||
    !ts.isIdentifier(attribute.name) ||
    attribute.name.text !== 'ref'
  ) {
    return undefined;
  }

  return intrinsicTagOfJsxAttribute(attribute);
}

function isCurrentAccess(reference: ts.Identifier): boolean {
  const { parent } = reference;
  return (
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === reference &&
    parent.name.text === 'current'
  );
}

/**
 * The type as it can be written where the hook is called, or nothing when it
 * cannot be. `any` is rejected outright: it is assignable in both directions,
 * so a type argument derived from it would pass the re-check while saying
 * nothing about the state.
 */
function writableTypeText(
  type: ts.Type,
  checker: ts.TypeChecker,
  source: ts.SourceFile,
): string | undefined {
  const unusable = ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never;
  if (type.flags & unusable) return undefined;

  const text = checker.typeToString(type, source, ts.TypeFormatFlags.NoTruncation);
  if (
    text.length > maxTypeTextLength ||
    // A type the checker can only name through the module it came from is not
    // in scope here, and `never` inside one is the checker giving up.
    text.includes('import(') ||
    /\bnever\b/.test(text) ||
    text === '{}' ||
    text === 'object'
  ) {
    return undefined;
  }
  // A union or a function type has to be parenthesized to sit in the union the
  // caller builds.
  return /=>|\||&/.test(text) ? `(${text})` : text;
}

/**
 * The candidates whose type argument the checker accepts. The whole set is
 * checked first, which is one program for the common file; only when that
 * reports something are they checked one at a time.
 */
function provenCandidates(
  fileName: string,
  source: ts.SourceFile,
  compilerOptions: ts.CompilerOptions,
  candidates: Candidate[],
  projectProgram: ts.Program,
): Set<Candidate> {
  const withEvidence = candidates.filter((candidate) => candidate.evidence !== undefined);
  if (withEvidence.length === 0) {
    return new Set();
  }

  const { text } = source;
  const { check } = createChangeValidator(
    fileName,
    text,
    compilerOptions,
    projectProgram,
    maxValidationPrograms,
  );

  // The any alias is left out of the candidate text on purpose: it is declared
  // in a file a single-file program does not see, and an `any` type argument
  // can only remove errors, so leaving it out proves the same thing.
  const isClean = (group: Candidate[]): boolean => {
    const checked = check(() => changesOf(group));
    return checked !== undefined && checked.newErrors.length === 0;
  };

  if (isClean(withEvidence)) {
    return new Set(withEvidence);
  }
  return new Set(withEvidence.filter((candidate) => isClean([candidate])));
}

function changesOf(candidates: Candidate[]): TextChange[] {
  return candidates
    .flatMap((candidate) => changesFor(candidate, candidate.evidence))
    .sort((a, b) => a.start - b.start);
}
