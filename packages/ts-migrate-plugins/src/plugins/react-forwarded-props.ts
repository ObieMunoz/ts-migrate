import ts from 'typescript';
import { errorMessage, fileNoticeReporter, Plugin } from '@obiemunoz/ts-migrate-server';
import { updateImports } from './utils/imports';
import { isNameableJsxTagName, jsxTagNameTypeArgument } from './utils/jsx-tag-names';
import updateSourceText from '../utils/updateSourceText';
import {
  applyTextChanges,
  createFileLanguageService,
  findNewErrors,
  getValidationOptions,
  TextChange,
} from '../utils/candidateValidation';

const reactModuleSpecifier = 'react';
const componentPropsName = 'ComponentProps';

// React accepts these on every element, so a component gains nothing by
// declaring them and their presence is no evidence the widening is worth it.
const reactOwnAttributes = new Set(['key', 'ref']);

interface Candidate {
  parameter: ts.ParameterDeclaration;
  declaredType: ts.TypeNode;
  /** The names the pattern binds itself, which the wrapper consumes. */
  consumed: string[];
  /** `typeof Foo` or `'div'`, the argument the forwarded props come from. */
  target: string;
}

/**
 * Widens the props of a component that forwards a rest element onto another
 * element, so that the props of that element are part of its own.
 *
 * `({ name, ...rest }: Props) => <Icon {...rest} />` accepts every prop `Icon`
 * accepts, but nothing in the file says so: propTypes describe what the
 * component reads, not what it passes on, so the type built from them rejects
 * a forwarded prop at every call site. The forwarding is the evidence, and it
 * is in the component itself rather than in the call sites, which is what
 * makes the widened type as good as the props it was widened from.
 *
 * The forwarded half is `Partial`, since the component supplies some of those
 * props itself, and omits what the pattern binds, so a prop the component
 * declares keeps the type it declares rather than intersecting with the one
 * the target declares -- an intersection of two spellings of the same prop
 * collapses to `never` and rejects both.
 */
const reactForwardedPropsPlugin: Plugin = {
  name: 'react-forwarded-props',

  run(params) {
    const { fileName, sourceFile, text, getLanguageService } = params;
    if (!/\.[jt]sx$/.test(fileName)) {
      return undefined;
    }
    const languageService = getLanguageService();
    const program = languageService.getProgram();
    const source = program && program.getSourceFile(fileName);
    if (!program || !source || source.text !== sourceFile.text) {
      return undefined;
    }

    try {
      const checker = program.getTypeChecker();
      const candidates = collectCandidates(source, checker);
      if (candidates.length === 0) {
        return undefined;
      }

      const useNamespace = hasBinding(source, 'React');
      if (!useNamespace && hasBinding(source, componentPropsName)) {
        return undefined;
      }
      const propsType = useNamespace ? `React.${componentPropsName}` : componentPropsName;

      const changes = candidates.map((candidate) =>
        annotationChange(candidate, propsType, source),
      );
      let candidateText = applyTextChanges(text, changes);
      if (!useNamespace) {
        candidateText = addComponentPropsImport(fileName, candidateText);
      }

      const compilerOptions = getValidationOptions(program.getCompilerOptions());
      const baseline = createFileLanguageService(fileName, text, compilerOptions, program);
      const candidateService = createFileLanguageService(
        fileName,
        candidateText,
        compilerOptions,
        program,
      );
      if (findNewErrors(baseline, candidateService, changes, fileName).length > 0) {
        return undefined;
      }
      return candidateText;
    } catch (e) {
      fileNoticeReporter(params, '[react-forwarded-props]')({
        reason: errorMessage(e).split('\n')[0].trim(),
        hint: 'The component keeps the props type it had; ts-ignore suppresses what callers pass on top of it.',
      });
      return undefined;
    }
  },
};

export default reactForwardedPropsPlugin;

function annotationChange(
  candidate: Candidate,
  propsType: string,
  source: ts.SourceFile,
): TextChange {
  const forwarded = `Partial<${propsType}<${candidate.target}>>`;
  const omitted = candidate.consumed.map((name) => `'${name}'`).join(' | ');
  const addition = omitted ? `Omit<${forwarded}, ${omitted}>` : forwarded;
  const declared = candidate.declaredType.getText(source);
  const existing = needsParentheses(candidate.declaredType) ? `(${declared})` : declared;
  return {
    start: candidate.declaredType.getStart(source),
    length: candidate.declaredType.end - candidate.declaredType.getStart(source),
    text: `${existing} & ${addition}`,
  };
}

function needsParentheses(type: ts.TypeNode): boolean {
  return (
    ts.isUnionTypeNode(type) ||
    ts.isFunctionTypeNode(type) ||
    ts.isConstructorTypeNode(type) ||
    ts.isConditionalTypeNode(type) ||
    ts.isInferTypeNode(type)
  );
}

function addComponentPropsImport(fileName: string, candidateText: string): string {
  const updated = ts.createSourceFile(
    fileName,
    candidateText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const updates = updateImports(
    updated,
    [{ namedImport: componentPropsName, moduleSpecifier: reactModuleSpecifier }],
    [],
  );
  return updates.length > 0 ? updateSourceText(candidateText, updates) : candidateText;
}

function hasBinding(source: ts.SourceFile, name: string): boolean {
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if (ts.isIdentifier(node) && node.text === name) {
      found = true;
      return;
    }
    node.forEachChild(visit);
  };
  source.forEachChild(visit);
  return found;
}

function collectCandidates(source: ts.SourceFile, checker: ts.TypeChecker): Candidate[] {
  const candidates: Candidate[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isArrowFunction(node) || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) {
      const candidate = candidateFor(node, checker);
      if (candidate) candidates.push(candidate);
    }
    node.forEachChild(visit);
  };
  source.forEachChild(visit);
  return candidates;
}

function candidateFor(
  fn: ts.FunctionLikeDeclaration,
  checker: ts.TypeChecker,
): Candidate | undefined {
  const parameter = fn.parameters[0];
  if (!parameter || !parameter.type || !ts.isObjectBindingPattern(parameter.name)) {
    return undefined;
  }
  const declared = checker.getTypeFromTypeNode(parameter.type);
  if (!isObjectLike(declared)) {
    return undefined;
  }
  const rest = parameter.name.elements.find((element) => element.dotDotDotToken);
  if (!rest || !ts.isIdentifier(rest.name) || !fn.body) {
    return undefined;
  }

  const spreads = spreadTargets(fn.body, rest.name.text);
  const target = onlyTarget(spreads);
  if (!target) {
    return undefined;
  }
  if (containsNode(fn, targetDeclaration(target.tagName, checker))) {
    return undefined;
  }

  const forwarded = checker.getContextualType(target.attributes);
  if (!forwarded || forwarded.flags & ts.TypeFlags.Any) {
    return undefined;
  }
  const consumed = parameter.name.elements
    .filter((element) => !element.dotDotDotToken)
    .map((element) => propertyKey(element))
    .filter((name): name is string => name != null);
  const declaredNames = new Set(checker.getPropertiesOfType(declared).map((s) => s.getName()));
  consumed.forEach((name) => declaredNames.add(name));
  const gained = checker
    .getPropertiesOfType(forwarded)
    .filter((property) => !declaredNames.has(property.getName()))
    .filter((property) => !reactOwnAttributes.has(property.getName()));
  if (gained.length === 0) {
    return undefined;
  }

  return {
    parameter,
    declaredType: parameter.type,
    consumed,
    target: jsxTagNameTypeArgument(target.tagName),
  };
}

function propertyKey(element: ts.BindingElement): string | undefined {
  const key = element.propertyName ?? element.name;
  return ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : undefined;
}

function isObjectLike(type: ts.Type): boolean {
  if (type.isUnion()) {
    return type.types.every(isObjectLike);
  }
  return (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) !== 0;
}

type SpreadTarget = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

function spreadTargets(body: ts.Node, restName: string): SpreadTarget[] {
  const targets: SpreadTarget[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isJsxSpreadAttribute(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === restName
    ) {
      const element = node.parent.parent;
      if (ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)) {
        targets.push(element);
      }
    }
    node.forEachChild(visit);
  };
  body.forEachChild(visit);
  return targets;
}

// A rest element spread onto more than one kind of element has to satisfy all
// of them at once, and intersecting their props collapses every prop they
// spell differently. Only one target is evidence this pass can act on.
function onlyTarget(targets: SpreadTarget[]): SpreadTarget | undefined {
  if (targets.length === 0) {
    return undefined;
  }
  const first = targets[0];
  const name = first.tagName.getText();
  const sameTag = targets.every((target) => target.tagName.getText() === name);
  return sameTag && isNameableJsxTagName(first.tagName) ? first : undefined;
}

function targetDeclaration(
  tagName: ts.JsxTagNameExpression,
  checker: ts.TypeChecker,
): ts.Node | undefined {
  const symbol = checker.getSymbolAtLocation(tagName);
  return symbol && symbol.declarations && symbol.declarations[0];
}

function containsNode(container: ts.Node, node: ts.Node | undefined): boolean {
  if (!node || node.getSourceFile() !== container.getSourceFile()) {
    return false;
  }
  const statement = enclosingStatement(container);
  return node.getStart() >= statement.getStart() && node.end <= statement.end;
}

function enclosingStatement(node: ts.Node): ts.Node {
  let current: ts.Node = node;
  while (current.parent && !ts.isSourceFile(current.parent)) {
    current = current.parent;
  }
  return current;
}
