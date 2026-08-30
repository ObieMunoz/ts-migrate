/**
 * The dependency fields of a project's package.json, which is the whole of
 * what detection reads one for: which bundler builds the project, and whether
 * an installed package changes what an import of an asset resolves to.
 */
export interface DependencyManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}
