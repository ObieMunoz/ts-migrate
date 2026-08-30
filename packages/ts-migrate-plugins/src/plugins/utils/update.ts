import ts from 'typescript';
import updateSourceText, { SourceTextUpdate } from '../../utils/updateSourceText';
import { spliceKeepingWhitespace } from './text';

/**
 * Tracks updates to a ts.SourceFile as text changes.
 * This is useful to preserve as much of the original whitespace in the source
 * file as possible. Re-printing the entire file causes blank lines to be lost.
 *
 * See: https://github.com/microsoft/TypeScript/issues/843
 */
class UpdateTracker {
  private updates: SourceTextUpdate[] = [];

  private printer = ts.createPrinter();

  constructor(private sourceFile: ts.SourceFile) {}

  private insert(pos: number, text: string): void {
    this.updates.push({
      kind: 'insert',
      index: pos,
      text,
    });
  }

  /**
   * Adds a return type annotation to a function.
   * replaceNode would require reprinting the entire function body, losing all whitespace details.
   *
   * Set parenthesizedParameters when the parameter list is being replaced with
   * a parenthesized one, so the parentheses are not written twice.
   */
  public addReturnAnnotation(
    node: ts.SignatureDeclaration,
    type: ts.TypeNode,
    parenthesizedParameters = false,
  ): void {
    const paren = node
      .getChildren(this.sourceFile)
      .find((node) => node.kind === ts.SyntaxKind.CloseParenToken);
    let pos;
    if (paren) {
      // Past the parenthesis itself, which a parameter list written over
      // several lines does not start at.
      pos = paren.end;
    } else if (parenthesizedParameters) {
      pos = node.parameters.end;
    } else {
      // Must be an arrow function with single parameter and no parentheses.
      // Add parentheses.
      pos = node.parameters.end;
      const [param] = node.parameters;
      this.insert(param.getStart(), '(');
      this.insert(pos, ')');
    }
    const text = this.printer.printNode(ts.EmitHint.Unspecified, type, this.sourceFile);
    this.insert(pos, `: ${text}`);
  }

  /**
   * Splices text over [pos, end). An empty range inserts.
   * For text a printed node cannot express on its own, such as a declaration
   * that takes the place of the comment that declared it.
   */
  public replaceText(pos: number, end: number, text: string): void {
    if (end > pos) {
      this.replace(pos, end - pos, text);
    } else {
      this.insert(pos, text);
    }
  }

  private replace(pos: number, length: number, text: string): void {
    this.updates.push({
      kind: 'replace',
      index: pos,
      length,
      text,
    });
  }

  public replaceNode(oldNode: ts.Node | undefined, newNode: ts.Node | undefined): void {
    if (oldNode && newNode && oldNode !== newNode) {
      let printedNextNode = this.printer.printNode(
        ts.EmitHint.Unspecified,
        newNode,
        this.sourceFile,
      );
      if (this.needsLeadingSemicolon(oldNode, printedNextNode)) {
        printedNextNode = `;${printedNextNode}`;
      }
      const text = spliceKeepingWhitespace(oldNode.getFullText(this.sourceFile), printedNextNode);
      this.updates.push({
        kind: 'replace',
        index: oldNode.pos,
        length: oldNode.end - oldNode.pos,
        text,
      });
    }
  }

  /**
   * In semicolon-free code, a printed replacement that begins with `(`, `[`, or
   * a template literal can merge into the previous statement
   * (e.g. `const x = {}` + `(a as any).b = 1` parses as a call).
   */
  private needsLeadingSemicolon(oldNode: ts.Node, printed: string): boolean {
    if (!ts.isExpressionStatement(oldNode) || !/^[([`]/.test(printed)) {
      return false;
    }
    const { parent } = oldNode;
    let statements: ts.NodeArray<ts.Statement>;
    if (parent && (ts.isSourceFile(parent) || ts.isBlock(parent) || ts.isModuleBlock(parent))) {
      statements = parent.statements;
    } else if (parent && (ts.isCaseClause(parent) || ts.isDefaultClause(parent))) {
      statements = parent.statements;
    } else {
      // Unbraced if/else bodies etc.: a leading semicolon would detach the statement.
      return false;
    }
    const index = statements.indexOf(oldNode);
    if (index <= 0) {
      return false;
    }
    const lastToken = statements[index - 1].getLastToken(this.sourceFile);
    if (!lastToken || lastToken.kind === ts.SyntaxKind.SemicolonToken) {
      return false;
    }
    // A closing brace only merges when it ends an expression (object literal).
    if (
      lastToken.kind === ts.SyntaxKind.CloseBraceToken &&
      !ts.isObjectLiteralExpression(lastToken.parent)
    ) {
      return false;
    }
    return true;
  }

  public replaceNodes<T extends ts.Node>(
    oldNodes: ts.NodeArray<T>,
    newNodes: ts.NodeArray<T>,
    addParens = false,
  ): void {
    if (oldNodes !== newNodes) {
      const listFormat = addParens ? ts.ListFormat.Parenthesis : ts.ListFormat.CommaListElements;
      const printedNextNode = this.printer.printList(listFormat, newNodes, this.sourceFile);
      const prevText = this.sourceFile.text.substring(oldNodes.pos, oldNodes.end);
      const text = spliceKeepingWhitespace(prevText, printedNextNode);
      this.replace(oldNodes.pos, oldNodes.end - oldNodes.pos, text);
    }
  }

  /**
   * Returns the result of applying all tracked changes to the source file.
   */
  public apply(): string {
    return updateSourceText(this.sourceFile.text, this.updates);
  }
}

export default UpdateTracker;
