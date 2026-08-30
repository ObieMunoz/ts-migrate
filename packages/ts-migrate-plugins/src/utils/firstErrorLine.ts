/** The first line of a thrown value's message, for a file notice reason. */
export default function firstErrorLine(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0].trim() : String(error);
}
