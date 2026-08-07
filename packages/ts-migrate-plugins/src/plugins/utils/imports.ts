import ts from 'typescript';
import { SourceTextUpdate } from '../../utils/updateSourceText';
import { getTextPreservingWhitespace } from './text';

export type DefaultImport = { defaultImport: string; moduleSpecifier: string };
/**
 * `isTypeOnly` writes the name as `{ type Foo }` rather than `{ Foo }`, which
 * is what a project with `verbatimModuleSyntax` needs for a name that is only
 * ever a type. It is dropped where the declaration the name joins is already
 * an `import type`, since the two spellings cannot be combined.
 */
export type NamedImport = { namedImport: string; moduleSpecifier: string; isTypeOnly?: boolean };
export type ModuleImport = { moduleSpecifier: string };

type AddImport = DefaultImport | NamedImport;
type RemoveImport = DefaultImport | NamedImport | ModuleImport;
type AnyImport = DefaultImport | NamedImport | ModuleImport;

export function updateImports(
  sourceFile: ts.SourceFile,
  toAdd: AddImport[],
  toRemove: RemoveImport[],
) {
  const updates: SourceTextUpdate[] = [];
  const printer = ts.createPrinter();

  const usedIdentifiers = getUsedIdentifiers(sourceFile);
  const presentedImports = getPresentedImportIdentifiers(sourceFile);

  const toAddActual = uniqAddImportUpdates(toAdd).filter(
    (cur) =>
      (isDefaultImport(cur) &&
        usedIdentifiers.has(cur.defaultImport) &&
        !presentedImports.has(cur.defaultImport)) ||
      (isNamedImport(cur) &&
        usedIdentifiers.has(cur.namedImport) &&
        !presentedImports.has(cur.namedImport)),
  );
  const added = new Set<AddImport>();
  const isNotAdded = (cur: AddImport) => !added.has(cur);

  const importDeclarations = sourceFile.statements.filter(ts.isImportDeclaration);
  importDeclarations.forEach((importDeclaration) => {
    if (!importDeclaration.importClause) return;

    const moduleSpecifierText = importDeclaration.moduleSpecifier
      .getText(sourceFile)
      .replace(/['"]/g, '');

    const isModuleSpecifier = (cur: AnyImport) => cur.moduleSpecifier === moduleSpecifierText;

    let { importClause } = importDeclaration;

    const shouldRemoveAllUnused = toRemove.filter(isModuleImport).some(isModuleSpecifier);

    const shouldRemoveNameUnused = toRemove
      .filter(isDefaultImport)
      .some(
        (cur) =>
          cur.moduleSpecifier === moduleSpecifierText &&
          importClause.name != null &&
          cur.defaultImport != null &&
          cur.defaultImport === importClause.name.text,
      );

    if (
      (shouldRemoveAllUnused || shouldRemoveNameUnused) &&
      importClause.name &&
      !usedIdentifiers.has(importClause.name.text)
    ) {
      importClause = ts.factory.updateImportClause(
        importClause,
        importClause.isTypeOnly,
        undefined,
        importClause.namedBindings,
      );
    }

    toAddActual
      .filter(isDefaultImport)
      .filter(isModuleSpecifier)
      .filter(isNotAdded)
      .filter((cur) => importClause.name && cur.defaultImport === importClause.name.text)
      .forEach((cur) => added.add(cur));

    const nameToAdd = toAddActual
      .filter(isDefaultImport)
      .filter(isModuleSpecifier)
      .filter(isNotAdded);
    if (nameToAdd.length > 0 && importClause.name == null) {
      importClause = ts.factory.updateImportClause(
        importClause,
        importClause.isTypeOnly,
        ts.factory.createIdentifier(nameToAdd[0].defaultImport),
        importClause.namedBindings,
      );
      added.add(nameToAdd[0]);
    }

    if (
      shouldRemoveAllUnused &&
      importClause.namedBindings &&
      ts.isNamespaceImport(importClause.namedBindings) &&
      !usedIdentifiers.has(importClause.namedBindings.name.text)
    ) {
      importClause = ts.factory.updateImportClause(
        importClause,
        importClause.isTypeOnly,
        importClause.name,
        undefined,
      );
    }

    if (importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)) {
      const elements = importClause.namedBindings.elements.filter((el) => {
        const isUsed = usedIdentifiers.has(el.name.text);
        if (isUsed) return true;

        const shouldRemove =
          shouldRemoveAllUnused ||
          toRemove
            .filter(isNamedImport)
            .filter(isModuleSpecifier)
            .some((cur) => cur.namedImport === el.name.text);

        return !shouldRemove;
      });

      toAddActual
        .filter(isNamedImport)
        .filter(isModuleSpecifier)
        .filter(isNotAdded)
        .filter((cur) => elements.some((el) => el.name.text === cur.namedImport))
        .forEach((cur) => added.add(cur));

      if (elements.length !== importClause.namedBindings.elements.length) {
        importClause = ts.factory.updateImportClause(
          importClause,
          importClause.isTypeOnly,
          importClause.name,
          elements.length > 0
            ? ts.factory.updateNamedImports(importClause.namedBindings, elements)
            : undefined,
        );
      }
    }

    const namedToAdd = toAddActual
      .filter(isNamedImport)
      .filter(isModuleSpecifier)
      .filter(isNotAdded);
    if (namedToAdd.length > 0) {
      importClause = ts.factory.updateImportClause(
        importClause,
        importClause.isTypeOnly,
        importClause.name,
        ts.factory.createNamedImports([
          ...(importClause.namedBindings && ts.isNamedImports(importClause.namedBindings)
            ? importClause.namedBindings.elements
            : []),
          ...namedToAdd.map((cur) =>
            ts.factory.createImportSpecifier(
              !importClause.isTypeOnly && (cur.isTypeOnly ?? false),
              undefined,
              ts.factory.createIdentifier(cur.namedImport),
            ),
          ),
        ]),
      );
      namedToAdd.forEach((cur) => added.add(cur));
    }

    if (importClause !== importDeclaration.importClause) {
      let numImports = 0;
      if (importClause.name) {
        numImports += 1;
      }
      if (importClause.namedBindings) {
        if (ts.isNamespaceImport(importClause.namedBindings)) {
          numImports += 1;
        }
        if (ts.isNamedImports(importClause.namedBindings)) {
          numImports += importClause.namedBindings.elements.length;
        }
      }

      if (numImports > 0) {
        const upImpDec = ts.factory.updateImportDeclaration(
          importDeclaration,
          importDeclaration.modifiers,
          importClause,
          importDeclaration.moduleSpecifier,
          importDeclaration.attributes,
        );
        const text = getTextPreservingWhitespace(importDeclaration, upImpDec, sourceFile);
        updates.push({
          kind: 'replace',
          index: importDeclaration.pos,
          length: importDeclaration.end - importDeclaration.pos,
          text,
        });
      } else {
        const comments =
          ts.getLeadingCommentRanges(sourceFile.getFullText(), importDeclaration.pos) || [];
        const index =
          comments.length > 0 ? comments[comments.length - 1].end : importDeclaration.pos;
        updates.push({
          kind: 'delete',
          index,
          length: importDeclaration.end - index,
        });
      }
    }
  });

  const toAddRemaining = toAddActual.filter(isNotAdded);
  if (toAddRemaining.length > 0) {
    const nodes: ts.Node[] = [];

    const grouped: { [moduleSpecifier: string]: AddImport[] } = {};
    toAddRemaining.forEach((cur) => {
      grouped[cur.moduleSpecifier] = grouped[cur.moduleSpecifier] || [];
      grouped[cur.moduleSpecifier].push(cur);
    });

    Object.keys(grouped).forEach((moduleSpecifier) => {
      const nameToAdd = grouped[moduleSpecifier].filter(isDefaultImport);
      const namedToAdd = grouped[moduleSpecifier].filter(isNamedImport);

      const namedImports =
        namedToAdd.length > 0
          ? ts.factory.createNamedImports(
              namedToAdd.map((cur) =>
                ts.factory.createImportSpecifier(
                  cur.isTypeOnly ?? false,
                  undefined,
                  ts.factory.createIdentifier(cur.namedImport),
                ),
              ),
            )
          : undefined;

      if (nameToAdd.length <= 1) {
        nodes.push(
          ts.factory.createImportDeclaration(
            undefined,
            ts.factory.createImportClause(
              false,
              nameToAdd.length === 1
                ? ts.factory.createIdentifier(nameToAdd[0].defaultImport)
                : undefined,
              namedImports,
            ),
            ts.factory.createStringLiteral(moduleSpecifier),
          ),
        );
      } else {
        nodes.push(
          ts.factory.createImportDeclaration(
            undefined,
            ts.factory.createImportClause(false, undefined, namedImports),
            ts.factory.createStringLiteral(moduleSpecifier),
          ),
        );
        nameToAdd.forEach((cur) => {
          nodes.push(
            ts.factory.createImportDeclaration(
              undefined,
              ts.factory.createImportClause(
                false,
                ts.factory.createIdentifier(cur.defaultImport),
                undefined,
              ),
              ts.factory.createStringLiteral(moduleSpecifier),
            ),
          );
        });
      }
    });

    const pos =
      importDeclarations.length > 0 ? importDeclarations[importDeclarations.length - 1].end : 0;
    const printed = nodes
      .map((node) => printer.printNode(ts.EmitHint.Unspecified, node, sourceFile))
      .join('\n');

    // After the last import there is a line to continue; at the top of a file
    // that imports nothing there is the first statement to keep off.
    updates.push({ kind: 'insert', index: pos, text: pos > 0 ? `\n${printed}` : `${printed}\n` });
  }

  return updates;
}

function getUsedIdentifiers(sourceFile: ts.SourceFile) {
  const usedIdentifiers = new Set<string>();
  const visitor = (node: ts.Node) => {
    if (ts.isIdentifier(node)) {
      usedIdentifiers.add(node.text);
    }
    // Don't visit the import statements themselves.
    if (!ts.isImportDeclaration(node)) {
      ts.forEachChild(node, visitor);
    }
  };
  ts.forEachChild(sourceFile, visitor);

  return usedIdentifiers;
}

/** Every name the file's imports already bind, which is every name not to add. */
function getPresentedImportIdentifiers(sourceFile: ts.SourceFile) {
  return sourceFile.statements.filter(ts.isImportDeclaration).reduce((presentedImports, item) => {
    const clause = item.importClause;
    if (clause) {
      if (clause.name && ts.isIdentifier(clause.name)) {
        presentedImports.add(clause.name.text);
      }
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          presentedImports.add(clause.namedBindings.name.text);
        } else {
          clause.namedBindings.elements.forEach(
            (x) => x.name && presentedImports.add(x.name.escapedText.toString()),
          );
        }
      }
    }
    return presentedImports;
  }, new Set<string>());
}

function isDefaultImport(update: AnyImport): update is DefaultImport {
  return (update as DefaultImport).defaultImport != null;
}

function isNamedImport(update: AnyImport): update is NamedImport {
  return (update as NamedImport).namedImport != null;
}

function isModuleImport(update: AnyImport): update is ModuleImport {
  return (
    update.moduleSpecifier != null &&
    (update as DefaultImport).defaultImport == null &&
    (update as NamedImport).namedImport == null
  );
}

/**
 * One add per name, since a name is what an import binds and a file binds each
 * of its names once. Two modules offering one name is a duplicate identifier
 * rather than two imports, so the first module asked for wins.
 */
function uniqAddImportUpdates(updates: AddImport[]): AddImport[] {
  const seen = new Set<string>();
  return updates.filter((update) => {
    const name = isDefaultImport(update) ? update.defaultImport : update.namedImport;
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}
