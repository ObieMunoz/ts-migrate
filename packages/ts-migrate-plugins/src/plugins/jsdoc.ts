import ts from 'typescript';
import { fileNoticeReporter, Plugin, PluginFileNotice } from '@obiemunoz/ts-migrate-server';
import {
  AnyAliasOptions,
  Properties,
  anyAliasProperty,
  createValidate,
} from '../utils/validateOptions';
import UpdateTracker from './utils/update';
import createFollowUpMarkers, { FollowUpMarkers } from '../utils/followUpMarker';
import {
  aliasTemplateTags,
  isHostTemplateTag,
  JSDocTypeAlias,
  JSDocTypeAliasScan,
  scanJSDocTypeAliases,
} from './utils/jsdoc-type-aliases';
import { hasParameterParentheses } from './utils/arrow';
import { anyTypeNode } from './utils/anyTypes';
import { isAssignmentOperatorKind, isIdentifierName } from './utils/identifiers';

type TypeMap = Record<string, TypeOptions>;

type TypeOptions =
  | string
  | {
      tsName?: string;
      acceptsTypeParameters?: boolean;
    };

const defaultTypeMap: TypeMap = {
  String: {
    tsName: 'string',
    acceptsTypeParameters: false,
  },
  Boolean: {
    tsName: 'boolean',
    acceptsTypeParameters: false,
  },
  Number: {
    tsName: 'number',
    acceptsTypeParameters: false,
  },
  Object: {
    tsName: 'object',
    // Object<string, T> and Object<number, T> are handled as a special case.
    acceptsTypeParameters: false,
  },
  date: {
    tsName: 'Date',
    acceptsTypeParameters: false,
  },
  array: 'Array',
  promise: 'Promise',
};

type Options = {
  annotateReturns?: boolean;
  typeMap?: TypeMap;
} & AnyAliasOptions;

const optionProperties: Properties = {
  ...anyAliasProperty,
  annotateReturns: { type: 'boolean' },
  typeMap: {
    oneOf: [
      { type: 'string' },
      {
        type: 'object',
        properties: { tsName: { type: 'string' }, acceptsTypeParameters: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
  },
};

const jsDocPlugin: Plugin<Options> = {
  name: 'jsdoc',

  run(params) {
    const { sourceFile, options } = params;
    const updates = new UpdateTracker(sourceFile);
    const report = fileNoticeReporter(params, '[jsdoc]');
    ts.transform(sourceFile, [jsDocTransformerFactory(updates, options, report)]);
    return updates.apply();
  },

  validate: createValidate(optionProperties),
};

export default jsDocPlugin;

/** `parseDiagnostics` is not on the public SourceFile, and is absent on older compilers. */
type ParsedSourceFile = ts.SourceFile & { parseDiagnostics?: readonly unknown[] };

const jsDocTransformerFactory =
  (
    updates: UpdateTracker,
    { annotateReturns, anyAlias, typeMap: optionsTypeMap }: Options,
    report: (notice: PluginFileNotice) => void,
  ) =>
  (context: ts.TransformationContext) => {
    const { factory } = context;
    const printer = ts.createPrinter();
    const anyType = anyTypeNode(anyAlias, factory);
    const typeMap: TypeMap = { ...defaultTypeMap, ...optionsTypeMap };
    // How deep the current visitJSDocType recursion is, so that only the type
    // a caller is about to write pays for the printability check.
    let visitDepth = 0;
    let sourceFile!: ts.SourceFile;
    let markers!: FollowUpMarkers;
    let aliasNames = new Set<string>();
    let danglingNames = new Set<string>();
    let exportAliases = false;

    /** Reports a tag left as a comment, and marks where it stayed. */
    function noteFollowUp(node: ts.Node, reason: string, hint: string): void {
      const { update, marked } = markers.add(node, { hint, reason });
      if (update) updates.replaceText(update.index, update.index, update.text);
      report({ reason, hint, recovered: true, marked });
    }

    return (file: ts.SourceFile) => {
      sourceFile = file;
      markers = createFollowUpMarkers(file);
      const scan = scanJSDocTypeAliases(file);
      aliasNames = new Set(scan.aliases.map((alias) => alias.name));
      danglingNames = scan.skippedNames;
      exportAliases = ts.isExternalModule(file);
      // declareTypeAliases replaces a comment it took aliases out of, starting
      // at the same position a marker would be inserted at. Those comments are
      // rewritten anyway, so the skipped tags in them are reported unmarked
      // rather than risking an update that overlaps the rewrite.
      const rewrittenDocs = new Set(scan.aliases.map((alias) => alias.doc));
      scan.skipped.forEach(({ tagText, reason, doc }) => {
        const note = {
          reason: `${tagText} stays a comment because ${reason}`,
          hint: 'Declare it as a type of its own; references to it are annotated with any.',
        };
        if (rewrittenDocs.has(doc)) {
          report({ ...note, recovered: true });
        } else {
          noteFollowUp(doc, note.reason, note.hint);
        }
      });
      declareTypeAliases(scan);
      visit(file);
      return file;
    };

    function visit(origNode: ts.Node): void {
      origNode.forEachChild(visit);
      if (ts.isFunctionLike(origNode)) {
        visitFunctionLike(origNode, ts.isClassDeclaration(origNode.parent));
      } else if (ts.isVariableDeclaration(origNode) || ts.isPropertyDeclaration(origNode)) {
        visitTypeTag(origNode);
      } else if (ts.isClassLike(origNode)) {
        visitClassLike(origNode);
      } else if (ts.isParenthesizedExpression(origNode)) {
        visitTypeCast(origNode);
      }
    }

    function visitFunctionLike(node: ts.SignatureDeclaration, insideClass: boolean): void {
      const method = ts.isMethodDeclaration(node) && insideClass ? node : undefined;
      const accessibility = method && accessibilityFromJSDoc(method);
      const typeParameters =
        node.typeParameters || !acceptsTypeParameters(node) ? undefined : visitTypeParameters(node);
      const parameters = visitParameters(node);
      const returnType = annotateReturns ? visitReturnType(node) : node.type;
      if (
        !accessibility &&
        !typeParameters &&
        parameters === node.parameters &&
        returnType === node.type
      ) {
        return;
      }

      if (method && accessibility) {
        // Ahead of the keyword modifiers the member already has, and of its
        // name when it has only decorators.
        const pos = modifierPos(method);
        updates.replaceText(pos, pos, `${accessibility} `);
      }

      if (typeParameters) {
        // Before the parameter list, which an arrow function without parentheses replaces.
        const pos = typeParameterPos(node);
        // `<T>` on an arrow function reads as a JSX element in a .tsx file.
        const trailingComma = ts.isArrowFunction(node) && /\.[jt]sx$/.test(sourceFile.fileName);
        updates.replaceText(pos, pos, printTypeParameters(typeParameters, trailingComma));
      }

      const newParameters = factory.createNodeArray(parameters);
      const addParens = ts.isArrowFunction(node) && !hasParameterParentheses(node, sourceFile);
      updates.replaceNodes(node.parameters, newParameters, addParens);

      // `returnType` is the node's own annotation whenever the return type is
      // not being changed, and addReturnAnnotation only inserts: the parameter
      // list it is written after ends before the annotation the file already
      // holds.
      if (returnType && returnType !== node.type) {
        updates.addReturnAnnotation(node, returnType, addParens && parameters !== node.parameters);
      }
    }

    function visitTypeTag(node: ts.VariableDeclaration | ts.PropertyDeclaration): void {
      if (node.type) {
        // Don't overwrite existing annotations.
        return;
      }
      const typeNode = ts.getJSDocType(node);
      if (!typeNode) {
        return;
      }
      const type = printJSDocType(typeNode);
      const questionToken = ts.isPropertyDeclaration(node) ? node.questionToken : undefined;
      const pos = (node.exclamationToken ?? questionToken ?? node.name).end;
      updates.replaceText(pos, pos, `: ${type}`);
    }

    /**
     * Writes a `@type` tag on a parenthesized expression, which is a cast the
     * checker reads only in a JavaScript file, as `(expr as T)`. The
     * parentheses the cast is written with stay, so precedence around it does
     * not change, and the operand takes parentheses of its own when it is
     * written below the precedence `as` binds at.
     */
    function visitTypeCast(node: ts.ParenthesizedExpression): void {
      const tag = ts.getJSDocTypeTag(node);
      // getJSDocTypeTag also reads the comment on the statement an expression
      // is the whole of, which annotates that statement and not this one.
      if (!tag || !ts.isJSDoc(tag.parent) || tag.parent.parent !== node) {
        return;
      }
      const { expression } = node;
      if (
        ts.isAsExpression(expression) ||
        ts.isSatisfiesExpression(expression) ||
        ts.isTypeAssertionExpression(expression)
      ) {
        return;
      }
      const refusal = castRefusal(node);
      if (refusal) {
        noteFollowUp(
          node,
          `@type ${tag.typeExpression.getText(sourceFile)} stays a comment because ${refusal}`,
          'Write the cast as an as expression by hand; the expression keeps the type it has ' +
            'without the comment.',
        );
        return;
      }
      const type = printJSDocType(tag.typeExpression.type);
      updates.replaceText(tag.parent.getStart(sourceFile), node.getStart(sourceFile), '');
      if (needsParentheses(expression)) {
        const start = expression.getStart(sourceFile);
        updates.replaceText(start, start, '(');
        updates.replaceText(expression.end, expression.end, `) as ${type}`);
      } else {
        updates.replaceText(expression.end, expression.end, ` as ${type}`);
      }
    }

    /**
     * Writes the `@template` tags of a class after its name. Every parameter
     * is given a default, so a reference that passes no type arguments keeps
     * the meaning it had while the class was not generic, whatever file it is
     * in. An anonymous class has no name to write after.
     */
    function visitClassLike(node: ts.ClassLikeDeclaration): void {
      if (node.typeParameters) {
        // Don't overwrite existing type parameters.
        return;
      }
      const typeParameters = visitTypeParameters(node);
      if (!typeParameters) {
        return;
      }
      if (!node.name) {
        const names = typeParameters.map((typeParameter) => typeParameter.name.text).join(', ');
        noteFollowUp(
          node,
          `@template ${names} stays a comment because the class has no name`,
          'Name the class so the type parameters can be written on it; members that reference ' +
            'them keep the name the comment declared.',
        );
        return;
      }
      const pos = node.name.end;
      updates.replaceText(pos, pos, printTypeParameters(withAnyDefaults(typeParameters)));
    }

    function visitTypeParameters(node: ts.Node): ts.TypeParameterDeclaration[] | undefined {
      return typeParametersFromTags(
        ts.getAllJSDocTags(node, ts.isJSDocTemplateTag).filter(isHostTemplateTag),
      );
    }

    function withAnyDefaults(
      typeParameters: ts.TypeParameterDeclaration[],
    ): ts.TypeParameterDeclaration[] {
      return typeParameters.map((typeParameter) =>
        typeParameter.default
          ? typeParameter
          : factory.createTypeParameterDeclaration(
              typeParameter.modifiers,
              typeParameter.name,
              typeParameter.constraint,
              anyType,
            ),
      );
    }

    function typeParametersFromTags(
      tags: readonly ts.JSDocTemplateTag[],
    ): ts.TypeParameterDeclaration[] | undefined {
      if (tags.length === 0) {
        return undefined;
      }
      const typeParameters: ts.TypeParameterDeclaration[] = [];
      tags.forEach((tag) => {
        const constraint = tag.constraint ? visitJSDocType(tag.constraint.type) : undefined;
        tag.typeParameters.forEach((typeParameter) => {
          typeParameters.push(
            factory.createTypeParameterDeclaration(
              undefined,
              typeParameter.name.text,
              constraint,
              typeParameter.default ? visitJSDocType(typeParameter.default) : undefined,
            ),
          );
        });
      });
      return typeParameters;
    }

    function modifierPos(node: ts.MethodDeclaration): number {
      const keyword = node.modifiers?.find((modifier) => !ts.isDecorator(modifier));
      return (keyword ?? node.name).getStart(sourceFile);
    }

    function typeParameterPos(node: ts.SignatureDeclaration): number {
      const paren = node
        .getChildren(sourceFile)
        .find((child) => child.kind === ts.SyntaxKind.OpenParenToken);
      return paren ? paren.getStart(sourceFile) : node.parameters.pos;
    }

    function printTypeParameters(
      typeParameters: ts.TypeParameterDeclaration[],
      trailingComma = false,
    ): string {
      return printer.printList(
        trailingComma
          ? ts.ListFormat.TypeParameters | ts.ListFormat.AllowTrailingComma
          : ts.ListFormat.TypeParameters,
        factory.createNodeArray(typeParameters, trailingComma),
        sourceFile,
      );
    }

    function visitParameters(
      functionDeclaration: ts.SignatureDeclaration,
    ): ReadonlyArray<ts.ParameterDeclaration> {
      if (!ts.hasJSDocParameterTags(functionDeclaration)) {
        return functionDeclaration.parameters;
      }

      // create a new function declaration with a new type
      const newParams = functionDeclaration.parameters.map((param) => {
        if (param.type) {
          // Don't overwrite existing annotations.
          return param;
        }

        const destructured = destructuredParameterType(functionDeclaration, param);
        if (destructured) {
          return factory.createParameterDeclaration(
            param.modifiers,
            param.dotDotDotToken,
            param.name,
            param.questionToken,
            destructured,
            param.initializer,
          );
        }

        const paramNode = ts.getJSDocParameterTags(param).find((tag) => tag.typeExpression);
        if (!paramNode || !paramNode.typeExpression) {
          return param;
        }
        const typeNode = paramNode.typeExpression.type;
        const type = visitJSDocType(typeNode, true);

        const questionToken =
          !param.initializer &&
          ts.isIdentifier(param.name) &&
          (paramNode.isBracketed || ts.isJSDocOptionalType(typeNode))
            ? factory.createToken(ts.SyntaxKind.QuestionToken)
            : param.questionToken;

        const newParam = factory.createParameterDeclaration(
          param.modifiers,
          param.dotDotDotToken,
          param.name,
          questionToken,
          type,
          param.initializer,
        );

        return newParam;
      });
      if (functionDeclaration.parameters.some((param, i) => param !== newParams[i])) {
        // Only return the new array if something changed.
        return newParams;
      }
      return functionDeclaration.parameters;
    }

    /**
     * The object type described by `@param` tags that name what a destructuring
     * binds rather than the parameter itself (`@param {string} text` over
     * `({ text })`).
     *
     * A binding pattern has no name for TypeScript to match a tag to, so it
     * falls back to the tag in the same position, which here describes one
     * member and annotates the whole pattern with it. Undefined when no tag
     * names a member, which is the `@param {Options} options` case that
     * fallback exists for.
     */
    function destructuredParameterType(
      functionDeclaration: ts.SignatureDeclaration,
      param: ts.ParameterDeclaration,
    ): ts.TypeNode | undefined {
      if (!ts.isObjectBindingPattern(param.name)) {
        return undefined;
      }
      const bound = new Map<string, ts.BindingElement>();
      param.name.elements.forEach((element) => {
        if (element.dotDotDotToken) return;
        const key = element.propertyName ?? element.name;
        if (ts.isIdentifier(key) || ts.isStringLiteral(key)) {
          bound.set(key.text, element);
        }
      });

      const namedParameters = new Set(
        functionDeclaration.parameters
          .filter((other) => ts.isIdentifier(other.name))
          .map((other) => (other.name as ts.Identifier).text),
      );
      const unclaimed = ts
        .getJSDocTags(functionDeclaration)
        .filter(ts.isJSDocParameterTag)
        .filter((tag) => !(ts.isIdentifier(tag.name) && namedParameters.has(tag.name.text)));

      // One tag naming a binding is what separates this spelling from a tag
      // that names the parameter; the rest of the group then documents the
      // same object, including members the pattern leaves in a rest element.
      const memberTags = unclaimed.filter((tag) => ts.isIdentifier(tag.name));
      if (!memberTags.some((tag) => bound.has(tag.name.getText()))) {
        return undefined;
      }

      const members: ts.PropertySignature[] = [];
      const written = new Set<string>();
      const addMember = (name: string, type: ts.TypeNode | undefined): void => {
        if (written.has(name)) return;
        written.add(name);
        members.push(
          factory.createPropertySignature(
            undefined,
            propertyName(name),
            factory.createToken(ts.SyntaxKind.QuestionToken),
            type,
          ),
        );
      };

      memberTags.forEach((tag) => {
        const property = visitJSDocPropertyLikeTag(tag);
        if (!ts.isIdentifier(property.name) && !ts.isStringLiteral(property.name)) return;
        addMember(property.name.text, property.type);
      });
      // A binding the tags do not document still has to be readable, or the
      // annotation trades the wrong type for a missing property at every use.
      bound.forEach((_element, name) => addMember(name, anyType));
      return members.length > 0 ? factory.createTypeLiteralNode(members) : undefined;
    }

    function propertyName(name: string): ts.PropertyName {
      return isIdentifierName(name)
        ? factory.createIdentifier(name)
        : factory.createStringLiteral(name);
    }

    function visitReturnType(
      functionDeclaration: ts.SignatureDeclaration,
    ): ts.TypeNode | undefined {
      if (functionDeclaration.type) {
        // Don't overwrite existing annotations.
        return functionDeclaration.type;
      }
      const returnTypeNode = ts.getJSDocReturnType(functionDeclaration);
      if (!returnTypeNode) {
        return functionDeclaration.type;
      }
      return visitJSDocType(returnTypeNode);
    }

    /**
     * Writes a type alias for every convertible `@typedef` and `@callback`,
     * in place of the comment that declared it when the comment says nothing
     * else, and next to it otherwise. A tag in a nested scope moves out to the
     * statement that contains it, since the names it declares are file-wide.
     */
    function declareTypeAliases(scan: JSDocTypeAliasScan): void {
      const byDoc = new Map<ts.JSDoc, JSDocTypeAlias[]>();
      scan.aliases.forEach((alias) => {
        const group = byDoc.get(alias.doc) ?? [];
        group.push(alias);
        byDoc.set(alias.doc, group);
      });

      byDoc.forEach((aliases, doc) => {
        const statement = topLevelStatement(doc.parent);
        if (!statement) {
          return;
        }
        if (statement !== doc.parent) {
          const pos = statement.getStart(sourceFile);
          const indent = indentAt(pos);
          updates.replaceText(pos, pos, `${printAliases(aliases, indent)}\n${indent}`);
          return;
        }

        const pos = doc.getStart(sourceFile);
        const indent = indentAt(pos);
        const declarations = printAliases(aliases, indent);
        if (!consumesComment(doc, aliases)) {
          updates.replaceText(pos, pos, `${declarations}\n${indent}`);
          return;
        }
        const description = ts.getTextOfJSDocComment(doc.comment);
        const kept = description ? `${printComment(description, indent)}\n${indent}` : '';
        updates.replaceText(pos, doc.end, `${kept}${declarations}`);
      });
    }

    /** The statement of the file that contains a node, or the node itself. */
    function topLevelStatement(node: ts.Node): ts.Node | undefined {
      let current: ts.Node | undefined = node;
      while (current && current.parent !== sourceFile) {
        current = current.parent;
      }
      return current;
    }

    /** Whether the comment says nothing beyond the aliases taken out of it. */
    function consumesComment(doc: ts.JSDoc, aliases: JSDocTypeAlias[]): boolean {
      const converted = new Set<ts.Node>(aliases.map((alias) => alias.tag));
      return (doc.tags ?? []).every((tag) => converted.has(tag) || ts.isJSDocTemplateTag(tag));
    }

    function printAliases(aliases: JSDocTypeAlias[], indent: string): string {
      return aliases
        .map((alias) => printStatement(typeAliasFromTag(alias), indent))
        .join(`\n${indent}`);
    }

    function printStatement(node: ts.Statement, indent: string): string {
      const text = printer.printNode(ts.EmitHint.Unspecified, node, sourceFile);
      return indent ? text.split('\n').join(`\n${indent}`) : text;
    }

    /** The text of the TypeScript type a JSDoc type node converts to. */
    function printJSDocType(node: ts.Node): string {
      return printer.printNode(ts.EmitHint.Unspecified, visitJSDocType(node), sourceFile);
    }

    function printComment(description: string, indent: string): string {
      const lines = description.split('\n').map((line) => ` * ${line}`.trimEnd());
      return ['/**', ...lines, ' */'].join(`\n${indent}`);
    }

    function indentAt(pos: number): string {
      const lineStart = sourceFile.text.lastIndexOf('\n', pos - 1) + 1;
      return /^[ \t]*/.exec(sourceFile.text.slice(lineStart, pos))![0];
    }

    /**
     * Every type parameter written on an alias is given a default, so a
     * reference that passes no type arguments keeps the meaning it had while
     * the alias was not generic, whatever file it is in.
     */
    function typeAliasFromTag({ tag, doc, name }: JSDocTypeAlias): ts.TypeAliasDeclaration {
      const type = ts.isJSDocCallbackTag(tag)
        ? visitJSDocSignature(tag.typeExpression)
        : visitTypedefType(tag);
      const typeParameters = typeParametersFromTags(aliasTemplateTags(doc));
      return factory.createTypeAliasDeclaration(
        exportAliases ? [factory.createModifier(ts.SyntaxKind.ExportKeyword)] : undefined,
        factory.createIdentifier(name),
        typeParameters && withAnyDefaults(typeParameters),
        type,
      );
    }

    function visitTypedefType(tag: ts.JSDocTypedefTag): ts.TypeNode {
      const { typeExpression } = tag;
      if (!typeExpression) {
        return anyType;
      }
      if (!ts.isJSDocTypeLiteral(typeExpression)) {
        return visitJSDocType(typeExpression.type);
      }
      const type = visitJSDocTypeLiteral(typeExpression);
      // An object with no documented property says no more than any does.
      return ts.isTypeLiteralNode(type) && type.members.length === 0 ? anyType : type;
    }

    function visitJSDocSignature(node: ts.JSDocSignature): ts.TypeNode {
      const parameters: ts.ParameterDeclaration[] = [];
      const lastIndex = node.parameters.length - 1;
      node.parameters.forEach((tag, index) => {
        if (!ts.isIdentifier(tag.name)) {
          // A nested `@param opts.x` tag, already part of the parent's type.
          return;
        }
        parameters.push(visitJSDocParameterTag(tag, tag.name, index === lastIndex));
      });
      const returnType = node.type?.typeExpression?.type;
      return factory.createFunctionTypeNode(
        undefined,
        parameters,
        returnType ? visitJSDocType(returnType) : anyType,
      );
    }

    function visitJSDocParameterTag(
      tag: ts.JSDocParameterTag,
      name: ts.Identifier,
      isLast: boolean,
    ): ts.ParameterDeclaration {
      const typeNode = tag.typeExpression?.type;
      const isRest = !!typeNode && ts.isJSDocVariadicType(typeNode) && isLast;
      const optional =
        !isRest && (tag.isBracketed || (!!typeNode && ts.isJSDocOptionalType(typeNode)));
      return factory.createParameterDeclaration(
        undefined,
        isRest ? factory.createToken(ts.SyntaxKind.DotDotDotToken) : undefined,
        name.text,
        optional ? factory.createToken(ts.SyntaxKind.QuestionToken) : undefined,
        typeNode ? visitJSDocType(typeNode, true) : anyType,
        undefined,
      );
    }

    // All visitJSDoc functions are adapted from:
    // https://github.com/microsoft/TypeScript/blob/v4.0.2/src/services/codefixes/annotateWithTypeFromJSDoc.ts

    /**
     * The type a JSDoc node converts to, or the any type when that type is one
     * the printer cannot write.
     *
     * TypeScript's JSDoc parser recovers from a type it cannot read by handing
     * back a partial tree rather than by failing: a function type missing a
     * parameter name keeps the parameter as a member with no name, and drops
     * the return type entirely. Printing that tree writes text that does not
     * parse, which leaves the file broken and fails the whole migration, so
     * what cannot be written back takes `any` instead. Only the outermost call
     * checks, since a type built out of parts that each print is itself
     * printable, and the check costs a parse.
     */
    function visitJSDocType(node: ts.Node, topLevelParam = false): ts.TypeNode {
      visitDepth += 1;
      try {
        const type = visitJSDocTypeWorker(node, topLevelParam);
        return visitDepth === 1 && !isPrintableType(type) ? anyType : type;
      } finally {
        visitDepth -= 1;
      }
    }

    /** Whether the printed type reads back as the type it was written from. */
    function isPrintableType(type: ts.TypeNode): boolean {
      const text = printer.printNode(ts.EmitHint.Unspecified, type, sourceFile);
      const probe: ParsedSourceFile = ts.createSourceFile(
        'ts-migrate-jsdoc-probe.ts',
        `type __TsMigrateProbe = ${text};`,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ false,
        ts.ScriptKind.TS,
      );
      return !probe.parseDiagnostics || probe.parseDiagnostics.length === 0;
    }

    function visitJSDocTypeWorker(node: ts.Node, topLevelParam = false): ts.TypeNode {
      switch (node.kind) {
        case ts.SyntaxKind.JSDocAllType:
        case ts.SyntaxKind.JSDocUnknownType:
        // A namepath (`{module:store/widgets~Widget}`, or the bare `{module}`
        // that starts one) names a symbol in JSDoc's own namespace rather than
        // a type. TypeScript parses it into a node its printer emits nothing
        // for, so printing it writes an annotation with no type in it, and
        // TypeScript's own declaration emit reads the node as `any`.
        case ts.SyntaxKind.JSDocNamepathType:
          return anyType;
        case ts.SyntaxKind.JSDocOptionalType:
          if (topLevelParam) {
            // Ignore the optionality.
            // We'll make the entire parameter optional inside visitParameters
            return visitJSDocType((node as ts.JSDocOptionalType).type);
          }
          return visitJSDocOptionalType(node as ts.JSDocOptionalType);

        case ts.SyntaxKind.JSDocNonNullableType:
          return visitJSDocType((node as ts.JSDocNonNullableType).type);
        case ts.SyntaxKind.JSDocNullableType:
          return visitJSDocNullableType(node as ts.JSDocNullableType);
        case ts.SyntaxKind.JSDocVariadicType:
          return visitJSDocVariadicType(node as ts.JSDocVariadicType);
        case ts.SyntaxKind.JSDocFunctionType:
          return visitJSDocFunctionType(node as ts.JSDocFunctionType);
        case ts.SyntaxKind.JSDocTypeLiteral:
          return visitJSDocTypeLiteral(node as ts.JSDocTypeLiteral);
        case ts.SyntaxKind.TypeReference:
          return visitJSDocTypeReference(node as ts.TypeReferenceNode);
        default: {
          const visited = ts.visitEachChild(node, visitJSDocType, context);
          ts.setEmitFlags(visited, ts.EmitFlags.SingleLine);
          return visited as ts.TypeNode;
        }
      }
    }

    function visitJSDocOptionalType(node: ts.JSDocOptionalType) {
      return factory.createUnionTypeNode([
        ts.visitNode(node.type, visitJSDocType, ts.isTypeNode),
        factory.createKeywordTypeNode(ts.SyntaxKind.UndefinedKeyword),
      ]);
    }

    function visitJSDocNullableType(node: ts.JSDocNullableType) {
      return factory.createUnionTypeNode([
        ts.visitNode(node.type, visitJSDocType, ts.isTypeNode),
        factory.createLiteralTypeNode(factory.createToken(ts.SyntaxKind.NullKeyword)),
      ]);
    }

    function visitJSDocVariadicType(node: ts.JSDocVariadicType) {
      return factory.createArrayTypeNode(ts.visitNode(node.type, visitJSDocType, ts.isTypeNode));
    }

    function visitJSDocFunctionType(node: ts.JSDocFunctionType) {
      return factory.createFunctionTypeNode(
        undefined,
        node.parameters.map(visitJSDocParameter),
        node.type ?? anyType,
      );
    }

    function visitJSDocTypeLiteral(node: ts.JSDocTypeLiteral) {
      const type = factory.createTypeLiteralNode(
        (node.jsDocPropertyTags ?? []).map(visitJSDocPropertyLikeTag),
      );
      return node.isArrayType ? factory.createArrayTypeNode(type) : type;
    }

    function visitJSDocPropertyLikeTag(node: ts.JSDocPropertyLikeTag) {
      let optionalType = false;
      let type;
      if (node.typeExpression) {
        type = visitJSDocType(node.typeExpression.type);
        optionalType = ts.isJSDocOptionalType(node.typeExpression);
      } else {
        type = anyType;
      }
      const questionToken =
        node.isBracketed || optionalType
          ? factory.createToken(ts.SyntaxKind.QuestionToken)
          : undefined;
      if (ts.isIdentifier(node.name)) {
        return factory.createPropertySignature(undefined, node.name, questionToken, type);
      }
      // Assumption: the leaf field on the QualifiedName belongs directly to the parent object type.
      return factory.createPropertySignature(undefined, node.name.right, questionToken, type);
    }

    function visitJSDocParameter(node: ts.ParameterDeclaration) {
      if (!node.type) {
        return node;
      }
      const index = node.parent.parameters.indexOf(node);
      const isRest =
        node.type.kind === ts.SyntaxKind.JSDocVariadicType &&
        index === node.parent.parameters.length - 1;
      const name = node.name || (isRest ? 'rest' : `arg${index}`);
      const dotdotdot = isRest
        ? factory.createToken(ts.SyntaxKind.DotDotDotToken)
        : node.dotDotDotToken;
      return factory.createParameterDeclaration(
        node.modifiers,
        dotdotdot,
        name,
        node.questionToken,
        ts.visitNode(node.type, visitJSDocType, ts.isTypeNode),
        node.initializer,
      );
    }

    function visitJSDocTypeReference(node: ts.TypeReferenceNode) {
      if (danglingNames.has(entityNameText(node.typeName))) {
        return anyType;
      }
      if (!ts.isIdentifier(node.typeName)) {
        return factory.createTypeReferenceNode(node.typeName, node.typeArguments);
      }
      if (isJSDocIndexSignature(node)) {
        return visitJSDocIndexSignature(node);
      }
      if (aliasNames.has(node.typeName.text)) {
        return factory.createTypeReferenceNode(
          factory.createIdentifier(node.typeName.text),
          ts.visitNodes(node.typeArguments, visitJSDocType, ts.isTypeNode),
        );
      }
      let { text } = node.typeName;
      let acceptsTypeParameters = true;
      if (text in typeMap) {
        const typeOptions = typeMap[text];
        if (typeof typeOptions === 'string') {
          text = typeOptions;
        } else {
          if (typeOptions.tsName) {
            text = typeOptions.tsName;
          }
          acceptsTypeParameters = typeOptions.acceptsTypeParameters !== false;
        }
      }

      const name = factory.createIdentifier(text);
      let args: ts.NodeArray<ts.TypeNode> | undefined;
      if (!acceptsTypeParameters) {
        args = undefined;
      } else if ((text === 'Array' || text === 'Promise') && !node.typeArguments) {
        args = factory.createNodeArray([anyType]);
      } else {
        args = ts.visitNodes(node.typeArguments, visitJSDocType, ts.isTypeNode);
      }
      return factory.createTypeReferenceNode(name, args);
    }

    function visitJSDocIndexSignature(node: ts.TypeReferenceNode) {
      const typeArguments = node.typeArguments!;
      const index = factory.createParameterDeclaration(
        /* modifiers */ undefined,
        /* dotDotDotToken */ undefined,
        typeArguments[0].kind === ts.SyntaxKind.NumberKeyword ? 'n' : 's',
        /* questionToken */ undefined,
        factory.createTypeReferenceNode(
          typeArguments[0].kind === ts.SyntaxKind.NumberKeyword ? 'number' : 'string',
          [],
        ),
        /* initializer */ undefined,
      );
      const indexSignature = factory.createTypeLiteralNode([
        factory.createIndexSignature(
          /* modifiers */ undefined,
          [index],
          typeArguments[1],
        ),
      ]);
      ts.setEmitFlags(indexSignature, ts.EmitFlags.SingleLine);
      return indexSignature;
    }
  };

const accessibilityMask =
  ts.ModifierFlags.Private | ts.ModifierFlags.Protected | ts.ModifierFlags.Public;

/** The accessibility keyword a method's JSDoc asks for, if it declares none. */
function accessibilityFromJSDoc(methodDeclaration: ts.MethodDeclaration): string | undefined {
  if ((ts.getCombinedModifierFlags(methodDeclaration) & accessibilityMask) !== 0) {
    // Don't overwrite existing accessibility modifier.
    return undefined;
  }
  if (ts.getJSDocPrivateTag(methodDeclaration)) {
    return 'private';
  }
  if (ts.getJSDocProtectedTag(methodDeclaration)) {
    return 'protected';
  }
  if (ts.getJSDocPublicTag(methodDeclaration)) {
    return 'public';
  }
  return undefined;
}

/** Why a `@type` cast cannot become an `as` expression, when it cannot. */
function castRefusal(node: ts.ParenthesizedExpression): string | undefined {
  if (ts.isDeleteExpression(node.parent)) {
    return 'delete takes a property reference and not an assertion';
  }
  if (isWriteTarget(node)) {
    return 'the cast is an assignment target';
  }
  if (inRewrittenParameters(node)) {
    return 'the parameter list it sits in is written out again from its own tags';
  }
  return undefined;
}

/**
 * Whether an annotated parameter list is written out again over this node.
 * visitParameters reprints the whole list, from the nodes the file was parsed
 * with, so an edit inside one of the defaults is lost either way and the two
 * ranges overlap.
 */
function inRewrittenParameters(node: ts.Node): boolean {
  for (let current = node.parent; current && !ts.isSourceFile(current); current = current.parent) {
    if (ts.isParameter(current) && rewritesParameters(current.parent)) {
      return true;
    }
  }
  return false;
}

function rewritesParameters(node: ts.SignatureDeclaration): boolean {
  return (
    ts.hasJSDocParameterTags(node) &&
    node.parameters.some(
      (parameter) =>
        !parameter.type && ts.getJSDocParameterTags(parameter).some((tag) => tag.typeExpression),
    )
  );
}

/** Whether an expression is assigned to rather than read. */
function isWriteTarget(node: ts.Expression): boolean {
  let current: ts.Node = node;
  let { parent } = current;
  while (
    ts.isParenthesizedExpression(parent) ||
    ts.isArrayLiteralExpression(parent) ||
    ts.isObjectLiteralExpression(parent) ||
    ts.isPropertyAssignment(parent) ||
    ts.isSpreadElement(parent) ||
    ts.isSpreadAssignment(parent)
  ) {
    current = parent;
    parent = current.parent;
  }
  if (ts.isBinaryExpression(parent)) {
    return parent.left === current && isAssignmentOperatorKind(parent.operatorToken.kind);
  }
  if (ts.isForInStatement(parent) || ts.isForOfStatement(parent)) {
    return parent.initializer === current;
  }
  if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) {
    return (
      parent.operator === ts.SyntaxKind.PlusPlusToken ||
      parent.operator === ts.SyntaxKind.MinusMinusToken
    );
  }
  return false;
}

/** The binary operators that bind less tightly than `as`. */
const looseOperators = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.CommaToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarToken,
  ts.SyntaxKind.CaretToken,
  ts.SyntaxKind.AmpersandToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);

/**
 * Whether `expr as T` would take less than the whole expression. `as` binds
 * like a relational operator and to its left, so only an operand written
 * below that precedence has to keep parentheses of its own.
 */
function needsParentheses(node: ts.Expression): boolean {
  if (ts.isBinaryExpression(node)) {
    const { kind } = node.operatorToken;
    return looseOperators.has(kind) || isAssignmentOperatorKind(kind);
  }
  return ts.isConditionalExpression(node) || ts.isArrowFunction(node) || ts.isYieldExpression(node);
}

/** Constructors and accessors take none, whatever their comment says. */
function acceptsTypeParameters(node: ts.SignatureDeclaration): boolean {
  return (
    !ts.isConstructorDeclaration(node) &&
    !ts.isGetAccessorDeclaration(node) &&
    !ts.isSetAccessorDeclaration(node)
  );
}

function entityNameText(name: ts.EntityName): string {
  return ts.isIdentifier(name) ? name.text : `${entityNameText(name.left)}.${name.right.text}`;
}

// Copied from: https://github.com/microsoft/TypeScript/blob/v4.0.2/src/compiler/utilities.ts#L1879
function isJSDocIndexSignature(node: ts.TypeReferenceNode | ts.ExpressionWithTypeArguments) {
  return (
    ts.isTypeReferenceNode(node) &&
    ts.isIdentifier(node.typeName) &&
    node.typeName.escapedText === 'Object' &&
    node.typeArguments &&
    node.typeArguments.length === 2 &&
    (node.typeArguments[0].kind === ts.SyntaxKind.StringKeyword ||
      node.typeArguments[0].kind === ts.SyntaxKind.NumberKeyword)
  );
}
