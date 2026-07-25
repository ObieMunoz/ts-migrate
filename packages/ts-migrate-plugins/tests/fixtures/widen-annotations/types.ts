export interface Widget {
  id: number;
}

export function makeWidget(): Widget {
  return { id: 1 };
}
