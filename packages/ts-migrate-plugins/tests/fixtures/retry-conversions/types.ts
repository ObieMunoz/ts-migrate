export interface Widget {
  id: number;
}

export function store(widget: Widget): number {
  return widget.id;
}
