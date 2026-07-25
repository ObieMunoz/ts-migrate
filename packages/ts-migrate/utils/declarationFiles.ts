/**
 * A declaration file in any of its module formats: .d.ts, .d.mts, .d.cts.
 *
 * ts-migrate-server holds its own copy of this predicate in
 * src/migrate/index.ts. The two are deliberately not shared: the set of
 * declaration extensions is fixed by TypeScript rather than by us, so the
 * copies have nothing to drift towards, and the alternative is publishing a
 * filename predicate on the ts-migrate-server API that custom plugin authors
 * depend on. Share them if the rule ever stops being a plain extension test.
 */
export default function isDeclarationFile(fileName: string): boolean {
  return /\.d\.[cm]?ts$/.test(fileName);
}
