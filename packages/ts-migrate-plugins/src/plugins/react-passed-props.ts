import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import getTokenAtPosition from './utils/token-pos';
import {
  applyTextChanges,
  createFileLanguageService,
  findNewErrors,
  getValidationOptions,
  TextChange,
} from '../utils/candidateValidation';
import { DEFAULT_MAX_UNION_MEMBERS, printType } from '../utils/typePrinter';
import { createValidate, Properties } from '../utils/validateOptions';

export interface Options {
  maxUnionMembers?: number;
}

const optionProperties: Properties = {
  maxUnionMembers: { type: 'integer', minimum: 2 },
};

const attributeDiagnosticCodes = new Set([2322, 2326, 2559, 2769]);

const reactOwnAttributes = new Set(['key', 'ref']);

const maxValidationPrograms = 12;

interface Group {
  start: number;
  length: number;
  declared: string;
  open: boolean;
  members: string[];
}

interface PlannedFile {
  text: string;
  groups: Group[];
}

interface Pass {
  files: Map<string, PlannedFile>;
  known: Set<string>;
  served: Set<string>;
}

let currentPass: Pass | undefined;

const reactPassedPropsPlugin: Plugin<Options> = {
  name: 'react-passed-props',

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
    return applyProven(fileName, text, planned.groups, languageService);
  },

  validate: createValidate<Options>(optionProperties),
};

export default reactPassedPropsPlugin;

interface Evidence {
  types: ts.Type[];
  literal: string[];
}

function plan(languageService: ts.LanguageService, maxUnionMembers: number): Pass {
  const pass: Pass = { files: new Map(), known: new Set(), served: new Set() };
  const program = languageService.getProgram();
  if (!program) return pass;
  const checker = program.getTypeChecker();

  const byAnnotation = new Map<ts.TypeNode, Map<string, Evidence>>();
  program.getSourceFiles().forEach((file) => {
    if (!isMigratable(file)) return;
    pass.known.add(file.fileName);
    if (!/\.[jt]sx$/.test(file.fileName)) return;
    languageService.getSemanticDiagnostics(file.fileName).forEach((diagnostic) => {
      if (!attributeDiagnosticCodes.has(diagnostic.code) || diagnostic.start == null) return;
      const attribute = attributeAt(file, diagnostic.start);
      if (!attribute) return;
      collect(attribute, checker, byAnnotation);
    });
  });

  const groupsByFile = new Map<string, Group[]>();
  byAnnotation.forEach((props, annotation) => {
    const group = groupFor(checker, annotation, props, maxUnionMembers);
    if (!group) return;
    const { fileName } = annotation.getSourceFile();
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

function isMigratable(file: ts.SourceFile): boolean {
  return !file.isDeclarationFile && !file.fileName.includes('/node_modules/');
}

function attributeAt(file: ts.SourceFile, start: number): ts.JsxAttribute | undefined {
  for (let node: ts.Node | undefined = getTokenAtPosition(file, start); node; node = node.parent) {
    if (ts.isJsxAttribute(node)) return node;
    if (ts.isJsxAttributes(node)) return undefined;
  }
  return undefined;
}

function collect(
  attribute: ts.JsxAttribute,
  checker: ts.TypeChecker,
  byAnnotation: Map<ts.TypeNode, Map<string, Evidence>>,
): void {
  const name = attributeName(attribute);
  if (!name || reactOwnAttributes.has(name)) return;

  const attributes = attribute.parent;
  const received = checker.getContextualType(attributes);
  if (!received || !isClosed(checker, received) || checker.getPropertyOfType(received, name)) return;

  const annotation = propsAnnotation(attributes.parent.tagName, checker);
  if (!annotation) return;
  const declared = checker.getTypeFromTypeNode(annotation);
  if (!isClosed(checker, declared) || checker.getPropertyOfType(declared, name)) return;

  let props = byAnnotation.get(annotation);
  if (!props) {
    props = new Map();
    byAnnotation.set(annotation, props);
  }
  const evidence = props.get(name) ?? { types: [], literal: [] };
  const value = attributeValue(attribute);
  const literal = value ? literalMember(value) : 'boolean';
  if (literal) {
    if (!evidence.literal.includes(literal)) evidence.literal.push(literal);
  } else if (value) {
    evidence.types.push(checker.getTypeAtLocation(value));
  }
  props.set(name, evidence);
}

function attributeName(attribute: ts.JsxAttribute): string | undefined {
  return ts.isIdentifier(attribute.name) ? attribute.name.text : undefined;
}

function literalMember(value: ts.Expression): string | undefined {
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return 'string';
  if (ts.isTemplateExpression(value)) return 'string';
  if (ts.isNumericLiteral(value)) return 'number';
  if (value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword) {
    return 'boolean';
  }
  return undefined;
}

function attributeValue(attribute: ts.JsxAttribute): ts.Expression | undefined {
  const { initializer } = attribute;
  if (!initializer) return undefined;
  return ts.isJsxExpression(initializer) ? initializer.expression : initializer;
}

function isClosed(checker: ts.TypeChecker, type: ts.Type): boolean {
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return false;
  if (type.isUnion()) return false;
  return (
    !checker.getIndexInfoOfType(type, ts.IndexKind.String) &&
    !checker.getIndexInfoOfType(type, ts.IndexKind.Number)
  );
}

function propsAnnotation(
  tagName: ts.JsxTagNameExpression,
  checker: ts.TypeChecker,
): ts.TypeNode | undefined {
  const symbol = aliased(checker.getSymbolAtLocation(tagName), checker);
  const declaration = symbol?.declarations?.[0];
  return declaration && annotationOf(declaration, checker, new Set());
}

function aliased(symbol: ts.Symbol | undefined, checker: ts.TypeChecker): ts.Symbol | undefined {
  let current = symbol;
  while (current && current.flags & ts.SymbolFlags.Alias) {
    const next = checker.getAliasedSymbol(current);
    if (!next || next === current) return current;
    current = next;
  }
  return current;
}

function annotationOf(
  node: ts.Node,
  checker: ts.TypeChecker,
  seen: Set<ts.Node>,
): ts.TypeNode | undefined {
  if (seen.has(node)) return undefined;
  seen.add(node);
  if (!isMigratable(node.getSourceFile())) return undefined;

  if (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const parameter = node.parameters[0];
    return parameter && parameter.type && !isAny(parameter.type) ? parameter.type : undefined;
  }
  if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
    const argument = componentTypeArgument(node);
    return argument && !isAny(argument) ? argument : undefined;
  }
  if (ts.isExportAssignment(node)) {
    return annotationOf(node.expression, checker, seen);
  }
  if (ts.isVariableDeclaration(node)) {
    return node.type || !node.initializer
      ? undefined
      : annotationOf(node.initializer, checker, seen);
  }
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
    return annotationOf(node.expression, checker, seen);
  }
  if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
    const symbol = aliased(checker.getSymbolAtLocation(node), checker);
    const declaration = symbol?.declarations?.[0];
    return declaration && annotationOf(declaration, checker, seen);
  }
  if (ts.isCallExpression(node)) {
    const component = node.arguments.find(isComponentShaped);
    return component && annotationOf(component, checker, seen);
  }
  return undefined;
}

function isComponentShaped(argument: ts.Expression): boolean {
  return (
    ts.isIdentifier(argument) ||
    ts.isPropertyAccessExpression(argument) ||
    ts.isArrowFunction(argument) ||
    ts.isFunctionExpression(argument) ||
    ts.isClassExpression(argument)
  );
}

function isAny(typeNode: ts.TypeNode): boolean {
  return typeNode.kind === ts.SyntaxKind.AnyKeyword;
}

function componentTypeArgument(node: ts.ClassLikeDeclaration): ts.TypeNode | undefined {
  const heritage = node.heritageClauses?.find(
    (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
  );
  return heritage?.types[0]?.typeArguments?.[0];
}

function groupFor(
  checker: ts.TypeChecker,
  annotation: ts.TypeNode,
  props: Map<string, Evidence>,
  maxUnionMembers: number,
): Group | undefined {
  const members: string[] = [];
  props.forEach((evidence, name) => {
    members.push(`${name}?: ${memberType(checker, annotation, evidence, maxUnionMembers)}`);
  });
  if (members.length === 0) return undefined;

  const source = annotation.getSourceFile();
  const start = annotation.getStart(source);
  const declared = source.text.slice(start, annotation.end);
  const open = ts.isTypeLiteralNode(annotation) && !declared.includes('\n');
  return {
    start,
    length: annotation.end - start,
    declared: needsParentheses(annotation) ? `(${declared})` : declared,
    open,
    members,
  };
}

function changeFor(group: Group, members: string[]): TextChange {
  const addition = `{ ${members.join('; ')} }`;
  if (!group.open) {
    return { start: group.start, length: group.length, text: `${group.declared} & ${addition}` };
  }
  const inner = group.declared.slice(1, -1).trim().replace(/[;,]$/, '');
  return {
    start: group.start,
    length: group.length,
    text: inner ? `{ ${inner}; ${members.join('; ')} }` : addition,
  };
}

function memberType(
  checker: ts.TypeChecker,
  at: ts.Node,
  evidence: Evidence,
  maxUnionMembers: number,
): string {
  const printOptions = { maxUnionMembers, widenLiterals: true };
  const members = [...evidence.literal];
  evidence.types.forEach((type) => {
    const printed = printType(checker, type, at, printOptions);
    if (!printed.printable) return;
    printed.members.forEach((member) => {
      if (!members.includes(member)) members.push(member);
    });
  });
  if (members.length === 0 || members.length > maxUnionMembers) return 'any';
  return members.join(' | ');
}

function needsParentheses(typeNode: ts.TypeNode): boolean {
  return (
    ts.isUnionTypeNode(typeNode) ||
    ts.isFunctionTypeNode(typeNode) ||
    ts.isConstructorTypeNode(typeNode) ||
    ts.isConditionalTypeNode(typeNode) ||
    ts.isInferTypeNode(typeNode)
  );
}

interface Addition {
  group: Group;
  member: string;
}

function applyProven(
  fileName: string,
  text: string,
  groups: Group[],
  languageService: ts.LanguageService,
): string | undefined {
  const program = languageService.getProgram();
  const compilerOptions = getValidationOptions(program ? program.getCompilerOptions() : {});
  const baseline = createFileLanguageService(fileName, text, compilerOptions, program);
  const baselineSyntacticCount = baseline.getSyntacticDiagnostics(fileName).length;
  let programsLeft = maxValidationPrograms;

  const attempt = (accepted: Addition[]): string | undefined => {
    if (programsLeft <= 0) return undefined;
    programsLeft -= 1;
    const changes = changesOf(groups, accepted);
    const candidateText = applyTextChanges(text, changes);
    const candidate = createFileLanguageService(fileName, candidateText, compilerOptions, program);
    if (candidate.getSyntacticDiagnostics(fileName).length !== baselineSyntacticCount) {
      return undefined;
    }
    return findNewErrors(baseline, candidate, changes, fileName).length > 0
      ? undefined
      : candidateText;
  };

  const all = groups.flatMap((group) => group.members.map((member) => ({ group, member })));
  const whole = attempt(all);
  if (whole || all.length === 1) return whole;

  const accepted: Addition[] = [];
  let kept: string | undefined;
  all.forEach((addition) => {
    const next = attempt([...accepted, addition]);
    if (!next) return;
    accepted.push(addition);
    kept = next;
  });
  return kept;
}

function changesOf(groups: Group[], accepted: Addition[]): TextChange[] {
  const changes: TextChange[] = [];
  groups.forEach((group) => {
    const members = accepted
      .filter((addition) => addition.group === group)
      .map((addition) => addition.member);
    if (members.length > 0) changes.push(changeFor(group, members));
  });
  return changes;
}
