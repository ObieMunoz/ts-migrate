import ts from 'typescript';

/** A tag that names a type: `@typedef` or `@callback`. */
export type JSDocTypeAliasTag = ts.JSDocTypedefTag | ts.JSDocCallbackTag;

export interface JSDocTypeAlias {
  tag: JSDocTypeAliasTag;
  doc: ts.JSDoc;
  name: string;
}

export interface SkippedJSDocTypeAlias {
  /** The tag as it reads in the source, e.g. `@typedef Foo`. */
  tagText: string;
  reason: string;
  /** The comment the tag is in, which is what stays behind and can be marked. */
  doc: ts.JSDoc;
}

export interface JSDocTypeAliasScan {
  /** Tags that can become a type alias, in source order. */
  aliases: JSDocTypeAlias[];
  /** Tags that stay comments, and why. */
  skipped: SkippedJSDocTypeAlias[];
  /** Names that only an unconvertible tag declares. */
  skippedNames: Set<string>;
}

/**
 * The JSDoc comments attached to a node.
 *
 * ts.getJSDocTags only reports the last comment of a node, so a `@typedef`
 * block stacked above a documented declaration is invisible to it.
 */
export function jsDocsOf(node: ts.Node, sourceFile: ts.SourceFile): ts.JSDoc[] {
  if (node.getStart(sourceFile, /* includeJsDocComment */ true) === node.getStart(sourceFile)) {
    return [];
  }
  return node.getChildren(sourceFile).filter(ts.isJSDoc);
}

/**
 * Whether a `@template` tag belongs to the node its comment documents. A tag
 * in a comment that declares a type alias belongs to that alias instead.
 */
export function isHostTemplateTag(tag: ts.JSDocTemplateTag): boolean {
  const doc = tag.parent;
  if (!ts.isJSDoc(doc)) {
    return true;
  }
  return !(doc.tags ?? []).some(
    (other) => ts.isJSDocTypedefTag(other) || ts.isJSDocCallbackTag(other),
  );
}

/** The `@template` tags of the comment that declares a type alias. */
export function aliasTemplateTags(doc: ts.JSDoc): ts.JSDocTemplateTag[] {
  const tags: readonly ts.JSDocTag[] = doc.tags ?? [];
  return tags.filter((tag): tag is ts.JSDocTemplateTag => ts.isJSDocTemplateTag(tag));
}

/** Finds every `@typedef` and `@callback` tag in the file. */
export function scanJSDocTypeAliases(sourceFile: ts.SourceFile): JSDocTypeAliasScan {
  const declared = declaredNames(sourceFile);
  const aliases: JSDocTypeAlias[] = [];
  const skipped: SkippedJSDocTypeAlias[] = [];
  const skippedNames = new Set<string>();
  const taken = new Set<string>();

  const skip = (
    tag: JSDocTypeAliasTag,
    doc: ts.JSDoc,
    name: string | undefined,
    reason: string,
  ) => {
    skipped.push({ tagText: tagText(tag, sourceFile), reason, doc });
    if (name !== undefined) {
      skippedNames.add(name);
    }
  };

  const visit = (node: ts.Node) => {
    jsDocsOf(node, sourceFile).forEach((doc) => {
      (doc.tags ?? []).forEach((tag) => {
        if (!ts.isJSDocTypedefTag(tag) && !ts.isJSDocCallbackTag(tag)) return;

        if (tag.fullName && !ts.isIdentifier(tag.fullName)) {
          skip(tag, doc, tag.fullName.getText(sourceFile), 'the name is qualified');
          return;
        }
        if (!tag.name || !ts.isIdentifier(tag.name)) {
          skip(tag, doc, undefined, 'the tag has no name');
          return;
        }
        const { text: name } = tag.name;
        if (declared.has(name)) {
          skip(tag, doc, name, 'the file already declares that name');
          return;
        }
        if (taken.has(name)) {
          skip(tag, doc, undefined, 'another tag in the file declares that name');
          return;
        }
        taken.add(name);
        aliases.push({ tag, doc, name });
      });
    });
    node.forEachChild(visit);
  };
  visit(sourceFile);

  return { aliases, skipped, skippedNames };
}

function tagText(tag: JSDocTypeAliasTag, sourceFile: ts.SourceFile): string {
  const kind = ts.isJSDocCallbackTag(tag) ? '@callback' : '@typedef';
  const name = tag.fullName ? tag.fullName.getText(sourceFile) : tag.name?.text;
  return name ? `${kind} ${name}` : kind;
}

/** The names of the file's own type declarations and of everything it imports. */
function declaredNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const addBindings = (statement: ts.ImportDeclaration) => {
    const clause = statement.importClause;
    if (!clause) return;
    if (clause.name) {
      names.add(clause.name.text);
    }
    const bindings = clause.namedBindings;
    if (!bindings) return;
    if (ts.isNamespaceImport(bindings)) {
      names.add(bindings.name.text);
    } else {
      bindings.elements.forEach((element) => names.add(element.name.text));
    }
  };

  sourceFile.statements.forEach((statement) => {
    if (ts.isImportDeclaration(statement)) {
      addBindings(statement);
    } else if (ts.isImportEqualsDeclaration(statement)) {
      names.add(statement.name.text);
    } else if (
      (ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    ) {
      names.add(statement.name.text);
    } else if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) {
      names.add(statement.name.text);
    }
  });
  return names;
}
