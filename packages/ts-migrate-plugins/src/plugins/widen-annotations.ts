import ts from 'typescript';
import { errorMessage, fileNoticeReporter, Plugin } from '@obiemunoz/ts-migrate-server';
import { isDiagnosticWithLinePosition } from '../utils/type-guards';
import {
  applyTextChanges,
  createFileLanguageService,
  findNewErrors,
  getValidationOptions,
  TextChange,
  toCandidatePos,
} from '../utils/candidateValidation';
import { DEFAULT_MAX_UNION_MEMBERS, printType } from '../utils/typePrinter';
import { createValidate, Properties } from '../utils/validateOptions';

export interface Options {
  /** Union members an annotation may end up with before it is left alone. */
  maxUnionMembers?: number;
}

const maxUnionMembersProperty: Properties = {
  maxUnionMembers: { type: 'integer', minimum: 2 },
};

// Assignability errors an annotation can absorb. The call argument codes
// (2345, 2554, 2555, 2559, 2769) are deliberately absent: infer-types routes
// improper callers to ts-ignore rather than widening the signature they
// disagree with, and widening a parameter here would undo that.
const assignmentDiagnosticCodes = new Set([
  // Type '{0}' is not assignable to type '{1}'.
  2322,
  // Type '{0}' is not assignable to type '{1}' with 'exactOptionalPropertyTypes: true'.
  2412,
  // Type '{0}' is missing the following properties from type '{1}': {2}
  2739, 2740, 2741,
]);

// Validation programs one file may build before the widenings still unproven
// are left for ts-ignore.
const maxValidationPrograms = 12;

/** The declaration kinds whose annotation this plugin rewrites. */
type WidenableDeclaration =
  | ts.VariableDeclaration
  | ts.PropertyDeclaration
  | ts.PropertySignature
  | ts.SignatureDeclaration;

/** One annotation, the diagnostics blaming it, and what would go into it. */
interface Candidate {
  declaration: WidenableDeclaration;
  change: TextChange;
  diagnostics: ts.DiagnosticWithLocation[];
}

/**
 * Widens the annotations that assignments in the same file contradict, so a
 * `let x: number` later assigned null reads `number | null` instead of taking
 * a suppression.
 *
 * Nothing is written on the strength of the checker alone. Each widening is
 * spliced into a copy of the file and kept only when the errors it was meant
 * to absorb are gone and no new error appeared, so a widening that merely
 * moves the problem is discarded and the annotation stays as it was. The
 * types themselves come from the shared printer, which refuses anything that
 * would need a new import, an anonymous shape, type arguments, or `any`: an
 * annotation that is confidently wrong type checks everywhere and misleads,
 * where the error it replaced was at least visible.
 */
const widenAnnotationsPlugin: Plugin<Options> = {
  name: 'widen-annotations',

  run(params) {
    const { fileName, sourceFile, getLanguageService, options } = params;
    const languageService = getLanguageService();
    const diagnostics = languageService
      .getSemanticDiagnostics(fileName)
      .filter(isDiagnosticWithLinePosition)
      .filter((diagnostic) => assignmentDiagnosticCodes.has(diagnostic.code));
    if (diagnostics.length === 0) {
      return undefined;
    }

    const program = languageService.getProgram();
    const source = program && program.getSourceFile(fileName);
    if (!program || !source || source.text !== sourceFile.text) {
      return undefined;
    }

    try {
      const maxUnionMembers = options.maxUnionMembers ?? DEFAULT_MAX_UNION_MEMBERS;
      const candidates = collectCandidates(
        program.getTypeChecker(),
        source,
        diagnostics,
        maxUnionMembers,
      );
      if (candidates.length === 0) {
        return undefined;
      }

      const accepted = provenCandidates(
        fileName,
        source.text,
        getValidationOptions(program.getCompilerOptions()),
        candidates,
      );
      if (accepted.length === 0) {
        return undefined;
      }
      return applyTextChanges(
        source.text,
        accepted.map((candidate) => candidate.change),
      );
    } catch (e) {
      fileNoticeReporter(params, '[widen-annotations]')({
        reason: errorMessage(e).split('\n')[0].trim(),
        hint: 'The file keeps the annotations it had; ts-ignore suppresses the errors they cause.',
      });
      return undefined;
    }
  },

  validate: createValidate<Options>(maxUnionMembersProperty),
};

export default widenAnnotationsPlugin;

/** The declaration an assignability error blames, and the type it assigned. */
interface Site {
  declaration: WidenableDeclaration;
  assigned: ts.Type;
}

function collectCandidates(
  checker: ts.TypeChecker,
  source: ts.SourceFile,
  diagnostics: ts.DiagnosticWithLocation[],
  maxUnionMembers: number,
): Candidate[] {
  const byDeclaration = new Map<WidenableDeclaration, { types: ts.Type[]; blamed: ts.DiagnosticWithLocation[] }>();

  diagnostics.forEach((diagnostic) => {
    const node = findNodeAtSpan(source, diagnostic.start, diagnostic.length);
    const site = node && resolveSite(checker, node, source);
    if (!site) return;
    let group = byDeclaration.get(site.declaration);
    if (!group) {
      group = { types: [], blamed: [] };
      byDeclaration.set(site.declaration, group);
    }
    group.types.push(site.assigned);
    group.blamed.push(diagnostic);
  });

  const candidates: Candidate[] = [];
  byDeclaration.forEach(({ types, blamed }, declaration) => {
    const change = widenChange(checker, source, declaration, types, maxUnionMembers);
    if (change) candidates.push({ declaration, change, diagnostics: blamed });
  });
  return candidates.sort((a, b) => a.change.start - b.change.start);
}

/**
 * Builds the replacement annotation: the members the declaration already has,
 * then whatever the contradicting assignments add. Literals are widened to
 * their base type, since a mutable declaration that took `"a"` once will take
 * another string next.
 */
function widenChange(
  checker: ts.TypeChecker,
  source: ts.SourceFile,
  declaration: WidenableDeclaration,
  assigned: ts.Type[],
  maxUnionMembers: number,
): TextChange | undefined {
  const printOptions = { maxUnionMembers, widenLiterals: true };
  const annotation = annotationOf(declaration, source);
  if (!annotation) return undefined;

  const added: string[] = [];
  for (const type of assigned) {
    const printedType = printType(checker, type, declaration, printOptions);
    if (!printedType.printable) return undefined;
    printedType.members.forEach((member) => {
      if (!annotation.members.includes(member) && !added.includes(member)) added.push(member);
    });
  }
  if (added.length === 0) return undefined;
  if (annotation.members.length + added.length > maxUnionMembers) return undefined;

  return {
    start: annotation.start,
    length: annotation.length,
    text: [annotation.text, ...added].join(' | '),
  };
}

/** The annotation to replace, as text and as its top level union members. */
interface Annotation {
  start: number;
  length: number;
  /** Source text, parenthesized where a union cannot hold it as it stands. */
  text: string;
  members: string[];
}

/**
 * A declaration with no annotation is left alone: there is nothing to widen,
 * and writing the inferred type out is a different edit from widening a
 * contract the author stated.
 */
function annotationOf(
  declaration: WidenableDeclaration,
  source: ts.SourceFile,
): Annotation | undefined {
  const typeNode = declaration.type;
  if (!typeNode) return undefined;
  const start = typeNode.getStart(source);
  const text = source.text.slice(start, typeNode.end);
  return {
    start,
    length: typeNode.end - start,
    text: needsParentheses(typeNode) ? `(${text})` : text,
    members: unionMemberTexts(typeNode, source),
  };
}

/** Type forms a union cannot hold without parentheses. */
function needsParentheses(typeNode: ts.TypeNode): boolean {
  return (
    ts.isFunctionTypeNode(typeNode) ||
    ts.isConstructorTypeNode(typeNode) ||
    ts.isConditionalTypeNode(typeNode) ||
    ts.isInferTypeNode(typeNode)
  );
}

function unionMemberTexts(typeNode: ts.TypeNode, source: ts.SourceFile): string[] {
  const members = ts.isUnionTypeNode(typeNode) ? typeNode.types : [typeNode];
  return members.map((member) => source.text.slice(member.getStart(source), member.end).trim());
}

function resolveSite(
  checker: ts.TypeChecker,
  node: ts.Node,
  source: ts.SourceFile,
): Site | undefined {
  if (ts.isReturnStatement(node)) {
    return returnSite(checker, node, source);
  }

  const { parent } = node;
  if (!parent) return undefined;

  if (ts.isVariableDeclaration(parent) && parent.name === node && parent.initializer) {
    return site(checker, parent, parent.initializer, source);
  }
  if (ts.isPropertyDeclaration(parent) && parent.name === node && parent.initializer) {
    return site(checker, parent, parent.initializer, source);
  }
  if (ts.isPropertyAssignment(parent) && parent.name === node) {
    const declaration = contextualProperty(checker, parent);
    return declaration && site(checker, declaration, parent.initializer, source);
  }
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
    if (parent.left !== node) return undefined;
    const declaration = assignedDeclaration(checker, node);
    return declaration && site(checker, declaration, parent.right, source);
  }
  return undefined;
}

function site(
  checker: ts.TypeChecker,
  declaration: WidenableDeclaration,
  assignedFrom: ts.Expression,
  source: ts.SourceFile,
): Site | undefined {
  if (declaration.getSourceFile() !== source) return undefined;
  return { declaration, assigned: checker.getTypeAtLocation(assignedFrom) };
}

/**
 * The annotated function a `return` belongs to. Async and generator bodies
 * return through a wrapper the annotation names, so widening the annotation
 * would not be what the returned value contradicts.
 */
function returnSite(
  checker: ts.TypeChecker,
  statement: ts.ReturnStatement,
  source: ts.SourceFile,
): Site | undefined {
  if (!statement.expression) return undefined;
  let current: ts.Node | undefined = statement.parent;
  while (current && !ts.isFunctionLike(current)) {
    current = current.parent;
  }
  if (!current || !current.type) return undefined;
  if (isGenerator(current) || isAsync(current)) return undefined;
  return site(checker, current, statement.expression, source);
}

function isGenerator(node: ts.SignatureDeclaration): boolean {
  return (
    (ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isMethodDeclaration(node)) &&
    node.asteriskToken != null
  );
}

function isAsync(node: ts.SignatureDeclaration): boolean {
  return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Async) !== 0;
}

/** The member a contextually typed object literal property is checked against. */
function contextualProperty(
  checker: ts.TypeChecker,
  property: ts.PropertyAssignment,
): WidenableDeclaration | undefined {
  const contextualType = checker.getContextualType(property.parent);
  if (!contextualType || !ts.isIdentifier(property.name)) return undefined;
  const symbol = checker.getPropertyOfType(contextualType, property.name.text);
  return symbol && widenable(symbol.declarations?.[0]);
}

/** The declaration an assignment target resolves to, parameters excluded. */
function assignedDeclaration(
  checker: ts.TypeChecker,
  target: ts.Node,
): WidenableDeclaration | undefined {
  const symbol = checker.getSymbolAtLocation(target);
  const declarations = symbol?.declarations;
  if (!declarations || declarations.length !== 1) return undefined;
  return widenable(declarations[0]);
}

/**
 * Parameters are excluded everywhere: a parameter property widened from a
 * method body would change the constructor signature, and a plain parameter
 * reassigned in its body is the case infer-types leaves to ts-ignore.
 */
function widenable(declaration: ts.Declaration | undefined): WidenableDeclaration | undefined {
  if (!declaration) return undefined;
  if (
    ts.isVariableDeclaration(declaration) ||
    ts.isPropertyDeclaration(declaration) ||
    ts.isPropertySignature(declaration)
  ) {
    return declaration;
  }
  return undefined;
}

/** Innermost node whose span contains the diagnostic's. */
function findNodeAtSpan(source: ts.SourceFile, start: number, length: number): ts.Node | undefined {
  const end = start + length;
  let best: ts.Node | undefined;
  const visit = (node: ts.Node): void => {
    if (node.getStart(source) > start || end > node.getEnd()) return;
    if (!best || node.getEnd() - node.getStart(source) <= best.getEnd() - best.getStart(source)) {
      best = node;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(source, visit);
  return best;
}

/**
 * The widenings that survive re-checking: the whole set first, which is one
 * program for the common file, and otherwise one accumulated set at a time so
 * that whatever is returned has been proven together.
 */
function provenCandidates(
  fileName: string,
  text: string,
  compilerOptions: ts.CompilerOptions,
  candidates: Candidate[],
): Candidate[] {
  const baseline = createFileLanguageService(fileName, text, compilerOptions);
  const baselineSyntacticCount = baseline.getSyntacticDiagnostics(fileName).length;
  let programsLeft = maxValidationPrograms;

  const isProven = (group: Candidate[]): boolean => {
    if (programsLeft <= 0) return false;
    programsLeft -= 1;
    const changes = group.map((candidate) => candidate.change);
    const candidate = createFileLanguageService(
      fileName,
      applyTextChanges(text, changes),
      compilerOptions,
    );
    if (candidate.getSyntacticDiagnostics(fileName).length !== baselineSyntacticCount) return false;
    if (findNewErrors(baseline, candidate, changes, fileName).length > 0) return false;
    return absorbed(candidate, fileName, group, changes);
  };

  if (isProven(candidates)) return candidates;
  if (candidates.length === 1) return [];

  const accepted: Candidate[] = [];
  candidates.forEach((candidate) => {
    if (isProven([...accepted, candidate])) accepted.push(candidate);
  });
  return accepted;
}

/**
 * Whether every error the widenings were made for is gone. Without this a
 * widening that changed nothing about the assignment, or one that merely moved
 * the error onto a line the baseline already had an error on, would count as
 * proven.
 */
function absorbed(
  service: ts.LanguageService,
  fileName: string,
  candidates: Candidate[],
  changes: TextChange[],
): boolean {
  const remaining = new Set(
    service
      .getSemanticDiagnostics(fileName)
      .filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
      .map((diagnostic) => `${diagnostic.code}:${diagnostic.start}`),
  );
  return candidates.every((candidate) =>
    candidate.diagnostics.every(
      (diagnostic) =>
        !remaining.has(`${diagnostic.code}:${toCandidatePos(diagnostic.start, changes)}`),
    ),
  );
}
