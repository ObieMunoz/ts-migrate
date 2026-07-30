import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import getTokenAtPosition from './utils/token-pos';
import {
  AnnotationGroup,
  annotationGroup,
  applyProvenAdditions,
} from '../utils/annotationAdditions';
import { isClosedType, isMigratableFile, propsAnnotationOfTag } from '../utils/componentProps';
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
    return applyProvenAdditions(fileName, text, planned.groups, languageService);
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
    if (!isMigratableFile(file)) return;
    pass.known.add(file.fileName);
    if (!/\.[jt]sx$/.test(file.fileName)) return;
    languageService.getSemanticDiagnostics(file.fileName).forEach((diagnostic) => {
      if (!attributeDiagnosticCodes.has(diagnostic.code) || diagnostic.start == null) return;
      const attribute = attributeAt(file, diagnostic.start);
      if (!attribute) return;
      collect(attribute, checker, byAnnotation);
    });
  });

  const groupsByFile = new Map<string, AnnotationGroup[]>();
  byAnnotation.forEach((props, annotation) => {
    const members: string[] = [];
    props.forEach((evidence, name) => {
      members.push(`${name}?: ${memberType(checker, annotation, evidence, maxUnionMembers)}`);
    });
    if (members.length === 0) return;
    const { fileName } = annotation.getSourceFile();
    const forFile = groupsByFile.get(fileName);
    const group = annotationGroup(annotation, members);
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
  if (!received || !isClosedType(checker, received) || checker.getPropertyOfType(received, name)) {
    return;
  }

  const annotation = propsAnnotationOfTag(attributes.parent.tagName, checker);
  if (!annotation) return;
  const declared = checker.getTypeFromTypeNode(annotation);
  if (!isClosedType(checker, declared) || checker.getPropertyOfType(declared, name)) return;

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
