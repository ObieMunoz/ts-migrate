import ts from 'typescript';
import { Plugin } from '@obiemunoz/ts-migrate-server';
import { isDiagnosticWithLinePosition } from '../utils/type-guards';
import getTokenAtPosition from './utils/token-pos';
import { AnyAliasOptions, validateAnyAliasOptions } from '../utils/validateOptions';
import UpdateTracker from './utils/update';

type Options = AnyAliasOptions;

const supportedDiagnostics = new Set([
  // TS2339: Property '{0}' does not exist on type '{1}'.
  2339,
  // TS2571: Object is of type 'unknown'.
  2571,
  // TS18046: '{0}' is of type 'unknown'. (TS 4.4+ successor to TS2571.)
  18046,
]);

const addConversionsPlugin: Plugin<Options> = {
  name: 'add-conversions',

  run({ fileName, sourceFile, options, getLanguageService }) {
    // Filter out diagnostics we care about.
    const diags = getLanguageService()
      .getSemanticDiagnostics(fileName)
      .filter(isDiagnosticWithLinePosition)
      .filter((diag) => supportedDiagnostics.has(diag.code));

    const updates = new UpdateTracker(sourceFile);
    ts.transform(sourceFile, [addConversionsTransformerFactory(updates, diags, options)]);
    return updates.apply();
  },

  validate: validateAnyAliasOptions,
};

export default addConversionsPlugin;

const addConversionsTransformerFactory =
  (updates: UpdateTracker, diags: ts.DiagnosticWithLocation[], { anyAlias }: Options) =>
  (context: ts.TransformationContext) => {
    const { factory } = context;
    const anyType = anyAlias
      ? factory.createTypeReferenceNode(anyAlias)
      : factory.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword);

    let nodesToConvert: Set<ts.Node>;
    let replaceRegions: ReplaceRegion[];
    return (file: ts.SourceFile) => {
      nodesToConvert = new Set(
        diags
          .map((diag) => {
            const token = getTokenAtPosition(file, diag.start);
            switch (diag.code) {
              case 2339:
                if (!ts.isPropertyAccessExpression(token.parent)) {
                  return null;
                }
                return token.parent.expression;

              case 2571:
              case 18046:
                return token;

              default:
                // Should be impossible.
                return null;
            }
          })
          .filter((node): node is ts.Expression => node !== null),
      );
      replaceRegions = computeReplaceRegions(nodesToConvert);
      visit(file);
      return file;
    };

    function visit(origNode: ts.Node): ts.Node | undefined {
      const needsConversion = nodesToConvert.has(origNode);
      let node = ts.visitEachChild(origNode, visit, context);
      if (node === origNode && !needsConversion) {
        return origNode;
      }

      if (needsConversion) {
        node = factory.createAsExpression(node as ts.Expression, anyType);
      }

      if (shouldReplace(node) && !inReplaceRegion(origNode)) {
        replaceNode(origNode, node);
        return origNode;
      }

      return node;
    }

    // A node inside a range owned by another node defers to that owner:
    // recording its own update would nest inside the owner's replacement.
    function inReplaceRegion(node: ts.Node): boolean {
      return replaceRegions.some(
        (region) => region.owner !== node && region.pos <= node.pos && node.end <= region.end,
      );
    }

    // Nodes that have one expression child called "expression".
    type ExpressionChild =
      | ts.DoStatement
      | ts.IfStatement
      | ts.SwitchStatement
      | ts.WithStatement
      | ts.WhileStatement;

    /**
     * For nodes that contain both expression and statement children, only
     * replace the direct expression children. The statements have already
     * been replaced at a lower level and replacing them again can produce
     * duplicate statements or invalid syntax.
     */
    function replaceNode(origNode: ts.Node, newNode: ts.Node): void {
      switch (origNode.kind) {
        case ts.SyntaxKind.DoStatement:
        case ts.SyntaxKind.IfStatement:
        case ts.SyntaxKind.SwitchStatement:
        case ts.SyntaxKind.WithStatement:
        case ts.SyntaxKind.WhileStatement:
          updates.replaceNode(
            (origNode as ExpressionChild).expression,
            (newNode as ExpressionChild).expression,
          );
          break;

        case ts.SyntaxKind.ForStatement:
          updates.replaceNode(
            (origNode as ts.ForStatement).initializer,
            (newNode as ts.ForStatement).initializer,
          );
          updates.replaceNode(
            (origNode as ts.ForStatement).condition,
            (newNode as ts.ForStatement).condition,
          );
          updates.replaceNode(
            (origNode as ts.ForStatement).incrementor,
            (newNode as ts.ForStatement).incrementor,
          );
          break;

        case ts.SyntaxKind.ForInStatement:
        case ts.SyntaxKind.ForOfStatement:
          updates.replaceNode(
            (origNode as ts.ForInOrOfStatement).expression,
            (newNode as ts.ForInOrOfStatement).expression,
          );
          updates.replaceNode(
            (origNode as ts.ForInOrOfStatement).initializer,
            (newNode as ts.ForInOrOfStatement).initializer,
          );
          break;

        default:
          updates.replaceNode(origNode, newNode);
          break;
      }
    }
  };

type ReplaceRegion = { owner: ts.Node; pos: number; end: number };

/**
 * Computes the source ranges that will be rewritten for the given conversions,
 * keeping only the outermost ones. Statements within such a range must not
 * record their own replacement — nested text updates duplicate parts of the
 * enclosing range — so their changes bubble up into the owner's replacement.
 */
function computeReplaceRegions(conversions: Set<ts.Node>): ReplaceRegion[] {
  const regions: ReplaceRegion[] = [];
  conversions.forEach((conversion) => {
    const region = findReplaceRegion(conversion);
    if (
      region &&
      !regions.some((r) => r.owner === region.owner && r.pos === region.pos && r.end === region.end)
    ) {
      regions.push(region);
    }
  });
  return regions.filter(
    (region) =>
      !regions.some(
        (other) =>
          other.pos <= region.pos &&
          region.end <= other.end &&
          (other.pos < region.pos || region.end < other.end),
      ),
  );
}

function findReplaceRegion(conversion: ts.Node): ReplaceRegion | null {
  let child = conversion;
  while (child.parent && !shouldReplace(child.parent)) {
    child = child.parent;
  }
  const { parent } = child;
  if (!parent || ts.isSourceFile(parent)) {
    return null;
  }
  switch (parent.kind) {
    // replaceNode rewrites only the direct expression children of these
    // statements, i.e. the child the conversion bubbled up through.
    case ts.SyntaxKind.DoStatement:
    case ts.SyntaxKind.IfStatement:
    case ts.SyntaxKind.SwitchStatement:
    case ts.SyntaxKind.WithStatement:
    case ts.SyntaxKind.WhileStatement:
    case ts.SyntaxKind.ForStatement:
    case ts.SyntaxKind.ForInStatement:
    case ts.SyntaxKind.ForOfStatement:
      return { owner: parent, pos: child.pos, end: child.end };
    default:
      return { owner: parent, pos: parent.pos, end: parent.end };
  }
}

/**
 * Determines whether a node is eligible to be replaced.
 *
 * Replacing only the expression may produce invalid syntax due to missing parentheses.
 * There is still some risk of losing whitespace if the expression is contained within
 * an if statement condition or other construct that can contain blocks.
 */
function shouldReplace(node: ts.Node): boolean {
  if (isStatement(node)) {
    return true;
  }
  switch (node.kind) {
    case ts.SyntaxKind.CaseClause:
    case ts.SyntaxKind.ClassDeclaration:
    case ts.SyntaxKind.EnumMember:
    case ts.SyntaxKind.HeritageClause:
    case ts.SyntaxKind.PropertyDeclaration:
    case ts.SyntaxKind.SourceFile: // In case we missed any other case.
      return true;
    default:
      return false;
  }
}

function isStatement(node: ts.Node): node is ts.Statement {
  return ts.SyntaxKind.FirstStatement <= node.kind && node.kind <= ts.SyntaxKind.LastStatement;
}
