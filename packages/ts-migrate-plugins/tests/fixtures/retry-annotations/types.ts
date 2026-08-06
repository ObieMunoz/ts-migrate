export function stamp(when: Date): string {
  return when.toISOString();
}

export function total(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}

export interface Entry {
  at: Date;
}

export function record(entry: Entry): void {
  entry.at.toISOString();
}
