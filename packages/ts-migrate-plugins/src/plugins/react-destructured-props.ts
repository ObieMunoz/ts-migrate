import ts from 'typescript';
import { fileNoticeReporter, Plugin } from '@obiemunoz/ts-migrate-server';
import {
  isReactForwardRefName,
  isReactSfcArrowFunction,
  isReactSfcFunctionDeclaration,
  isSfcFunctionExpression,
  unwrapReactMemo,
} from './utils/react';
import { createPropsTypeNameGetter } from './utils/react-props';
import { innermostNodeAt } from './utils/token-pos';
import { isDiagnosticWithLinePosition } from '../utils/type-guards';
import firstErrorLine from '../utils/firstErrorLine';
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

type Options = AnyAliasOptions;

/**
 * What an untyped props pattern is reported as: TS7031 where the parameter has
 * no contextual type at all, TS2339 where one supplies fewer props than the
 * pattern reads, which is what `memo`, `forwardRef` and a defaulted pattern
 * give it.
 */
const untypedPatternCodes = [7031, 2339];

/** Past this a printed type is an anonymous shape, not a name worth writing. */
const maxTypeTextLength = 120;

const unprovableTypeTexts = [
  'any',
  'never',
  'unknown',
  'object',
  'null',
  'undefined',
  '{}',
  'never[]',
];

/** One property of the generated type. */
interface Member {
  /** The property name, unquoted. */
  key: string;
  /** The element of the pattern that reads it. */
  element: ts.BindingElement;
  /** The name the pattern binds it to, absent for a nested pattern. */
  binding?: string;
  /** The type single-file evidence proves, absent for the any fallback. */
  type?: string;
}

interface Component {
  /** The statement the type alias is written above. */
  anchor: ts.Statement;
  pattern: ts.ObjectBindingPattern;
  typeName: string;
  members: Member[];
}

/** What the file's own `<Foo ... />` attributes say about each prop. */
interface CallSiteEvidence {
  types: Map<string, Set<string>>;
  /** Props passed something this file cannot put a name to. */
  unprovable: Set<string>;
}

/**
 * Names the props of a function component that destructures them and has no
 * propTypes, which react-props leaves alone and explicit-any annotates as a
 * single `any` over the whole pattern.
 *
 * The prop names come from the pattern, which is the component's own statement
 * of what it reads. Their types come only from what this one file proves: the
 * default in the pattern, and, for a component nothing outside the file can
 * render, the JSX attributes of its call sites here. A component the file
 * exports is rendered from files this pass never sees, so an attribute type
 * observed here says nothing about the others, and those props take the any
 * alias rather than a type that reads as checked and is not.
 *
 * Every member is optional, and every proposal is re-checked against the file
 * before it is written, so a type the component's own body contradicts falls
 * back to the alias instead of landing.
 */
const reactDestructuredPropsPlugin: Plugin<Options> = {
  name: 'react-destructured-props',

  run(params) {
    const { fileName, sourceFile, getLanguageService, options } = params;
    if (!fileName.endsWith('.tsx')) return undefined;

    const languageService = getLanguageService();
    const program = languageService.getProgram();
    const source = program && program.getSourceFile(fileName);
    if (!program || !source || source.text !== sourceFile.text) return undefined;

    // Without noImplicitAny nothing reports an untyped pattern, so there is no
    // error to blame and no way to tell one the checker already types.
    const compilerOptions = program.getCompilerOptions();
    if (!(compilerOptions.noImplicitAny ?? compilerOptions.strict ?? false)) return undefined;

    const reported = languageService
      .getSemanticDiagnostics(fileName)
      .filter(isDiagnosticWithLinePosition)
      .filter((diagnostic) => untypedPatternCodes.includes(diagnostic.code));
    if (reported.length === 0) return undefined;

    const components = collectComponents(source, program.getTypeChecker(), reported);
    if (components.length === 0) return undefined;

    let proven: Component[] | undefined;
    try {
      proven = proveComponents(
        fileName,
        source,
        getValidationOptions(compilerOptions),
        components,
        program,
      );
    } catch (e) {
      fileNoticeReporter(params, '[react-destructured-props]')({
        reason: firstErrorLine(e),
        hint: 'The props of the components in this file are left as they were.',
      });
      return undefined;
    }
    if (!proven) return undefined;

    return applyTextChanges(source.text, changesFor(proven, options.anyAlias ?? 'any'));
  },

  validate: validateAnyAliasOptions,
};

export default reactDestructuredPropsPlugin;

function collectComponents(
  source: ts.SourceFile,
  checker: ts.TypeChecker,
  reported: ts.DiagnosticWithLocation[],
): Component[] {
  const getPropsTypeName = createPropsTypeNameGetter(source);
  const components: Component[] = [];

  source.statements.forEach((statement) => {
    const found = findComponent(statement);
    if (!found) return;

    const { param, name } = found;
    if (param == null || param.type != null || param.dotDotDotToken != null) return;
    if (!ts.isObjectBindingPattern(param.name)) return;

    const pattern = param.name;
    if (!reported.some(({ start }) => start >= param.pos && start < param.end)) return;

    const members = membersOf(pattern);
    if (!members) return;

    const evidence = isFileLocal(source, statement, name)
      ? callSiteEvidence(source, checker, name, statement)
      : undefined;
    members.forEach((member) => {
      member.type = memberType(checker, source, statement, member, evidence);
    });

    components.push({ anchor: statement, pattern, typeName: getPropsTypeName(name), members });
  });

  return components;
}

/** The props parameter of the component a statement declares, if it is one. */
function findComponent(
  statement: ts.Statement,
): { param: ts.ParameterDeclaration | undefined; name: string | undefined } | undefined {
  if (ts.isFunctionDeclaration(statement) && isReactSfcFunctionDeclaration(statement)) {
    return { param: statement.parameters[0], name: statement.name?.text };
  }

  if (ts.isVariableStatement(statement) && isReactSfcArrowFunction(statement)) {
    const declaration = statement.declarationList.declarations[0];
    // An annotated declaration already says what the props are; the pattern is
    // read through that type, not through one of ours.
    if (declaration.type) return undefined;
    const name = ts.isIdentifier(declaration.name) ? declaration.name.text : undefined;
    const initializer = unwrapReactMemo(declaration.initializer!);

    if (isSfcFunctionExpression(initializer)) {
      return { param: initializer.parameters[0], name };
    }
    if (ts.isCallExpression(initializer) && isReactForwardRefName(initializer)) {
      const render = initializer.arguments[0];
      if (render && ts.isFunctionLike(render)) {
        return { param: render.parameters[0], name };
      }
    }
  }

  return undefined;
}

/**
 * A rest element forwards props the pattern never names, so no closed type
 * describes what the component accepts and the component is left alone. So is
 * a computed key, which names no property this file can read.
 */
function membersOf(pattern: ts.ObjectBindingPattern): Member[] | undefined {
  const members: Member[] = [];

  for (const element of pattern.elements) {
    if (element.dotDotDotToken) return undefined;

    const name = element.propertyName ?? element.name;
    if (!ts.isIdentifier(name) && !ts.isStringLiteral(name)) return undefined;

    members.push({
      key: name.text,
      element,
      binding: ts.isIdentifier(element.name) ? element.name.text : undefined,
    });
  }

  return members.length > 0 ? members : undefined;
}

/**
 * The type the file proves for one prop. Evidence that resolves to `any` is
 * dropped before anything is checked: `any` is assignable in both directions,
 * so no later check rejects it, and it would be written as if it had been
 * proven. Evidence that disagrees with itself is dropped too, since picking
 * one of the observed types over the other is a guess.
 */
function memberType(
  checker: ts.TypeChecker,
  source: ts.SourceFile,
  enclosing: ts.Node,
  member: Member,
  evidence: CallSiteEvidence | undefined,
): string | undefined {
  // Only a binding the pattern names outright reads the prop whole; a nested
  // pattern reads through it, and describing what it needs is a guess.
  if (member.binding == null) return undefined;
  if (evidence?.unprovable.has(member.key)) return undefined;

  const observed = new Set(evidence?.types.get(member.key));
  if (member.element.initializer) {
    const text = typeTextOf(checker, member.element.initializer, enclosing);
    if (!text) return undefined;
    observed.add(text);
  }

  if (observed.size === 1) return [...observed][0];
  if (observed.size === 0 && member.key === 'children') {
    const namespace = reactNamespace(source);
    if (namespace) return `${namespace}.ReactNode`;
  }
  return undefined;
}

/** The printable type of an expression, or nothing when it proves nothing. */
function typeTextOf(
  checker: ts.TypeChecker,
  node: ts.Expression,
  enclosing: ts.Node,
): string | undefined {
  const type = checker.getBaseTypeOfLiteralType(checker.getTypeAtLocation(node));
  const unusable =
    ts.TypeFlags.Any |
    ts.TypeFlags.Unknown |
    ts.TypeFlags.Never |
    ts.TypeFlags.Null |
    ts.TypeFlags.Undefined |
    ts.TypeFlags.Void;
  if ((type.flags & unusable) !== 0) return undefined;

  const text = checker.typeToString(
    type,
    enclosing,
    ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
  );
  if (
    text.length > maxTypeTextLength ||
    text.includes('import(') ||
    text.includes('...') ||
    unprovableTypeTexts.includes(text)
  ) {
    return undefined;
  }
  return text;
}

/**
 * A spread attribute passes props the file cannot enumerate, so a call site
 * with one takes the whole component out of call-site evidence.
 */
function callSiteEvidence(
  source: ts.SourceFile,
  checker: ts.TypeChecker,
  componentName: string | undefined,
  enclosing: ts.Node,
): CallSiteEvidence | undefined {
  if (!componentName) return undefined;

  const types = new Map<string, Set<string>>();
  const unprovable = new Set<string>();
  let usable = true;

  const record = (key: string, text: string | undefined) => {
    if (!text) {
      unprovable.add(key);
      return;
    }
    getOrCreate(types, key, () => new Set<string>()).add(text);
  };

  forEachDescendant(source, (node) => {
    if (!ts.isJsxSelfClosingElement(node) && !ts.isJsxOpeningElement(node)) return;
    if (!ts.isIdentifier(node.tagName) || node.tagName.text !== componentName) return;

    node.attributes.properties.forEach((property) => {
      if (!ts.isJsxAttribute(property) || !ts.isIdentifier(property.name)) {
        usable = false;
        return;
      }

      const key = property.name.text;
      const { initializer } = property;
      if (initializer == null) {
        record(key, 'boolean');
      } else if (ts.isStringLiteral(initializer)) {
        record(key, 'string');
      } else if (ts.isJsxExpression(initializer) && initializer.expression) {
        record(key, typeTextOf(checker, initializer.expression, enclosing));
      } else {
        record(key, undefined);
      }
    });
  });

  return usable ? { types, unprovable } : undefined;
}

/**
 * Whether every reference to the component is a JSX tag in this file. Anything
 * else, an export above all, means call sites this file cannot see.
 */
function isFileLocal(
  source: ts.SourceFile,
  statement: ts.Statement,
  componentName: string | undefined,
): boolean {
  if (!componentName) return false;
  if (
    ts.canHaveModifiers(statement) &&
    ts
      .getModifiers(statement)
      ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
  ) {
    return false;
  }

  let local = true;
  forEachDescendant(source, (node) => {
    if (!ts.isIdentifier(node) || node.text !== componentName) return;
    const { parent } = node;
    if (ts.isFunctionDeclaration(parent) || ts.isVariableDeclaration(parent)) return;
    if (
      (ts.isJsxSelfClosingElement(parent) ||
        ts.isJsxOpeningElement(parent) ||
        ts.isJsxClosingElement(parent)) &&
      parent.tagName === node
    ) {
      return;
    }
    local = false;
  });
  return local;
}

function reactNamespace(source: ts.SourceFile): string | undefined {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (statement.moduleSpecifier.text !== 'react') continue;

    const clause = statement.importClause;
    if (!clause) continue;
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      return clause.namedBindings.name.text;
    }
    if (clause.name) return clause.name.text;
  }
  return undefined;
}

/**
 * Keeps the proposal the file still checks clean. The members an error blames
 * drop to the alias and the rest are re-checked; if that does not hold either,
 * so does every member, and a file that fails even then is left alone.
 */
function proveComponents(
  fileName: string,
  source: ts.SourceFile,
  compilerOptions: ts.CompilerOptions,
  components: Component[],
  projectProgram: ts.Program,
): Component[] | undefined {
  const { text } = source;
  const baseline = createFileLanguageService(fileName, text, compilerOptions, projectProgram);

  // Checked as plain `any`: a single-file program does not include the
  // declaration file the alias is declared in, so the alias would read as an
  // unresolved name. The two describe the same type by definition.
  const attempt = (candidates: Component[]) => {
    const changes = changesFor(candidates, 'any');
    const service = createFileLanguageService(
      fileName,
      applyTextChanges(text, changes),
      compilerOptions,
      projectProgram,
    );
    return { errors: findNewErrors(baseline, service, changes, fileName), changes };
  };

  const first = attempt(components);
  if (first.errors.length === 0) return components;

  const typed = components.some((component) =>
    component.members.some((member) => member.type != null),
  );
  if (!typed) return undefined;

  const blamed = blameMembers(first.errors, components, source, first.changes);
  if (blamed.size > 0) {
    const relaxed = withoutTypes(components, blamed);
    if (attempt(relaxed).errors.length === 0) return relaxed;
  }

  const bare = withoutTypes(components);
  return attempt(bare).errors.length === 0 ? bare : undefined;
}

function withoutTypes(components: Component[], blamed?: Set<Member>): Component[] {
  return components.map((component) => ({
    ...component,
    members: component.members.map((member) => ({
      ...member,
      type: blamed && !blamed.has(member) ? member.type : undefined,
    })),
  }));
}

/**
 * The members an error can be attributed to: the one whose line it lands on in
 * the generated type, the one a JSX attribute names, or the one a binding in
 * the body reads. An error that names none of them blames every member.
 */
function blameMembers(
  errors: ts.Diagnostic[],
  components: Component[],
  source: ts.SourceFile,
  changes: TextChange[],
): Set<Member> {
  const blamed = new Set<Member>();
  const byKey = new Map<string, Member[]>();
  const byBinding = new Map<string, Member[]>();
  const all: Member[] = [];
  components.forEach((component) =>
    component.members.forEach((member) => {
      all.push(member);
      getOrCreate(byKey, member.key, (): Member[] => []).push(member);
      if (member.binding) getOrCreate(byBinding, member.binding, (): Member[] => []).push(member);
    }),
  );

  const lines = memberLines(components, changes);

  errors.forEach((error) => {
    const { start } = error;
    if (start == null) return;

    const line = lines.find((span) => span.start <= start && start < span.end);
    if (line) {
      blamed.add(line.member);
      return;
    }

    const node = innermostNodeAt(source, toOriginalPos(start, changes));
    const named = node && namedMembers(node, byKey, byBinding);
    if (named && named.length > 0) {
      named.forEach((member) => blamed.add(member));
      return;
    }
    all.forEach((member) => blamed.add(member));
  });

  return blamed;
}

function namedMembers(
  node: ts.Node,
  byKey: Map<string, Member[]>,
  byBinding: Map<string, Member[]>,
): Member[] | undefined {
  let current: ts.Node | undefined = node;
  while (current && !ts.isSourceFile(current)) {
    if (ts.isJsxAttribute(current) && ts.isIdentifier(current.name)) {
      return byKey.get(current.name.text);
    }
    if (ts.isIdentifier(current) && byBinding.has(current.text)) {
      return byBinding.get(current.text);
    }
    current = current.parent;
  }
  return undefined;
}

interface MemberLine {
  member: Member;
  start: number;
  end: number;
}

/** Where each generated member's line lands in the checked text. */
function memberLines(components: Component[], changes: TextChange[]): MemberLine[] {
  const lines: MemberLine[] = [];
  let shift = 0;
  let index = 0;

  components.forEach((component) => {
    const aliasStart = changes[index].start + shift;
    shift += changes[index].text.length;
    shift += changes[index + 1].text.length;
    index += 2;

    let offset = aliasStart + `\n\ntype ${component.typeName} = {\n`.length;
    component.members.forEach((member) => {
      const length = `${memberLine(member, 'any')}\n`.length;
      lines.push({ member, start: offset, end: offset + length });
      offset += length;
    });
  });

  return lines;
}

/** Two changes per component, alias then annotation; memberLines reads them positionally. */
function changesFor(components: Component[], anyType: string): TextChange[] {
  const changes: TextChange[] = [];
  components.forEach((component) => {
    changes.push({
      start: component.anchor.pos,
      length: 0,
      text: `\n\n${renderAlias(component, anyType)}`,
    });
    changes.push({
      start: component.pattern.end,
      length: 0,
      text: `: ${component.typeName}`,
    });
  });
  return changes;
}

function renderAlias(component: Component, anyType: string): string {
  const members = component.members.map((member) => `${memberLine(member, anyType)}\n`).join('');
  return `type ${component.typeName} = {\n${members}};`;
}

function memberLine(member: Member, anyType: string): string {
  return `    ${renderKey(member.key)}?: ${member.type ?? anyType};`;
}

function renderKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

function forEachDescendant(node: ts.Node, visitor: (child: ts.Node) => void): void {
  node.forEachChild((child) => {
    visitor(child);
    forEachDescendant(child, visitor);
  });
}
