import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import getTokenAtPosition from './utils/token-pos';
import { contestedSpans, isOverloaded } from './utils/signature-relaxation';
import { AnyAliasOptions, validateAnyAliasOptions } from '../utils/validateOptions';
import {
  applyTextChanges,
  createFileLanguageService,
  findNewErrors,
  getValidationOptions,
  TextChange,
} from '../utils/candidateValidation';
import { isMigratableFile } from '../utils/sourceFiles';

type Options = AnyAliasOptions;

// Assignability failures an argument can be reported with.
const argumentDiagnosticCodes = new Set([2322, 2345, 2559, 2739, 2740, 2741]);

/** Assignability, which the checker exposes but does not declare. */
type AssignabilityReader = { isTypeAssignableTo?(source: ts.Type, target: ts.Type): boolean };

interface PlannedChange extends TextChange {
  /** Spelled `any` for validation, which cannot resolve the alias by name. */
  writesAny: boolean;
}

interface PlannedFile {
  /** The text the plan was computed against; a file that has since changed is skipped. */
  text: string;
  changes: PlannedChange[];
}

interface Pass {
  files: Map<string, PlannedFile>;
  /** Every file the plan was computed over, so a pass over a different set is noticed. */
  known: Set<string>;
  served: Set<string>;
}

let currentPass: Pass | undefined;

/**
 * Relaxes an object type written inline on a parameter to the shape the
 * project's own calls support.
 *
 * A shape inferred from one function body is a guess about every caller, and
 * the callers are in other files. Where they disagree the guess is what is
 * wrong, and each disagreement costs a suppression: a member no argument
 * carries becomes optional, a member whose type they contradict becomes `any`,
 * and a shape whose last required member the calls refute is dropped for `any`,
 * because a type of nothing but optional members rejects an argument that
 * shares no property with it and so trades one error for another.
 *
 * The plan is computed once for the whole project, because the calls are in
 * files other than the one that declares the parameter.
 */
const relaxParameterShapesPlugin: Plugin<Options> = {
  name: 'relax-parameter-shapes',

  run({ fileName, text, sourceFile, getLanguageService, options }) {
    const languageService = getLanguageService();
    if (!currentPass || currentPass.served.has(fileName) || !currentPass.known.has(fileName)) {
      currentPass = plan(languageService);
    }
    currentPass.served.add(fileName);

    const planned = currentPass.files.get(fileName);
    if (!planned || planned.text !== text) {
      return undefined;
    }
    const kept = proven(fileName, text, sourceFile, planned.changes, languageService);
    if (!kept) return undefined;

    const anyAlias = options.anyAlias ?? 'any';
    return applyTextChanges(
      text,
      kept.map((change) => (change.writesAny ? { ...change, text: anyAlias } : change)),
    );
  },

  validate: validateAnyAliasOptions,
};

export default relaxParameterShapesPlugin;

/** What the project's calls say about one inline parameter shape. */
interface Refutation {
  literal: ts.TypeLiteralNode;
  missing: Set<string>;
  mismatched: Set<string>;
}

function plan(languageService: ts.LanguageService): Pass {
  const pass: Pass = { files: new Map(), known: new Set(), served: new Set() };
  const program = languageService.getProgram();
  if (!program) return pass;
  const checker = program.getTypeChecker();

  const refutations = new Map<ts.ParameterDeclaration, Refutation>();
  program.getSourceFiles().forEach((file) => {
    if (!isMigratableFile(file)) return;
    pass.known.add(file.fileName);
    languageService.getSemanticDiagnostics(file.fileName).forEach((diagnostic) => {
      if (!argumentDiagnosticCodes.has(diagnostic.code) || diagnostic.start == null) return;
      const site = argumentAt(file, diagnostic.start, diagnostic.length ?? 0);
      if (!site) return;
      refute(site, checker, refutations);
    });
  });

  const changesByFile = new Map<string, PlannedChange[]>();
  refutations.forEach((refutation, parameter) => {
    const changes = relaxation(refutation, checker);
    if (changes.length === 0) return;
    const { fileName } = parameter.getSourceFile();
    const forFile = changesByFile.get(fileName);
    if (forFile) {
      forFile.push(...changes);
    } else {
      changesByFile.set(fileName, changes);
    }
  });

  changesByFile.forEach((changes, fileName) => {
    const source = program.getSourceFile(fileName);
    if (!source) return;
    pass.files.set(fileName, {
      text: source.text,
      changes: changes.sort((a, b) => a.start - b.start),
    });
  });
  return pass;
}

interface ArgumentSite {
  call: ts.CallExpression | ts.NewExpression;
  argument: ts.Expression;
  index: number;
}

/** The argument an assignability diagnostic blames, and the call it belongs to. */
function argumentAt(file: ts.SourceFile, start: number, length: number): ArgumentSite | undefined {
  let spanning: ts.Node | undefined = getTokenAtPosition(file, start);
  const end = start + length;
  while (spanning && spanning.end < end) {
    spanning = spanning.parent;
  }
  for (let node = spanning; node; node = node.parent) {
    const { parent } = node;
    if (parent && (ts.isCallExpression(parent) || ts.isNewExpression(parent))) {
      const args: readonly ts.Expression[] = parent.arguments ?? [];
      // A spread argument makes the position of everything after it unknown,
      // so no argument in such a call identifies a parameter.
      if (args.some(ts.isSpreadElement)) return undefined;
      const index = args.indexOf(node as ts.Expression);
      if (index >= 0) return { call: parent, argument: node as ts.Expression, index };
    }
  }
  return undefined;
}

function refute(
  site: ArgumentSite,
  checker: ts.TypeChecker,
  refutations: Map<ts.ParameterDeclaration, Refutation>,
): void {
  const parameter = relaxableParameter(site, checker);
  if (!parameter) return;
  const literal = parameter.type as ts.TypeLiteralNode;

  const argumentType = checker.getTypeAtLocation(site.argument);
  if ((argumentType.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) !== 0) return;
  // A primitive carries its members on its apparent type, so `string` reads as
  // having no properties at all without this and every member looks missing.
  const source = checker.getApparentType(argumentType);
  const target = checker.getTypeFromTypeNode(literal);
  const isAssignable = (checker as AssignabilityReader).isTypeAssignableTo;

  let refutation = refutations.get(parameter);
  if (!refutation) {
    refutation = { literal, missing: new Set(), mismatched: new Set() };
    refutations.set(parameter, refutation);
  }

  (literal.members as ts.NodeArray<ts.PropertySignature>).forEach((member) => {
    const name = memberName(member);
    const supplied = checker.getPropertyOfType(source, name);
    if (!supplied) {
      if (!member.questionToken) refutation.missing.add(name);
      return;
    }
    const declared = checker.getPropertyOfType(target, name);
    if (!declared || typeof isAssignable !== 'function') return;
    if (namesProjectType(member.type as ts.TypeNode, checker)) return;
    const from = checker.getTypeOfSymbolAtLocation(supplied, site.argument);
    const to = checker.getTypeOfSymbolAtLocation(declared, site.argument);
    if (!isAssignable.call(checker, from, to)) refutation.mismatched.add(name);
  });
}

/**
 * Whether a type node reaches a type the project declares. Such a type is a
 * contract someone wrote, so an argument disagreeing with it is a caller to
 * look at rather than evidence the contract is wrong; only the shapes the
 * migration itself invented are ours to relax.
 */
function namesProjectType(type: ts.TypeNode, checker: ts.TypeChecker): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (ts.isTypeReferenceNode(node)) {
      const declarations = resolved(node.typeName, checker)?.declarations ?? [];
      if (declarations.some((declaration) => isMigratableFile(declaration.getSourceFile()))) {
        found = true;
        return;
      }
    }
    node.forEachChild(visit);
  };
  visit(type);
  return found;
}

function resolved(name: ts.EntityName, checker: ts.TypeChecker): ts.Symbol | undefined {
  const symbol = checker.getSymbolAtLocation(ts.isQualifiedName(name) ? name.right : name);
  if (!symbol) return undefined;
  return (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol;
}

/**
 * The parameter an argument was checked against, when its shape is ours to
 * relax: written inline, made only of named properties this pass can edit, and
 * belonging to a project function with a body. Overloads are left alone, since
 * the argument may belong to a signature other than the one the checker picked.
 */
function relaxableParameter(
  site: ArgumentSite,
  checker: ts.TypeChecker,
): ts.ParameterDeclaration | undefined {
  const declaration = checker.getResolvedSignature(site.call)?.declaration;
  if (!declaration || ts.isJSDocSignature(declaration)) return undefined;
  if (!(declaration as ts.FunctionLikeDeclaration).body) return undefined;
  if (!isMigratableFile(declaration.getSourceFile())) return undefined;
  if (isOverloaded(declaration, checker)) return undefined;

  const parameter = declaration.parameters[site.index];
  if (!parameter || parameter.dotDotDotToken) return undefined;
  const { type } = parameter;
  if (!type || !ts.isTypeLiteralNode(type) || type.members.length === 0) return undefined;
  const editable = type.members.every(
    (member) =>
      ts.isPropertySignature(member) &&
      member.type != null &&
      member.name != null &&
      (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)),
  );
  return editable ? parameter : undefined;
}

function relaxation(
  { literal, missing, mismatched }: Refutation,
  checker: ts.TypeChecker,
): PlannedChange[] {
  if (missing.size === 0 && mismatched.size === 0) return [];

  const members = literal.members as ts.NodeArray<ts.PropertySignature>;
  const required = members.filter((member) => !member.questionToken);
  const survivors = required.filter((member) => !missing.has(memberName(member)));
  if (required.length > 0 && survivors.length === 0) {
    return namesProjectType(literal, checker)
      ? []
      : [asAny(literal.getStart(), literal.end - literal.getStart())];
  }

  const changes: PlannedChange[] = [];
  members.forEach((member) => {
    const name = memberName(member);
    if (missing.has(name) && !member.questionToken) {
      changes.push({ start: member.name.end, length: 0, text: '?', writesAny: false });
    }
    const type = member.type as ts.TypeNode;
    if (mismatched.has(name) && type.kind !== ts.SyntaxKind.AnyKeyword) {
      changes.push(asAny(type.getStart(), type.end - type.getStart()));
    }
  });
  return changes;
}

function memberName(member: ts.TypeElement): string {
  return (member.name as ts.Identifier | ts.StringLiteral).text;
}

function asAny(start: number, length: number): PlannedChange {
  return { start, length, text: 'any', writesAny: true };
}

/**
 * The relaxations that cost the declaring file nothing. An optional member
 * reads as `T | undefined` in the body, which the body can contradict; those
 * are dropped and the rest kept.
 */
function proven(
  fileName: string,
  text: string,
  sourceFile: ts.SourceFile,
  changes: PlannedChange[],
  languageService: ts.LanguageService,
): PlannedChange[] | undefined {
  const program = languageService.getProgram();
  const compilerOptions = getValidationOptions(program ? program.getCompilerOptions() : {});
  const baseline = createFileLanguageService(fileName, text, compilerOptions, program);

  let kept = changes;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const candidateText = applyTextChanges(text, kept);
    const candidate = createFileLanguageService(fileName, candidateText, compilerOptions, program);
    const newErrors = findNewErrors(baseline, candidate, kept, fileName);
    if (newErrors.length === 0) return kept;

    const contested = contestedSpans(newErrors, kept, sourceFile);
    const remaining = kept.filter(
      (change) => !contested.some(({ pos, end }) => change.start >= pos && change.start <= end),
    );
    if (remaining.length === kept.length || remaining.length === 0) return undefined;
    kept = remaining;
  }
  return undefined;
}
