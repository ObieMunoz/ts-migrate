/**
 * The scaffold a plugin whose evidence lives in other files plans with: the
 * plan is computed once over the whole program and then served a file at a
 * time, and recomputed when the runner starts a pass over a different set of
 * files or hands back one this pass already served.
 *
 * Each plugin holds its own plan, so the state a pass carries between `run`
 * calls belongs to one plugin and not to the module.
 */
import ts from 'typescript';

export interface PlannedFile<T> {
  /** The text the plan was computed against; a file that has since changed is skipped. */
  text: string;
  items: T[];
}

export interface Pass<T> {
  files: Map<string, PlannedFile<T>>;
  /** Every file the plan was computed over, so a pass over a different set is noticed. */
  known: Set<string>;
  served: Set<string>;
}

/** What a plan is built from, and the set of files to record it was built over. */
export interface PlanContext {
  program: ts.Program;
  checker: ts.TypeChecker;
  known: Set<string>;
}

export interface WholeProgramPass<T> {
  /** What the current plan says about a file, replanning first where it is stale. */
  plannedFor(fileName: string, text: string, plan: () => Pass<T>): PlannedFile<T> | undefined;
}

/** A plan of its own, which each plugin creates once. */
export function createWholeProgramPass<T>(): WholeProgramPass<T> {
  let currentPass: Pass<T> | undefined;

  return {
    plannedFor(fileName, text, plan) {
      if (!currentPass || currentPass.served.has(fileName) || !currentPass.known.has(fileName)) {
        currentPass = plan();
      }
      currentPass.served.add(fileName);

      const planned = currentPass.files.get(fileName);
      if (!planned || planned.text !== text) {
        return undefined;
      }
      return planned;
    },
  };
}

/**
 * The plan `collect` builds, materialized against the text each file has now,
 * with the items of a file in the order they appear in it.
 */
export function planWholeProgram<T extends { start: number }>(
  languageService: ts.LanguageService,
  collect: (context: PlanContext) => Map<string, T[]>,
): Pass<T> {
  const pass: Pass<T> = { files: new Map(), known: new Set(), served: new Set() };
  const program = languageService.getProgram();
  if (!program) return pass;

  const byFile = collect({ program, checker: program.getTypeChecker(), known: pass.known });
  byFile.forEach((items, fileName) => {
    const source = program.getSourceFile(fileName);
    if (!source) return;
    pass.files.set(fileName, {
      text: source.text,
      items: items.sort((a, b) => a.start - b.start),
    });
  });
  return pass;
}

/** Groups items by the file they edit, copying rather than keeping the caller's array. */
export function addToFile<T>(byFile: Map<string, T[]>, fileName: string, items: readonly T[]): void {
  const forFile = byFile.get(fileName);
  if (forFile) {
    forFile.push(...items);
  } else {
    byFile.set(fileName, [...items]);
  }
}
