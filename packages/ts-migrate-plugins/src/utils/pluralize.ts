/** A count and its noun, `1 file` or `2 files`. */
export default function pluralize(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}
