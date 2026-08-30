import ts from 'typescript';

/**
 * Whether the tag name is written as a plain name, so it can be named again in
 * a type. `Foo` and `Foo.Bar` can; a namespaced name or a `this` tag cannot.
 */
export function isNameableJsxTagName(tagName: ts.JsxTagNameExpression): boolean {
  if (ts.isIdentifier(tagName)) return true;
  return (
    ts.isPropertyAccessExpression(tagName) &&
    ts.isIdentifier(tagName.name) &&
    isNameableJsxTagName(tagName.expression as ts.JsxTagNameExpression)
  );
}

/**
 * The tag name as the type argument `React.ComponentProps` takes: the tag as a
 * string for an intrinsic element, and the value's type for a component.
 */
export function jsxTagNameTypeArgument(tagName: ts.JsxTagNameExpression): string {
  const text = tagName.getText();
  return ts.isIdentifier(tagName) && /^[a-z]/.test(text) ? `'${text}'` : `typeof ${text}`;
}
