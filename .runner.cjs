/* Rewrite `<plugin>.run(mockPluginParams({...}))` onto a bound `run` helper. */
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const [, , file, pluginIdent, boundFileName] = process.argv;
const full = path.resolve('packages/ts-migrate-plugins/tests/src', file);
const text = fs.readFileSync(full, 'utf8');
const sf = ts.createSourceFile(full, text, ts.ScriptTarget.Latest, true);

const edits = [];
const skipped = [];

const visit = (node) => {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === pluginIdent &&
    node.expression.name.text === 'run' &&
    node.arguments.length === 1 &&
    ts.isCallExpression(node.arguments[0]) &&
    ts.isIdentifier(node.arguments[0].expression) &&
    node.arguments[0].expression.text === 'mockPluginParams' &&
    node.arguments[0].arguments.length === 1 &&
    ts.isObjectLiteralExpression(node.arguments[0].arguments[0])
  ) {
    const obj = node.arguments[0].arguments[0];
    let textExpr = null;
    let fileNameOk = false;
    const rest = [];
    let bail = false;

    for (const prop of obj.properties) {
      const name =
        prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))
          ? prop.name.text
          : null;
      if (!name) {
        bail = true;
        break;
      }
      if (name === 'text') {
        textExpr = ts.isShorthandPropertyAssignment(prop) ? 'text' : prop.initializer.getText(sf);
      } else if (name === 'fileName') {
        fileNameOk =
          ts.isPropertyAssignment(prop) &&
          ts.isStringLiteral(prop.initializer) &&
          prop.initializer.text === boundFileName;
        if (!fileNameOk) bail = true;
      } else {
        rest.push(prop.getText(sf));
      }
    }

    if (bail || !textExpr || !fileNameOk) {
      skipped.push(sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1);
    } else {
      const args = rest.length ? `${textExpr}, { ${rest.join(', ')} }` : textExpr;
      edits.push({ start: node.getStart(sf), end: node.getEnd(), replacement: `run(${args})` });
    }
  }
  ts.forEachChild(node, visit);
};
visit(sf);

let out = text;
for (const edit of edits.sort((a, b) => b.start - a.start)) {
  out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
}
fs.writeFileSync(full, out);
console.log(`${file}: rewrote ${edits.length}, skipped ${skipped.length} at ${skipped.join(', ')}`);
