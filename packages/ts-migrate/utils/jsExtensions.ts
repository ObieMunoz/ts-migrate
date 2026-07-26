/**
 * The extensions TypeScript reads as JavaScript (ts.Extension.Js, .Jsx, .Cjs,
 * .Mjs), which is the set every command has to agree on: a file the compiler
 * would put in the program is a file the migration has an answer for. Written
 * without the leading dot, the way a `*.{js,jsx}` glob spells them.
 */
export const JS_EXTENSIONS = ['js', 'jsx', 'cjs', 'mjs'];

/** The JavaScript extension a path ends with, dot included. */
export const JS_EXTENSION_REGEX = new RegExp(`\\.(?:${JS_EXTENSIONS.join('|')})$`);

export function isJsExtension(extension: string): boolean {
  return JS_EXTENSIONS.includes(extension);
}
