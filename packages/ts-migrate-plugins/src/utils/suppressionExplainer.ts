import path from 'path';
import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import findEnclosingNode from './enclosingNode';
import pluralize from './pluralize';
import { isDiagnosticWithLinePosition } from './type-guards';
import { getOrCreate } from './maps';
import typeOnlyImportRepairs from './typeOnlyImportRepair';

/** Type strings are never abbreviated; the report exists to keep what the comment drops. */
const TYPE_FORMAT_FLAGS = ts.TypeFormatFlags.NoTruncation;

/** `getPropertiesOfType` on a lib type returns dozens of members. */
const MAX_PROPERTIES = 12;

/** How far up from the diagnostic node to look for the enclosing call. */
const MAX_CALL_DEPTH = 8;

/** How far up from an annotation to look for the comment that wrote it. */
const MAX_JSDOC_DEPTH = 8;

/** How deep into nested namespaces a name is looked for. */
const MAX_NAMESPACE_DEPTH = 3;

/** Files listed per unresolved name before the rest are counted instead. */
const MAX_NAME_FILES = 5;

/** Entries listed per summary section before the rest are counted instead. */
const MAX_SUMMARY_ENTRIES = 5;

export interface SourceLocation {
  /** Relative to rootDir when inside it, absolute otherwise. */
  file: string;
  /** One-based. */
  line: number;
  /** One-based. */
  column: number;
}

/** One link of a `ts.DiagnosticMessageChain`, with the code it carries. */
export interface SuppressionMessageLink {
  code: number;
  message: string;
  depth: number;
}

export interface SuppressionRelatedInfo {
  code: number;
  message: string;
  location?: SourceLocation;
}

export interface SuppressionParameter {
  name: string;
  type: string;
  optional: boolean;
  rest: boolean;
}

export interface SuppressionMember {
  name: string;
  kind: string;
  type: string;
  location?: SourceLocation;
}

export interface SuppressionEvidence {
  /** The resolved call signature. */
  signature?: string;
  /** Every overload the call was resolved against, when there was more than one. */
  candidateSignatures?: string[];
  parameters?: SuppressionParameter[];
  argumentCount?: number;
  /** Parameters before the first optional or rest one. */
  requiredCount?: number;
  argumentTypes?: string[];
  /** The type the position requires. */
  expectedType?: string;
  /** The type the expression has, literals preserved. */
  actualType?: string;
  /** Properties of the expected type the actual type does not have. */
  missingProperties?: string[];
  /** Properties both types have where the actual one is not assignable. */
  mismatchedProperties?: string[];
  /** Set when a property list was capped at MAX_PROPERTIES. */
  propertiesTruncated?: boolean;
  /** Where the callee is declared. */
  declaredAt?: SourceLocation;
  declarationKind?: string;
  /** Whether that declaration is a file of the project rather than lib or a dependency. */
  declaredInProject?: boolean;
  baseMember?: SuppressionMember;
  derivedMember?: SuppressionMember;
  /** The identifier or module specifier that did not resolve. */
  unresolved?: string;
  /** Whether the name was written where a type goes rather than in an expression. */
  unresolvedIsType?: boolean;
  /** Whether a JSDoc tag over the declaration it annotates writes the same name. */
  unresolvedIsDocumented?: boolean;
  /** Paths the compiler tried for an unresolved module. */
  failedLookups?: string[];
}

export interface SuppressionSite {
  location: SourceLocation;
  code: number;
  /** The whole chain, via `ts.flattenDiagnosticMessageText`. */
  message: string;
  chain: SuppressionMessageLink[];
  related: SuppressionRelatedInfo[];
  /**
   * Whether ts-ignore writes this diagnostic into the comment for its line.
   * False for every diagnostic after the first on a line: those leave no trace
   * in the file, so `ts-migrate report` cannot count them.
   */
  commented: boolean;
  evidence?: SuppressionEvidence;
  /** Set when reading the checker for this diagnostic threw. */
  evidenceError?: string;
}

export interface SuppressionFixShape {
  shape: string;
  count: number;
}

export interface SuppressionCodeGroup {
  code: number;
  count: number;
  /** How many of `count` become the comment on their line. */
  comments: number;
  fileCount: number;
  fixShapes: SuppressionFixShape[];
  /** Longest flattened message for this code, against the 50 the comment keeps. */
  longestMessage: number;
}

/**
 * One type name that resolved to nothing, over every site that wrote it. The
 * annotations a migration writes come from the comments, so a name with 33
 * sites is one missing import or one stale comment rather than 33 findings.
 */
export interface UnresolvedTypeGroup {
  name: string;
  /** Diagnostics on this name. */
  count: number;
  fileCount: number;
  /** The files that wrote it, largest count first. */
  files: string[];
  /** How many of `count` sit under a JSDoc tag writing the same name. */
  documented: number;
  /** Where the program declares the name, when anything declares it. */
  declaredAt?: SourceLocation;
  declarationKind?: string;
  /** Whether that declaration is a file of the project rather than a dependency. */
  declaredInProject?: boolean;
}

export interface SuppressionReport {
  rootDir: string;
  /** Every diagnostic ts-ignore was about to hide. */
  total: number;
  /** Diagnostics that get a comment. */
  commented: number;
  /** Diagnostics sharing a line with an earlier one, which leave no trace in the file. */
  sharedLine: number;
  fileCount: number;
  /** Largest count first. */
  codes: SuppressionCodeGroup[];
  /** The type names that resolved to nothing, largest count first. */
  unresolvedTypes: UnresolvedTypeGroup[];
  sites: SuppressionSite[];
}

export interface SuppressionExplainer {
  plugin: Plugin<unknown>;
  summarize(rootDir: string): SuppressionReport;
}

interface CollectedSite extends Omit<SuppressionSite, 'location'> {
  fileName: string;
  line: number;
  column: number;
}

/**
 * Creates a read-only plugin that records what the compiler knew about each
 * diagnostic ts-ignore is about to suppress, and a `summarize` to build the
 * report once the run finishes. Register it immediately before ts-ignore:
 * a directive already in the file suppresses the diagnostic it describes, so
 * `getSemanticDiagnostics` never reports it again.
 */
export function createSuppressionExplainer(): SuppressionExplainer {
  const sites: CollectedSite[] = [];
  const visited = new Set<string>();

  const plugin: Plugin<unknown> = {
    name: 'explain-suppressions',
    // Reads diagnostics only, so the runner can defer ts-ignore's writes and
    // check every file against the same warm program.
    mutationsPreserveTypes: true,
    run({ fileName, rootDir, sourceFile, getLanguageService, reportFileNotice }) {
      if (visited.has(fileName)) return undefined;
      visited.add(fileName);
      try {
        const languageService = getLanguageService();
        const diagnostics = languageService.getSemanticDiagnostics(fileName);
        // ts-ignore repairs a value that was imported with `import type` rather
        // than suppressing it, so those are not suppressions to explain.
        const { repaired } = typeOnlyImportRepairs(
          languageService,
          fileName,
          sourceFile,
          diagnostics,
        );
        collectSuppressionEvidence({
          sites,
          rootDir,
          sourceFile,
          program: languageService.getProgram?.(),
          diagnostics: diagnostics.filter((diagnostic) => !repaired.has(diagnostic)),
        });
      } catch (err) {
        reportFileNotice?.({
          reason: `could not record the evidence behind the suppressions: ${errorMessage(err)}`,
          hint: 'The suppression report will be missing these files; the migration itself is unaffected.',
          recovered: true,
        });
      }
      return undefined;
    },
  };

  return { plugin, summarize: (rootDir: string) => summarizeSuppressions(sites, rootDir) };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function collectSuppressionEvidence({
  sites,
  rootDir,
  sourceFile,
  program,
  diagnostics,
}: {
  sites: CollectedSite[];
  rootDir: string;
  sourceFile: ts.SourceFile;
  program: ts.Program | undefined;
  diagnostics: readonly ts.Diagnostic[];
}): void {
  const checker = program?.getTypeChecker();
  const commentedLines = new Set<number>();

  diagnostics.filter(isDiagnosticWithLinePosition).forEach((diagnostic) => {
    const file = diagnostic.file ?? sourceFile;
    const { line, character } = ts.getLineAndCharacterOfPosition(file, diagnostic.start);
    const commented = !commentedLines.has(line);
    commentedLines.add(line);

    const site: CollectedSite = {
      fileName: file.fileName,
      line: line + 1,
      column: character + 1,
      code: diagnostic.code,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
      chain: messageChainLinks(diagnostic.messageText),
      related: relatedInfo(diagnostic),
      commented,
    };

    if (checker && program) {
      try {
        site.evidence = enrichDiagnostic({ diagnostic, file, checker, program, rootDir });
      } catch (err) {
        site.evidenceError = errorMessage(err);
      }
    }
    sites.push(site);
  });
}

function messageChainLinks(
  messageText: string | ts.DiagnosticMessageChain,
): SuppressionMessageLink[] {
  if (typeof messageText === 'string') return [];
  const links: SuppressionMessageLink[] = [];
  const walk = (chain: ts.DiagnosticMessageChain, depth: number): void => {
    links.push({ code: chain.code, message: chain.messageText, depth });
    chain.next?.forEach((next) => walk(next, depth + 1));
  };
  walk(messageText, 0);
  return links;
}

function relatedInfo(diagnostic: ts.Diagnostic): SuppressionRelatedInfo[] {
  return (diagnostic.relatedInformation ?? []).map((related) => ({
    code: related.code,
    message: ts.flattenDiagnosticMessageText(related.messageText, ' '),
    location:
      related.file && related.start != null
        ? absoluteLocation(related.file, related.start)
        : undefined,
  }));
}

/** Absolute while collecting; relativized against rootDir in summarizeSuppressions. */
function absoluteLocation(file: ts.SourceFile, pos: number): SourceLocation {
  const { line, character } = ts.getLineAndCharacterOfPosition(file, pos);
  return { file: file.fileName, line: line + 1, column: character + 1 };
}

function declarationLocation(node: ts.Node): SourceLocation | undefined {
  const file = node.getSourceFile();
  if (!file) return undefined;
  return absoluteLocation(file, node.getStart(file));
}

function inProject(fileName: string, rootDir: string): boolean {
  const relative = path.relative(rootDir, fileName);
  return (
    !relative.startsWith('..') && !path.isAbsolute(relative) && !relative.includes('node_modules')
  );
}

function declarationEvidence(
  declaration: ts.Node,
  rootDir: string,
): Pick<SuppressionEvidence, 'declaredAt' | 'declarationKind' | 'declaredInProject'> {
  const declaredAt = declarationLocation(declaration);
  return {
    declaredAt,
    declarationKind: ts.SyntaxKind[declaration.kind],
    declaredInProject: declaredAt ? inProject(declaredAt.file, rootDir) : undefined,
  };
}

function enclosingCall(node: ts.Node): ts.CallExpression | ts.NewExpression | undefined {
  let current: ts.Node | undefined = node;
  for (let depth = 0; current && depth < MAX_CALL_DEPTH; depth += 1) {
    if (ts.isCallExpression(current) || ts.isNewExpression(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function enrichDiagnostic({
  diagnostic,
  file,
  checker,
  program,
  rootDir,
}: {
  diagnostic: ts.DiagnosticWithLocation;
  file: ts.SourceFile;
  checker: ts.TypeChecker;
  program: ts.Program;
  rootDir: string;
}): SuppressionEvidence | undefined {
  const node = findEnclosingNode(file, diagnostic.start, diagnostic.length);
  if (!node) return undefined;

  switch (diagnostic.code) {
    case 2554:
    case 2769:
      return callEvidence(node, checker, rootDir);
    case 2345:
      return argumentEvidence(node, checker, rootDir);
    case 2322:
      return assignmentEvidence(node, checker);
    case 2416:
    case 2425:
      return memberEvidence(node, checker);
    case 2304:
    case 2552:
      return unresolvedNameEvidence(node, file, checker, program, rootDir);
    case 2307:
      return moduleEvidence(node, file, program);
    default:
      return undefined;
  }
}

function nodeText(node: ts.Node, file: ts.SourceFile): string {
  return ts.isStringLiteralLike(node) ? node.text : node.getText(file);
}

function typeString(checker: ts.TypeChecker, type: ts.Type, at: ts.Node): string {
  return checker.typeToString(type, at, TYPE_FORMAT_FLAGS);
}

function signatureParameters(
  signature: ts.Signature,
  checker: ts.TypeChecker,
  at: ts.Node,
): SuppressionParameter[] {
  return signature.getParameters().map((parameter) => {
    const declaration = parameter.valueDeclaration;
    const isParameter = declaration != null && ts.isParameter(declaration);
    return {
      name: parameter.getName(),
      type: typeString(checker, checker.getTypeOfSymbolAtLocation(parameter, at), at),
      optional:
        isParameter &&
        (declaration.questionToken != null ||
          declaration.initializer != null ||
          declaration.dotDotDotToken != null),
      rest: isParameter && declaration.dotDotDotToken != null,
    };
  });
}

function requiredParameterCount(parameters: SuppressionParameter[]): number {
  const firstOptional = parameters.findIndex((parameter) => parameter.optional);
  return firstOptional === -1 ? parameters.length : firstOptional;
}

function calleeEvidence(
  signature: ts.Signature,
  rootDir: string,
): Pick<SuppressionEvidence, 'declaredAt' | 'declarationKind' | 'declaredInProject'> {
  const declaration = signature.declaration;
  return declaration ? declarationEvidence(declaration, rootDir) : {};
}

function callEvidence(
  node: ts.Node,
  checker: ts.TypeChecker,
  rootDir: string,
): SuppressionEvidence | undefined {
  const call = enclosingCall(node);
  if (!call) return undefined;

  const args: readonly ts.Expression[] = call.arguments ?? [];
  const candidates: ts.Signature[] = [];
  const signature = checker.getResolvedSignature(call, candidates);
  const evidence: SuppressionEvidence = {
    argumentCount: args.length,
    argumentTypes: args.map((argument) =>
      typeString(checker, checker.getTypeAtLocation(argument), argument),
    ),
  };
  if (candidates.length > 1) {
    evidence.candidateSignatures = candidates.map((candidate) =>
      checker.signatureToString(candidate, call, TYPE_FORMAT_FLAGS),
    );
  }
  if (!signature) return evidence;

  evidence.signature = checker.signatureToString(signature, call, TYPE_FORMAT_FLAGS);
  evidence.parameters = signatureParameters(signature, checker, call);
  evidence.requiredCount = requiredParameterCount(evidence.parameters);
  return { ...evidence, ...calleeEvidence(signature, rootDir) };
}

function argumentEvidence(
  node: ts.Node,
  checker: ts.TypeChecker,
  rootDir: string,
): SuppressionEvidence | undefined {
  const call = enclosingCall(node);
  if (!call || !ts.isExpression(node)) return undefined;

  const args: readonly ts.Expression[] = call.arguments ?? [];
  const signature = checker.getResolvedSignature(call);
  const actual = checker.getTypeAtLocation(node);
  const evidence: SuppressionEvidence = {
    actualType: typeString(checker, actual, node),
    argumentCount: args.length,
  };

  let expected: ts.Type | undefined;
  if (signature) {
    evidence.signature = checker.signatureToString(signature, call, TYPE_FORMAT_FLAGS);
    evidence.parameters = signatureParameters(signature, checker, call);
    Object.assign(evidence, calleeEvidence(signature, rootDir));
    const index = args.indexOf(node);
    const parameter = index === -1 ? undefined : signature.getParameters()[index];
    if (parameter) expected = checker.getTypeOfSymbolAtLocation(parameter, call);
  }
  expected = expected ?? checker.getContextualType(node) ?? undefined;
  if (expected) {
    evidence.expectedType = typeString(checker, expected, node);
    Object.assign(evidence, propertyDiff(checker, actual, expected, node));
  }
  return evidence;
}

function assignmentEvidence(node: ts.Node, checker: ts.TypeChecker): SuppressionEvidence | undefined {
  const { parent } = node;
  let expected: ts.Type | undefined;
  let actualNode: ts.Node | undefined;

  if (
    parent &&
    (ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent)) &&
    parent.name === node
  ) {
    // getTypeAtLocation on the name yields the declared type, so the initializer
    // has to be asked separately or both sides read the same.
    expected = parent.type ? checker.getTypeFromTypeNode(parent.type) : undefined;
    actualNode = parent.initializer;
  } else if (parent && ts.isPropertyAssignment(parent) && parent.name === node) {
    expected = checker.getContextualType(parent.initializer) ?? undefined;
    actualNode = parent.initializer;
  } else if (ts.isExpression(node)) {
    expected = checker.getContextualType(node) ?? undefined;
    actualNode = node;
  }
  if (!actualNode) return undefined;

  const actual = checker.getTypeAtLocation(actualNode);
  const evidence: SuppressionEvidence = { actualType: typeString(checker, actual, actualNode) };
  if (expected) {
    evidence.expectedType = typeString(checker, expected, actualNode);
    Object.assign(evidence, propertyDiff(checker, actual, expected, actualNode));
  }
  return evidence;
}

function memberEvidence(node: ts.Node, checker: ts.TypeChecker): SuppressionEvidence | undefined {
  const member = node.parent;
  if (!member || !ts.isClassElement(member) || !member.name) return undefined;
  const classDeclaration = member.parent;
  if (!classDeclaration || !ts.isClassLike(classDeclaration)) return undefined;

  const name = member.name.getText(member.getSourceFile());
  const derivedType = checker.getTypeAtLocation(member);
  const derived: SuppressionMember = {
    name,
    kind: ts.SyntaxKind[member.kind],
    type: typeString(checker, derivedType, member),
    location: declarationLocation(member),
  };

  const extendsClause = classDeclaration.heritageClauses?.find(
    (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
  );
  const baseTypeNode = extendsClause?.types[0];
  if (!baseTypeNode) return { derivedMember: derived };

  const isStatic = (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static) !== 0;
  const baseType = isStatic
    ? checker.getTypeAtLocation(baseTypeNode.expression)
    : checker.getTypeAtLocation(baseTypeNode);
  const baseSymbol = checker.getPropertyOfType(baseType, name);
  if (!baseSymbol) return { derivedMember: derived };

  const baseDeclaration = baseSymbol.declarations?.[0];
  return {
    derivedMember: derived,
    baseMember: {
      name,
      kind: baseDeclaration ? ts.SyntaxKind[baseDeclaration.kind] : 'unknown',
      type: typeString(checker, checker.getTypeOfSymbolAtLocation(baseSymbol, member), member),
      location: baseDeclaration ? declarationLocation(baseDeclaration) : undefined,
    },
  };
}

/** The leftmost identifier of an entity name: `A` of `A.B.C`. */
function rootName(name: ts.EntityName): string {
  return ts.isIdentifier(name) ? name.text : rootName(name.left);
}

/** Whether the node is the name of a type reference rather than an expression. */
function isTypeName(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current && ts.isQualifiedName(current)) current = current.parent;
  return current != null && ts.isTypeReferenceNode(current);
}

function jsDocTypeNames(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const walk = (child: ts.Node): void => {
    if (ts.isTypeReferenceNode(child)) names.add(rootName(child.typeName));
    child.forEachChild(walk);
  };
  walk(node);
  return names;
}

/**
 * Whether a JSDoc tag over the declaration the annotation belongs to writes the
 * same name, which is what makes the name documentation the migration read
 * rather than something the code itself was missing.
 */
function documentsTypeName(node: ts.Node, name: string): boolean {
  let current: ts.Node | undefined = node.parent;
  for (let depth = 0; current && !ts.isSourceFile(current) && depth < MAX_JSDOC_DEPTH; depth += 1) {
    if (ts.getJSDocTags(current).some((tag) => jsDocTypeNames(tag).has(name))) return true;
    current = current.parent;
  }
  return false;
}

/** The meanings a bare name in a type position could have resolved to. */
const NAME_MEANING = ts.SymbolFlags.Type | ts.SymbolFlags.Namespace | ts.SymbolFlags.Alias;

/** Namespaces of a symbol table, and the namespaces inside those. */
function namespacesIn(exports: ts.SymbolTable): ts.Symbol[] {
  const found: ts.Symbol[] = [];
  const walk = (table: ts.SymbolTable, depth: number): void => {
    if (depth > MAX_NAMESPACE_DEPTH) return;
    table.forEach((symbol) => {
      if ((symbol.flags & ts.SymbolFlags.Module) === 0 || !symbol.exports) return;
      found.push(symbol);
      walk(symbol.exports, depth + 1);
    });
  };
  walk(exports, 1);
  return found;
}

type TypeDeclarationFinder = (name: string) => ts.Declaration | undefined;

/**
 * Finds where the program declares a type name, for names that resolved to
 * nothing where they were written. Only module exports and namespace members
 * are searched: a global declaration would have resolved, and both of these
 * are invisible to an unqualified reference, so finding one turns "this type
 * does not exist" into "this type needs an import or a qualifier".
 */
function createTypeDeclarationFinder(
  program: ts.Program,
  checker: ts.TypeChecker,
  rootDir: string,
): TypeDeclarationFinder {
  const cache = new Map<string, ts.Declaration | undefined>();
  const namespaces = new Map<ts.SourceFile, ts.Symbol[]>();

  const declarationOf = (symbol: ts.Symbol): ts.Declaration | undefined => {
    let resolved = symbol;
    if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
      try {
        resolved = checker.getAliasedSymbol(symbol);
      } catch {
        return undefined;
      }
    }
    if ((resolved.flags & NAME_MEANING) === 0) return undefined;
    return resolved.declarations?.[0];
  };

  const findInFile = (file: ts.SourceFile, escaped: ts.__String): ts.Declaration | undefined => {
    const exports = checker.getSymbolAtLocation(file)?.exports;
    if (!exports) return undefined;
    const exported = exports.get(escaped);
    const direct = exported && declarationOf(exported);
    if (direct) return direct;

    let inNamespaces = namespaces.get(file);
    if (!inNamespaces) {
      inNamespaces = namespacesIn(exports);
      namespaces.set(file, inNamespaces);
    }
    let found: ts.Declaration | undefined;
    inNamespaces.some((namespace) => {
      const member = namespace.exports?.get(escaped);
      found = member && declarationOf(member);
      return found !== undefined;
    });
    return found;
  };

  return (name: string) => {
    if (cache.has(name)) return cache.get(name);
    const escaped = ts.escapeLeadingUnderscores(name);
    let found: ts.Declaration | undefined;
    // A declaration in the project is the one the reader can act on, so the
    // search keeps going past a dependency's until it finds one.
    program.getSourceFiles().some((file) => {
      const declaration = findInFile(file, escaped);
      if (!declaration) return false;
      if (!found) found = declaration;
      return inProject(declaration.getSourceFile().fileName, rootDir);
    });
    cache.set(name, found);
    return found;
  };
}

/** One finder per program: the names it looks up are the same across files. */
const finders = new WeakMap<ts.Program, { rootDir: string; find: TypeDeclarationFinder }>();

function typeDeclarationFinder(
  program: ts.Program,
  checker: ts.TypeChecker,
  rootDir: string,
): TypeDeclarationFinder {
  let entry = finders.get(program);
  if (!entry || entry.rootDir !== rootDir) {
    entry = { rootDir, find: createTypeDeclarationFinder(program, checker, rootDir) };
    finders.set(program, entry);
  }
  return entry.find;
}

function unresolvedNameEvidence(
  node: ts.Node,
  file: ts.SourceFile,
  checker: ts.TypeChecker,
  program: ts.Program,
  rootDir: string,
): SuppressionEvidence {
  const name = nodeText(node, file);
  const evidence: SuppressionEvidence = { unresolved: name };
  if (!isTypeName(node)) return evidence;

  evidence.unresolvedIsType = true;
  evidence.unresolvedIsDocumented = documentsTypeName(node, name);
  const declaration = typeDeclarationFinder(program, checker, rootDir)(name);
  if (!declaration) return evidence;

  return { ...evidence, ...declarationEvidence(declaration, rootDir) };
}

/** `program.getResolvedModule` reports the paths tried even on a suppressed program. */
type ResolutionReader = {
  getResolvedModule?(
    file: ts.SourceFile,
    moduleName: string,
    mode: ts.ResolutionMode,
  ): { failedLookupLocations?: readonly string[] } | undefined;
};

function moduleEvidence(
  node: ts.Node,
  file: ts.SourceFile,
  program: ts.Program,
): SuppressionEvidence {
  const specifier = nodeText(node, file);
  const evidence: SuppressionEvidence = { unresolved: specifier };
  const getResolvedModule = (program as unknown as ResolutionReader).getResolvedModule;
  if (typeof getResolvedModule !== 'function') return evidence;

  const resolved = getResolvedModule.call(program, file, specifier, undefined);
  const failedLookups = resolved?.failedLookupLocations;
  if (failedLookups?.length) evidence.failedLookups = [...failedLookups];
  return evidence;
}

type AssignabilityReader = { isTypeAssignableTo?(source: ts.Type, target: ts.Type): boolean };

type PropertyDiff = Pick<
  SuppressionEvidence,
  'missingProperties' | 'mismatchedProperties' | 'propertiesTruncated'
>;

/** Every primitive has apparent members, and diffing those describes nothing. */
function hasOwnProperties(type: ts.Type): boolean {
  return (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) !== 0;
}

function propertyDiff(
  checker: ts.TypeChecker,
  actual: ts.Type,
  expected: ts.Type,
  at: ts.Node,
): PropertyDiff {
  if (!hasOwnProperties(expected) || !hasOwnProperties(actual)) return {};
  const isAssignable = (checker as AssignabilityReader).isTypeAssignableTo;
  const expectedProperties = checker.getPropertiesOfType(expected);
  if (expectedProperties.length === 0) return {};

  const missing: string[] = [];
  const mismatched: string[] = [];
  expectedProperties.forEach((property) => {
    const actualProperty = checker.getPropertyOfType(actual, property.getName());
    if (!actualProperty) {
      missing.push(property.getName());
      return;
    }
    if (typeof isAssignable !== 'function') return;
    const from = checker.getTypeOfSymbolAtLocation(actualProperty, at);
    const to = checker.getTypeOfSymbolAtLocation(property, at);
    if (!isAssignable.call(checker, from, to)) mismatched.push(property.getName());
  });

  const truncated = missing.length > MAX_PROPERTIES || mismatched.length > MAX_PROPERTIES;
  const result: PropertyDiff = {};
  if (missing.length) result.missingProperties = missing.slice(0, MAX_PROPERTIES);
  if (mismatched.length) result.mismatchedProperties = mismatched.slice(0, MAX_PROPERTIES);
  if (truncated) result.propertiesTruncated = true;
  return result;
}

const UNKNOWN_FIX_SHAPE = 'no fix shape derived from the evidence';

/**
 * The kind of fix a site needs, so a code with many sites reads as one finding
 * rather than N. Derived from the evidence, not from the message text.
 */
export function fixShape(site: SuppressionSite): string {
  const evidence = site.evidence;
  if (!evidence) return UNKNOWN_FIX_SHAPE;

  switch (site.code) {
    case 2554: {
      const { argumentCount, requiredCount, parameters, declaredInProject } = evidence;
      if (argumentCount == null || requiredCount == null || !parameters) return UNKNOWN_FIX_SHAPE;
      if (argumentCount > parameters.length) return 'too many arguments for the signature';
      if (argumentCount >= requiredCount) return 'argument count does not match the signature';
      if (!declaredInProject) return 'too few arguments, callee declared outside the project';
      return 'too few arguments, trailing parameters could be optional';
    }
    case 2769:
      return evidence.candidateSignatures?.length
        ? 'no overload matches the arguments'
        : 'call does not match the signature';
    case 2345:
      if (evidence.missingProperties?.length) return 'argument is missing required properties';
      if (evidence.mismatchedProperties?.length) return 'argument has mismatched property types';
      return 'argument type does not match the parameter';
    case 2322:
      if (evidence.missingProperties?.length) return 'value is missing required properties';
      if (evidence.mismatchedProperties?.length) return 'value has mismatched property types';
      return 'value type does not match the declared type';
    case 2416:
    case 2425:
      return evidence.baseMember
        ? 'member does not match the base class member'
        : 'member conflicts with the base class';
    case 2304:
    case 2552:
      if (!evidence.unresolvedIsType) return 'name does not resolve';
      return evidence.declaredAt
        ? 'type name is declared elsewhere and not imported'
        : 'type name is declared nowhere';
    case 2307:
      return evidence.failedLookups?.length
        ? 'module does not resolve at any path tried'
        : 'module does not resolve';
    default:
      return UNKNOWN_FIX_SHAPE;
  }
}

function relativize(rootDir: string, fileName: string): string {
  const relative = path.relative(rootDir, fileName);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return fileName;
  return relative.split(path.sep).join('/');
}

function relativizeLocation(rootDir: string, location: SourceLocation): SourceLocation {
  return { ...location, file: relativize(rootDir, location.file) };
}

function relativizeLocated<T extends { location?: SourceLocation }>(rootDir: string, value: T): T {
  return value.location
    ? { ...value, location: relativizeLocation(rootDir, value.location) }
    : value;
}

function relativizeSite(rootDir: string, site: CollectedSite): SuppressionSite {
  const { fileName, line, column, evidence, ...rest } = site;
  return {
    ...rest,
    location: { file: relativize(rootDir, fileName), line, column },
    related: site.related.map((related) => relativizeLocated(rootDir, related)),
    evidence: evidence
      ? {
          ...evidence,
          declaredAt: evidence.declaredAt
            ? relativizeLocation(rootDir, evidence.declaredAt)
            : undefined,
          baseMember: evidence.baseMember
            ? relativizeLocated(rootDir, evidence.baseMember)
            : undefined,
          derivedMember: evidence.derivedMember
            ? relativizeLocated(rootDir, evidence.derivedMember)
            : undefined,
        }
      : undefined,
  };
}

function summarizeSuppressions(
  collected: readonly CollectedSite[],
  rootDir: string,
): SuppressionReport {
  const sites = collected.map((site) => relativizeSite(rootDir, site));

  const byCode = new Map<
    number,
    { count: number; comments: number; files: Set<string>; shapes: Map<string, number>; longest: number }
  >();
  sites.forEach((site) => {
    const group = getOrCreate(byCode, site.code, () => ({
      count: 0,
      comments: 0,
      files: new Set(),
      shapes: new Map(),
      longest: 0,
    }));
    group.count += 1;
    if (site.commented) group.comments += 1;
    group.files.add(site.location.file);
    const shape = fixShape(site);
    group.shapes.set(shape, (group.shapes.get(shape) ?? 0) + 1);
    group.longest = Math.max(group.longest, site.message.length);
  });

  const codes: SuppressionCodeGroup[] = [...byCode.entries()]
    .map(([code, group]) => ({
      code,
      count: group.count,
      comments: group.comments,
      fileCount: group.files.size,
      fixShapes: [...group.shapes.entries()]
        .map(([shape, count]) => ({ shape, count }))
        .sort((a, b) => b.count - a.count || a.shape.localeCompare(b.shape)),
      longestMessage: group.longest,
    }))
    .sort((a, b) => b.count - a.count || a.code - b.code);

  const commented = sites.filter((site) => site.commented).length;
  return {
    rootDir,
    total: sites.length,
    commented,
    sharedLine: sites.length - commented,
    fileCount: new Set(sites.map((site) => site.location.file)).size,
    codes,
    unresolvedTypes: groupUnresolvedTypes(sites),
    sites,
  };
}

/**
 * One entry per name rather than per site: the annotations come from the
 * comments, so every site of a name shares the single edit that would fix it.
 */
function groupUnresolvedTypes(sites: readonly SuppressionSite[]): UnresolvedTypeGroup[] {
  const byName = new Map<string, UnresolvedTypeGroup & { fileCounts: Map<string, number> }>();

  sites.forEach((site) => {
    const evidence = site.evidence;
    if (!evidence?.unresolvedIsType || !evidence.unresolved) return;
    const name = evidence.unresolved;
    const group = getOrCreate(byName, name, () => ({
      name,
      count: 0,
      fileCount: 0,
      files: [],
      documented: 0,
      declaredAt: evidence.declaredAt,
      declarationKind: evidence.declarationKind,
      declaredInProject: evidence.declaredInProject,
      fileCounts: new Map(),
    }));
    group.count += 1;
    if (evidence.unresolvedIsDocumented) group.documented += 1;
    const { file } = site.location;
    group.fileCounts.set(file, (group.fileCounts.get(file) ?? 0) + 1);
  });

  return [...byName.values()]
    .map(({ fileCounts, ...group }) => ({
      ...group,
      fileCount: fileCounts.size,
      files: [...fileCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([file]) => file),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function formatLocation(location: SourceLocation): string {
  return `${location.file}:${location.line}:${location.column}`;
}

function formatMember(label: string, member: SuppressionMember): string {
  const where = member.location ? ` at ${formatLocation(member.location)}` : '';
  return `${label}: ${member.name}: ${member.type} (${member.kind})${where}`;
}

function evidenceLines(evidence: SuppressionEvidence): string[] {
  const lines: string[] = [];
  if (evidence.signature) lines.push(`signature: ${evidence.signature}`);
  if (evidence.candidateSignatures) {
    evidence.candidateSignatures.forEach((candidate) => lines.push(`overload: ${candidate}`));
  }
  if (evidence.parameters?.length) {
    lines.push(
      `parameters: ${evidence.parameters
        .map((p) => `${p.rest ? '...' : ''}${p.name}${p.optional ? '?' : ''}: ${p.type}`)
        .join(', ')}`,
    );
  }
  if (evidence.argumentCount != null) {
    const required =
      evidence.requiredCount != null ? `, ${evidence.requiredCount} required` : '';
    lines.push(`arguments: ${pluralize(evidence.argumentCount, 'given')}${required}`);
  }
  if (evidence.argumentTypes?.length) {
    lines.push(`argument types: ${evidence.argumentTypes.join(', ')}`);
  }
  if (evidence.expectedType) lines.push(`expected type: ${evidence.expectedType}`);
  if (evidence.actualType) lines.push(`actual type: ${evidence.actualType}`);
  if (evidence.missingProperties?.length) {
    lines.push(`missing properties: ${evidence.missingProperties.join(', ')}`);
  }
  if (evidence.mismatchedProperties?.length) {
    lines.push(`mismatched properties: ${evidence.mismatchedProperties.join(', ')}`);
  }
  if (evidence.propertiesTruncated) {
    lines.push(`property lists capped at ${MAX_PROPERTIES} entries`);
  }
  if (evidence.declaredAt) {
    const kind = evidence.declarationKind ? ` (${evidence.declarationKind})` : '';
    const scope = evidence.declaredInProject === false ? ', outside the project' : '';
    lines.push(`declared at: ${formatLocation(evidence.declaredAt)}${kind}${scope}`);
  }
  if (evidence.baseMember) lines.push(formatMember('base member', evidence.baseMember));
  if (evidence.derivedMember) lines.push(formatMember('derived member', evidence.derivedMember));
  if (evidence.unresolved) lines.push(`unresolved: ${evidence.unresolved}`);
  if (evidence.unresolvedIsDocumented) {
    lines.push('written by a JSDoc tag over the declaration it annotates');
  }
  if (evidence.failedLookups?.length) {
    lines.push(`paths tried: ${evidence.failedLookups.length}`);
    evidence.failedLookups.slice(0, MAX_PROPERTIES).forEach((tried) => lines.push(`  ${tried}`));
  }
  return lines;
}

function siteLines(site: SuppressionSite): string[] {
  const lines: string[] = [
    `${formatLocation(site.location)}  TS${site.code}${
      site.commented ? '' : '  (shares a line with an earlier diagnostic, no comment written)'
    }`,
    `  ${site.message}`,
  ];
  site.chain.slice(1).forEach((link) => {
    lines.push(`  ${'  '.repeat(link.depth)}TS${link.code}: ${link.message}`);
  });
  site.related.forEach((related) => {
    const where = related.location ? ` (${formatLocation(related.location)})` : '';
    lines.push(`  related: ${related.message}${where}`);
  });
  if (site.evidence) {
    evidenceLines(site.evidence).forEach((line) => lines.push(`  ${line}`));
  }
  if (site.evidenceError) lines.push(`  evidence unavailable: ${site.evidenceError}`);
  return lines;
}

/** Why the name found nothing: an import away, or written by nobody. */
function unresolvedTypeCause(group: UnresolvedTypeGroup): string {
  if (!group.declaredAt) return 'nothing declares it';
  const kind = group.declarationKind ? ` (${group.declarationKind})` : '';
  const scope = group.declaredInProject === false ? ' outside the project' : '';
  return `declared at ${formatLocation(group.declaredAt)}${kind}${scope}, not in scope here`;
}

function unresolvedTypeLines(groups: readonly UnresolvedTypeGroup[]): string[] {
  const lines: string[] = ['', 'Type names that resolve to nothing:'];
  groups.forEach((group) => {
    const documented = group.documented > 0 ? `, ${group.documented} written by a comment` : '';
    lines.push(
      `  ${group.name}  ${pluralize(group.count, 'diagnostic')} in ` +
        `${pluralize(group.fileCount, 'file')}${documented}, ${unresolvedTypeCause(group)}`,
    );
    const shown = group.files.slice(0, MAX_NAME_FILES);
    const rest = group.files.length - shown.length;
    lines.push(`    ${shown.join(', ')}${rest > 0 ? `, and ${pluralize(rest, 'more file')}` : ''}`);
  });
  return lines;
}

/**
 * The whole report: the grouped findings, then one entry per diagnostic with
 * everything the compiler had at the moment ts-ignore hid it.
 */
export function formatSuppressionReport(report: SuppressionReport): string {
  const lines: string[] = [
    'ts-migrate suppression report',
    `root: ${report.rootDir}`,
    '',
    `${pluralize(report.total, 'diagnostic')} in ${pluralize(report.fileCount, 'file')} ` +
      'were suppressed.',
    `${report.commented} of them are written into a comment. ${report.sharedLine} ` +
      `${report.sharedLine === 1 ? 'shares' : 'share'} a line with an earlier diagnostic, so ` +
      'ts-ignore writes no comment for them and `ts-migrate report` cannot count them: its ' +
      'per-code totals match the "comments" column below, not the "diagnostics" column.',
    '',
    'By code:',
  ];

  report.codes.forEach((group) => {
    lines.push(
      `  TS${group.code}  ${pluralize(group.count, 'diagnostic')}, ` +
        `${group.comments} commented, ${pluralize(group.fileCount, 'file')}`,
    );
    group.fixShapes.forEach(({ shape, count }) => lines.push(`    ${count}  ${shape}`));
    lines.push(`    longest message: ${group.longestMessage} characters`);
  });

  if (report.unresolvedTypes.length > 0) {
    unresolvedTypeLines(report.unresolvedTypes).forEach((line) => lines.push(line));
  }

  lines.push('', 'Sites:');
  report.sites.forEach((site) => {
    siteLines(site).forEach((line) => lines.push(`  ${line}`));
    lines.push('');
  });

  return lines.join('\n').trimEnd();
}

/** The capped entries of one summary section, with a count of what it left out. */
function topLines<T>(
  items: readonly T[],
  render: (item: T) => string,
  moreLabel: string,
): string[] {
  const lines = items.slice(0, MAX_SUMMARY_ENTRIES).map(render);
  if (items.length > MAX_SUMMARY_ENTRIES) {
    lines.push(`    and ${pluralize(items.length - MAX_SUMMARY_ENTRIES, moreLabel)}`);
  }
  return lines;
}

/** One code and, when it has a named one, the shape most of its fixes took. */
function summaryCodeLine(group: SuppressionCodeGroup): string {
  const top = group.fixShapes[0];
  const shape = top && top.shape !== UNKNOWN_FIX_SHAPE ? ` — ${top.count} ${top.shape}` : '';
  return `    TS${group.code} x${group.count}${shape}`;
}

/** One unresolved name, its reach, and why it found nothing. */
function summaryNameLine(group: UnresolvedTypeGroup): string {
  return (
    `    ${group.name} x${group.count} in ${pluralize(group.fileCount, 'file')} — ` +
    unresolvedTypeCause(group)
  );
}

/** How many suppressions of which shape, short enough for the run log. */
export function formatSuppressionSummary(
  report: SuppressionReport,
  reportFile?: string,
): string | null {
  if (report.total === 0) return null;

  const lines = [
    `  ${pluralize(report.total, 'diagnostic')} suppressed in ` +
      `${pluralize(report.fileCount, 'file')}` +
      (report.sharedLine > 0
        ? `, ${report.sharedLine} of them sharing a line with another and left uncommented.`
        : '.'),
  ];
  lines.push(...topLines(report.codes, summaryCodeLine, 'other code'));

  const names = report.unresolvedTypes;
  if (names.length > 0) {
    const sites = names.reduce((count, group) => count + group.count, 0);
    const documented = names.filter((group) => group.documented > 0).length;
    lines.push(
      `  ${pluralize(names.length, 'type name')} in the annotations resolve to nothing, across ` +
        `${pluralize(sites, 'diagnostic')}; the comments write ${documented} of them.`,
    );
    lines.push(...topLines(names, summaryNameLine, 'other name'));
  }

  lines.push(
    reportFile
      ? `  What the compiler knew at each one is in ${reportFile}.`
      : '  Pass --suppressionReportFile <path> to record what the compiler knew at each one.',
  );
  return lines.join('\n');
}
