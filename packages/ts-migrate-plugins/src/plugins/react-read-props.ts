import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import { collectIdentifiers } from './utils/identifiers';
import getTokenAtPosition from './utils/token-pos';
import {
  AnnotationGroup,
  annotationGroup,
  applyProvenAdditions,
} from '../utils/annotationAdditions';
import {
  aliasedSymbol,
  attributeValue,
  isClosedType,
  isMigratableFile,
  literalMember,
  propsAnnotationOf,
  propsAnnotationOfFunction,
  propsAnnotationOfTag,
} from '../utils/componentProps';
import { DEFAULT_MAX_UNION_MEMBERS, printType } from '../utils/typePrinter';
import { createValidate, Properties } from '../utils/validateOptions';

export interface Options {
  maxUnionMembers?: number;
}

const optionProperties: Properties = {
  maxUnionMembers: { type: 'integer', minimum: 2 },
};

interface PlannedFile {
  text: string;
  groups: AnnotationGroup[];
}

interface Pass {
  files: Map<string, PlannedFile>;
  known: Set<string>;
  served: Set<string>;
}

let currentPass: Pass | undefined;

/**
 * Declares the props a component reads but does not say it takes.
 *
 * propTypes describe what callers are expected to pass, so a prop that only
 * ever arrives through a spread, a wrapper or a container is absent from the
 * type built from them, and every read of it inside the component reports
 * TS2339.
 *
 * A prop is declared only where the project proves a type for it: the value a
 * call site passes, the member of an object a call site spreads, the element the
 * component spreads it onto, or the parameter it is handed to. A prop whose type
 * nothing proves keeps its suppression, which is the better of the two: an `any`
 * member would invent a contract every future call site is then held to, and
 * would give up the excess-property error those call sites report today, while
 * the suppression withdraws itself the day something declares the prop.
 *
 * Only the props of a component are touched, and only where the checker agrees
 * the declared type lacks the name. A read TypeScript has a near-miss
 * suggestion for (TS2551) is left alone: a name one letter off a declared one
 * is a typo, and declaring it would bury the defect it reports.
 */
const reactReadPropsPlugin: Plugin<Options> = {
  name: 'react-read-props',

  run({ fileName, text, options, getLanguageService }) {
    const languageService = getLanguageService();
    if (!currentPass || currentPass.served.has(fileName) || !currentPass.known.has(fileName)) {
      currentPass = plan(languageService, options.maxUnionMembers ?? DEFAULT_MAX_UNION_MEMBERS);
    }
    currentPass.served.add(fileName);

    const planned = currentPass.files.get(fileName);
    if (!planned || planned.text !== text) {
      return undefined;
    }
    return applyProvenAdditions(fileName, text, planned.groups, languageService);
  },

  validate: createValidate<Options>(optionProperties),
};

export default reactReadPropsPlugin;

const missingPropertyCode = 2339;

function plan(languageService: ts.LanguageService, maxUnionMembers: number): Pass {
  const pass: Pass = { files: new Map(), known: new Set(), served: new Set() };
  const program = languageService.getProgram();
  if (!program) return pass;
  const checker = program.getTypeChecker();

  const files: ts.SourceFile[] = [];
  program.getSourceFiles().forEach((file) => {
    if (!isMigratableFile(file)) return;
    pass.known.add(file.fileName);
    files.push(file);
  });

  const sites = collectCallSites(files, checker);
  const needed = new Map<ts.TypeNode, Map<string, ts.Node[]>>();
  files.forEach((file) => {
    languageService.getSemanticDiagnostics(file.fileName).forEach((diagnostic) => {
      if (diagnostic.code !== missingPropertyCode || diagnostic.start == null) return;
      const read = readAt(file, diagnostic.start, checker);
      if (!read) return;
      const annotation = propsAnnotationForRead(read, checker);
      if (!annotation || (!sites.has(annotation) && !isClassProps(annotation))) return;
      const declared = checker.getTypeFromTypeNode(annotation);
      if (!isClosedType(checker, declared) || checker.getPropertyOfType(declared, read.name)) return;
      let props = needed.get(annotation);
      if (!props) {
        props = new Map();
        needed.set(annotation, props);
      }
      props.set(read.name, [...(props.get(read.name) ?? []), ...read.uses]);
    });
  });

  const groupsByFile = new Map<string, AnnotationGroup[]>();
  needed.forEach((props, annotation) => {
    const members: string[] = [];
    props.forEach((uses, name) => {
      const type = memberType(
        checker,
        annotation,
        sites.get(annotation) ?? [],
        name,
        uses,
        maxUnionMembers,
      );
      if (type) members.push(`${name}?: ${type}`);
    });
    if (members.length === 0) return;
    const { fileName } = annotation.getSourceFile();
    const group = annotationGroup(annotation, members);
    const forFile = groupsByFile.get(fileName);
    if (forFile) {
      forFile.push(group);
    } else {
      groupsByFile.set(fileName, [group]);
    }
  });

  groupsByFile.forEach((groups, fileName) => {
    const source = program.getSourceFile(fileName);
    if (!source) return;
    pass.files.set(fileName, {
      text: source.text,
      groups: groups.sort((a, b) => a.start - b.start),
    });
  });
  return pass;
}

type CallSite = ts.JsxOpeningElement | ts.JsxSelfClosingElement;

/**
 * The JSX that renders each props annotation in the project. Resolving the tag
 * rather than looking for references to the component covers the wrappers a
 * component is exported through, since the walk from the tag ends at the same
 * annotation either way.
 */
function collectCallSites(
  files: ts.SourceFile[],
  checker: ts.TypeChecker,
): Map<ts.TypeNode, CallSite[]> {
  const byAnnotation = new Map<ts.TypeNode, CallSite[]>();
  const byTagSymbol = new Map<ts.Symbol, ts.TypeNode | undefined>();
  files.forEach((file) => {
    if (!/\.[jt]sx$/.test(file.fileName)) return;
    const visit = (node: ts.Node) => {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        isComponentTag(node.tagName)
      ) {
        const symbol = aliasedSymbol(checker.getSymbolAtLocation(node.tagName), checker);
        if (symbol) {
          if (!byTagSymbol.has(symbol)) {
            byTagSymbol.set(symbol, propsAnnotationOfTag(node.tagName, checker));
          }
          const annotation = byTagSymbol.get(symbol);
          if (annotation) {
            const existing = byAnnotation.get(annotation);
            if (existing) {
              existing.push(node);
            } else {
              byAnnotation.set(annotation, [node]);
            }
          }
        }
      }
      node.forEachChild(visit);
    };
    file.forEachChild(visit);
  });
  return byAnnotation;
}

function isComponentTag(tagName: ts.JsxTagNameExpression): boolean {
  return /^[A-Z]/.test(tagName.getText());
}

function isClassProps(annotation: ts.TypeNode): boolean {
  const parent = annotation.parent;
  return (
    ts.isExpressionWithTypeArguments(parent) &&
    parent.typeArguments?.[0] === annotation &&
    ts.isHeritageClause(parent.parent)
  );
}

interface Read {
  name: string;
  /** What the props object was reached through, at the read. */
  source: ts.Node;
  uses: ts.Node[];
}

function readAt(file: ts.SourceFile, start: number, checker: ts.TypeChecker): Read | undefined {
  const token = getTokenAtPosition(file, start);
  const { parent } = token;
  if (ts.isPropertyAccessExpression(parent) && parent.name === token) {
    return { name: parent.name.text, source: parent.expression, uses: [parent] };
  }
  if (ts.isBindingElement(parent) || ts.isBindingElement(token)) {
    const element = ts.isBindingElement(token) ? token : (parent as ts.BindingElement);
    const key = element.propertyName ?? element.name;
    if (!ts.isIdentifier(key) && !ts.isStringLiteral(key)) return undefined;
    const pattern = element.parent;
    if (!ts.isObjectBindingPattern(pattern)) return undefined;
    return {
      name: key.text,
      source: pattern.parent,
      uses: ts.isIdentifier(element.name) ? referencesTo(element.name, checker) : [],
    };
  }
  return undefined;
}

function referencesTo(name: ts.Identifier, checker: ts.TypeChecker): ts.Node[] {
  const symbol = checker.getSymbolAtLocation(name);
  const scope = enclosingFunction(name);
  if (!symbol || !scope) return [];
  const found: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isIdentifier(node) &&
      node !== name &&
      node.text === name.text &&
      checker.getSymbolAtLocation(node) === symbol
    ) {
      found.push(node);
    }
    node.forEachChild(visit);
  };
  scope.forEachChild(visit);
  return found;
}

function enclosingFunction(node: ts.Node): ts.Node | undefined {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (ts.isFunctionLike(current)) return current;
  }
  return undefined;
}

function propsAnnotationForRead(read: Read, checker: ts.TypeChecker): ts.TypeNode | undefined {
  return annotationOfPropsSource(read.source, checker, new Set());
}

function annotationOfPropsSource(
  node: ts.Node,
  checker: ts.TypeChecker,
  seen: Set<ts.Node>,
): ts.TypeNode | undefined {
  if (seen.has(node)) return undefined;
  seen.add(node);

  if (ts.isParameter(node)) {
    const owner = node.parent;
    if (!ts.isFunctionLike(owner) || owner.parameters[0] !== node) return undefined;
    return propsAnnotationOfFunction(owner);
  }
  if (ts.isVariableDeclaration(node)) {
    return node.type || !node.initializer
      ? undefined
      : annotationOfPropsSource(node.initializer, checker, seen);
  }
  if (isThisProps(node)) {
    const owner = enclosingClass(node);
    return owner && propsAnnotationOf(owner, checker, seen);
  }
  if (ts.isIdentifier(node)) {
    const declaration = aliasedSymbol(checker.getSymbolAtLocation(node), checker)?.declarations?.[0];
    return declaration && annotationOfPropsSource(declaration, checker, seen);
  }
  return undefined;
}

function isThisProps(node: ts.Node): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ThisKeyword &&
    node.name.text === 'props'
  );
}

function enclosingClass(node: ts.Node): ts.ClassLikeDeclaration | undefined {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (ts.isClassDeclaration(current) || ts.isClassExpression(current)) return current;
  }
  return undefined;
}

function memberType(
  checker: ts.TypeChecker,
  at: ts.Node,
  sites: CallSite[],
  name: string,
  uses: ts.Node[],
  maxUnionMembers: number,
): string | undefined {
  const printOptions = { maxUnionMembers, widenLiterals: true };
  const members: string[] = [];
  const add = (text: string) => {
    if (!members.includes(text)) members.push(text);
  };
  sites.forEach((site) => {
    site.attributes.properties.forEach((property) => {
      if (ts.isJsxAttribute(property)) {
        if (!ts.isIdentifier(property.name) || property.name.text !== name) return;
        const value = attributeValue(property);
        const literal = value ? literalMember(value) : 'boolean';
        if (literal) {
          add(literal);
        } else if (value) {
          printed(checker, checker.getTypeAtLocation(value), at, printOptions).forEach(add);
        }
        return;
      }
      if (!ts.isJsxSpreadAttribute(property)) return;
      const spread = checker.getApparentType(checker.getTypeAtLocation(property.expression));
      const member = checker.getPropertyOfType(spread, name);
      if (!member) return;
      const type = checker.getTypeOfSymbolAtLocation(member, property.expression);
      printed(checker, type, at, printOptions).forEach(add);
    });
  });
  uses.forEach((use) => {
    fromUse(checker, use, at, printOptions).forEach(add);
  });
  if (members.length === 0 || members.length > maxUnionMembers) return undefined;
  return members.join(' | ');
}

/**
 * A prop the component spreads onto an element has to be that element's props,
 * and one it hands to a parameter or another component's prop has to satisfy
 * what that position declares. For a prop whose value arrives from outside the
 * project, that is the tightest thing the project can prove about it.
 */
function fromUse(
  checker: ts.TypeChecker,
  use: ts.Node,
  at: ts.Node,
  printOptions: { maxUnionMembers: number; widenLiterals: boolean },
): string[] {
  const { parent } = use;
  if (ts.isJsxSpreadAttribute(parent) && parent.expression === use) {
    const spreadInto = forwardedPropsOf(parent, at);
    return spreadInto ? [spreadInto] : [];
  }
  if (!isTypedPosition(use)) return [];
  const contextual = checker.getContextualType(use as ts.Expression);
  return contextual ? printed(checker, contextual, at, printOptions) : [];
}

function isTypedPosition(use: ts.Node): boolean {
  const { parent } = use;
  if (ts.isCallExpression(parent)) {
    return parent.arguments.some((argument) => argument === use);
  }
  return ts.isJsxExpression(parent) && parent.parent != null && ts.isJsxAttribute(parent.parent);
}

/**
 * The props of the element the value is spread onto, spelled by reference to
 * that element so the two stay in step. `Partial` because the component fills
 * in some of those props itself. Written only where the file already has React
 * in scope, so the pass never has to manage an import to say it.
 */
function forwardedPropsOf(spread: ts.JsxSpreadAttribute, at: ts.Node): string | undefined {
  const element = spread.parent.parent;
  const { tagName } = element;
  if (!isNameable(tagName)) return undefined;
  if (!collectIdentifiers(at.getSourceFile()).has('React')) return undefined;
  const text = tagName.getText();
  const target = ts.isIdentifier(tagName) && /^[a-z]/.test(text) ? `'${text}'` : `typeof ${text}`;
  return `Partial<React.ComponentProps<${target}>>`;
}

function isNameable(tagName: ts.JsxTagNameExpression): boolean {
  if (ts.isIdentifier(tagName)) return true;
  return (
    ts.isPropertyAccessExpression(tagName) &&
    ts.isIdentifier(tagName.name) &&
    isNameable(tagName.expression as ts.JsxTagNameExpression)
  );
}

function printed(
  checker: ts.TypeChecker,
  type: ts.Type,
  at: ts.Node,
  options: { maxUnionMembers: number; widenLiterals: boolean },
): string[] {
  const result = printType(checker, type, at, options);
  // The member is written optional, so `undefined` says nothing the `?` does not.
  return result.printable ? result.members.filter((member) => member !== 'undefined') : [];
}
