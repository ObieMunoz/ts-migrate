/**
 * Renders a catch binding for display. A catch binding is `unknown`, so every
 * caller has to decide what a non-Error throw reads as; this keeps that answer
 * in one place and walks the `cause` chain, which reading `.message` drops.
 */
export default function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const messages: string[] = [];
  const seen = new Set<unknown>();
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    // A cause cycle would otherwise spin here.
    if (seen.has(current)) break;
    seen.add(current);
    if (current.message) messages.push(current.message);
  }

  // An Error carrying no message at all still names its type.
  return messages.length > 0 ? messages.join(': ') : String(error);
}
