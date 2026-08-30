import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import getTokenAtPosition from './utils/token-pos';
import {
  AnnotationGroup,
  annotationGroup,
  applyProvenAdditions,
} from '../utils/annotationAdditions';
import {
  attributeValue,
  isClosedType,
  literalMember,
  propsAnnotationOfTag,
} from '../utils/componentProps';
import { isMigratableFile } from '../utils/sourceFiles';
import { DEFAULT_MAX_UNION_MEMBERS, printType } from '../utils/typePrinter';
import { createValidate, Properties } from '../utils/validateOptions';
import {
  addToFile,
  createWholeProgramPass,
  Pass,
  planWholeProgram,
} from '../utils/wholeProgramPass';

export interface Options {
  maxUnionMembers?: number;
}

const optionProperties: Properties = {
  maxUnionMembers: { type: 'integer', minimum: 2 },
};

const attributeDiagnosticCodes = new Set([2322, 2326, 2559, 2769]);

const reactOwnAttributes = new Set(['key', 'ref']);

const pass = createWholeProgramPass<AnnotationGroup>();

const reactPassedPropsPlugin: Plugin<Options> = {
  name: 'react-passed-props',

  run({ fileName, text, options, getLanguageService }) {
    const languageService = getLanguageService();
    const planned = pass.plannedFor(fileName, text, () =>
      plan(languageService, options.maxUnionMembers ?? DEFAULT_MAX_UNION_MEMBERS),
    );
    if (!planned) return undefined;
    return applyProvenAdditions(fileName, text, planned.items, languageService);
  },

  validate: createValidate<Options>(optionProperties),
};

export default reactPassedPropsPlugin;

interface Evidence {
  types: ts.Type[];
  literal: string[];
}

function plan(
  languageService: ts.LanguageService,
  maxUnionMembers: number,
): Pass<AnnotationGroup> {
  return planWholeProgram<AnnotationGroup>(languageService, ({ program, checker, known }) => {
    const byAnnotation = new Map<ts.TypeNode, Map<string, Evidence>>();
    program.getSourceFiles().forEach((file) => {
      if (!isMigratableFile(file)) return;
      known.add(file.fileName);
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
      addToFile(groupsByFile, fileName, [annotationGroup(annotation, members)]);
    });
    return groupsByFile;
  });
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
