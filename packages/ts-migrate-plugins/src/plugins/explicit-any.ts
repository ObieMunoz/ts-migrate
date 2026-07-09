import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import { isDiagnosticWithLinePosition } from '../utils/type-guards';
import updateSourceText, { SourceTextUpdate } from '../utils/updateSourceText';
import { AnyAliasOptions, validateAnyAliasOptions } from '../utils/validateOptions';

type Options = AnyAliasOptions;

const explicitAnyPlugin: Plugin<Options> = {
  name: 'explicit-any',

  run({ options, fileName, sourceFile, getLanguageService }) {
    const diagnostics = getLanguageService()
      .getSemanticDiagnostics(fileName)
      .filter(isDiagnosticWithLinePosition)
      .filter((d) => d.category === ts.DiagnosticCategory.Error);
    return withExplicitAny(sourceFile, diagnostics, options.anyAlias, getLanguageService);
  },

  validate: validateAnyAliasOptions,
};

export default explicitAnyPlugin;

function withExplicitAny(
  sourceFile: ts.SourceFile,
  diagnostics: ts.DiagnosticWithLocation[],
  anyAlias: string | undefined,
  getLanguageService: () => ts.LanguageService,
): string {
  const anyType = anyAlias ?? 'any';
  const updates: SourceTextUpdate[] = [];
  const seen = new Set<string>();
  const insert = (index: number, text: string) => {
    const key = `${index}:${text}`;
    if (!seen.has(key)) {
      seen.add(key);
      updates.push({ kind: 'insert', index, text });
    }
  };

  diagnostics.forEach((diagnostic) => {
    switch (diagnostic.code) {
      // TS2683: "'this' implicitly has type 'any' because it does not have a type annotation."
      case 2683:
        annotateThis(sourceFile, diagnostic, anyType, insert);
        break;
      // TS7006: "Parameter '{0}' implicitly has an '{1}' type."
      // TS7008: "Member '{0}' implicitly has an '{1}' type."
      case 7006:
      case 7008:
        annotateIdentifierDeclaration(sourceFile, diagnostic, anyType, insert);
        break;
      // TS7019: "Rest parameter '{0}' implicitly has an 'any[]' type."
      case 7019:
        annotateRestParameter(sourceFile, diagnostic, anyType, insert);
        break;
      // TS7031: "Binding element '{0}' implicitly has an '{1}' type."
      case 7031:
        annotateBindingPattern(sourceFile, diagnostic, anyType, insert);
        break;
      // TS2339: "Property '{0}' does not exist on type '{1}'."
      // On TS5, destructuring a missing property from a known type (e.g. `= {}`)
      // is reported as TS2339 instead of TS7031. Only binding-pattern keys are
      // matched, so member-access errors (e.g. `a.b`) are ignored.
      case 2339:
        annotateDestructuredKey(sourceFile, diagnostic, anyType, insert);
        break;
      // TS7034: "Variable '{0}' implicitly has type '{1}' in some locations where its type cannot be determined."
      case 7034:
        annotateVariable(sourceFile, diagnostic, anyType, insert);
        break;
      // TS2459: "Type '{0}' has no property '{1}' and no string index signature."
      case 2459:
        annotateEmptyObjectParameter(sourceFile, diagnostic, anyType, insert, getLanguageService);
        break;
      // TS2525: "Initializer provides no value for this binding element and the binding element has no default value."
      case 2525:
        annotateDefaultedPattern(sourceFile, diagnostic, anyType, insert);
        break;
      default:
        break;
    }
  });

  return updateSourceText(sourceFile.text, updates);
}

type Insert = (index: number, text: string) => void;

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

function annotateThis(
  sourceFile: ts.SourceFile,
  diagnostic: ts.DiagnosticWithLocation,
  anyType: string,
  insert: Insert,
) {
  const node = findNodeAtSpan(sourceFile, diagnostic);
  if (!node || node.kind !== ts.SyntaxKind.ThisKeyword) return;

  // Find the containing function declaration/expression. Arrow functions
  // cannot declare `this`, so climb past them.
  let fn: ts.Node | undefined = node.parent;
  while (fn && !ts.isFunctionDeclaration(fn) && !ts.isFunctionExpression(fn)) {
    fn = fn.parent;
  }
  if (!fn) return;

  const { parameters } = fn as ts.FunctionLikeDeclaration;
  insert(parameters.pos, parameters.length > 0 ? `this: ${anyType}, ` : `this: ${anyType}`);
}

function annotateIdentifierDeclaration(
  sourceFile: ts.SourceFile,
  diagnostic: ts.DiagnosticWithLocation,
  anyType: string,
  insert: Insert,
) {
  const node = findNodeAtSpan(sourceFile, diagnostic);
  if (!node || !ts.isIdentifier(node)) return;
  const parent = node.parent as ts.Node;

  if (ts.isParameter(parent) && parent.name === node && parent.type == null) {
    const fn = parent.parent;
    if (ts.isArrowFunction(fn) && fn.parameters.length === 1 && !hasParentheses(fn, sourceFile)) {
      insert(node.getStart(sourceFile), '(');
      insert(node.end, `: ${anyType})`);
    } else {
      insert(node.end, `: ${anyType}`);
    }
  } else if (
    (ts.isPropertySignature(parent) || ts.isPropertyDeclaration(parent)) &&
    parent.name === node &&
    parent.type == null
  ) {
    insert((parent.questionToken ?? node).end, `: ${anyType}`);
  }
}

function hasParentheses(fn: ts.ArrowFunction, sourceFile: ts.SourceFile): boolean {
  return fn.getChildren(sourceFile).some((c) => c.kind === ts.SyntaxKind.OpenParenToken);
}

function annotateRestParameter(
  sourceFile: ts.SourceFile,
  diagnostic: ts.DiagnosticWithLocation,
  anyType: string,
  insert: Insert,
) {
  const node = findNodeAtSpan(sourceFile, diagnostic);
  if (!node || !ts.isParameter(node) || node.dotDotDotToken == null || node.type != null) return;
  insert(node.name.end, `: ${anyType}[]`);
}

/**
 * Climbs to the outermost enclosing binding pattern, crossing binding elements
 * (which cover object properties, rest elements, and defaults). Annotations
 * are only valid on the outermost pattern, not on nested binding elements.
 */
function getOutermostPattern(node: ts.Node): ts.BindingPattern | undefined {
  let pattern: ts.BindingPattern | undefined;
  let cur: ts.Node | undefined = node;
  while (cur && (ts.isBindingElement(cur) || isBindingPattern(cur))) {
    if (isBindingPattern(cur)) pattern = cur;
    cur = cur.parent;
  }
  return pattern;
}

function isBindingPattern(node: ts.Node): node is ts.BindingPattern {
  return ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node);
}

function annotatePattern(pattern: ts.BindingPattern, anyType: string, insert: Insert) {
  const decl = pattern.parent;
  if ((ts.isParameter(decl) || ts.isVariableDeclaration(decl)) && decl.type == null) {
    insert(pattern.end, `: ${anyType}`);
  }
}

function annotateBindingPattern(
  sourceFile: ts.SourceFile,
  diagnostic: ts.DiagnosticWithLocation,
  anyType: string,
  insert: Insert,
) {
  let node = findNodeAtSpan(sourceFile, diagnostic);
  if (!node) return;
  if (ts.isIdentifier(node) && ts.isBindingElement(node.parent)) node = node.parent;
  if (!ts.isBindingElement(node)) return;

  const pattern = getOutermostPattern(node);
  if (pattern) annotatePattern(pattern, anyType, insert);
}

function annotateDestructuredKey(
  sourceFile: ts.SourceFile,
  diagnostic: ts.DiagnosticWithLocation,
  anyType: string,
  insert: Insert,
) {
  const node = findNodeAtSpan(sourceFile, diagnostic);
  if (!node || !ts.isIdentifier(node)) return;
  const element = node.parent;
  if (!ts.isBindingElement(element) || !ts.isObjectBindingPattern(element.parent)) return;
  // Only property keys are matched.
  const isKey = element.propertyName != null ? element.propertyName === node : element.name === node;
  if (!isKey) return;

  const pattern = getOutermostPattern(element);
  if (pattern) annotatePattern(pattern, anyType, insert);
}

function annotateVariable(
  sourceFile: ts.SourceFile,
  diagnostic: ts.DiagnosticWithLocation,
  anyType: string,
  insert: Insert,
) {
  const node = findNodeAtSpan(sourceFile, diagnostic);
  if (!node || !ts.isIdentifier(node)) return;
  const decl = node.parent;
  if (ts.isVariableDeclaration(decl) && decl.name === node && decl.type == null) {
    insert(node.end, `: ${anyType}`);
  }
}

function annotateEmptyObjectParameter(
  sourceFile: ts.SourceFile,
  diagnostic: ts.DiagnosticWithLocation,
  anyType: string,
  insert: Insert,
  getLanguageService: () => ts.LanguageService,
) {
  const node = findNodeAtSpan(sourceFile, diagnostic);
  if (!node || !ts.isIdentifier(node)) return;

  // The error is on the left hand side of a variable declaration; the fix
  // belongs on the parameter the right hand side identifier refers to.
  let decl: ts.Node | undefined = node.parent;
  while (decl && !ts.isVariableDeclaration(decl)) {
    decl = decl.parent;
  }
  if (!decl || !ts.isVariableDeclaration(decl)) return;
  const init = decl.initializer;
  if (!init || !ts.isIdentifier(init)) return;

  const program = getLanguageService().getProgram?.();
  if (!program) return;
  const symbol = program.getTypeChecker().getSymbolAtLocation(init);
  const binding = symbol?.valueDeclaration;
  if (
    binding != null &&
    ts.isParameter(binding) &&
    ts.isIdentifier(binding.name) &&
    binding.type == null &&
    binding.initializer != null &&
    ts.isObjectLiteralExpression(binding.initializer) &&
    binding.initializer.properties.length === 0
  ) {
    insert(binding.name.end, `: ${anyType}`);
  }
}

function annotateDefaultedPattern(
  sourceFile: ts.SourceFile,
  diagnostic: ts.DiagnosticWithLocation,
  anyType: string,
  insert: Insert,
) {
  const node = findNodeAtSpan(sourceFile, diagnostic);
  if (!node || !ts.isIdentifier(node) || !ts.isBindingElement(node.parent)) return;
  const pattern = node.parent.parent;
  // To prevent annotating an object destructuring pattern nested inside
  // another one, require the pattern to sit directly on the declaration.
  if (ts.isObjectBindingPattern(pattern)) annotatePattern(pattern, anyType, insert);
}
