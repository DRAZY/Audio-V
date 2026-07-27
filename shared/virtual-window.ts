export interface VirtualWindow<T> {
  items: T[];
  start: number;
  end: number;
  paddingTop: number;
  paddingBottom: number;
}

export function createVirtualWindow<T>(
  items: readonly T[],
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan: number,
): VirtualWindow<T> {
  if (rowHeight <= 0) throw new RangeError("Virtual row height must be positive.");
  const safeScrollTop = Math.max(0, scrollTop);
  const safeViewport = Math.max(0, viewportHeight);
  const safeOverscan = Math.max(0, Math.trunc(overscan));
  if (items.length === 0) {
    return {
      items: [],
      start: 0,
      end: 0,
      paddingTop: 0,
      paddingBottom: 0,
    };
  }
  const totalHeight = items.length * rowHeight;
  const boundedScrollTop = Math.min(
    safeScrollTop,
    Math.max(0, totalHeight - safeViewport),
  );
  const start = Math.max(
    0,
    Math.floor(boundedScrollTop / rowHeight) - safeOverscan,
  );
  const count =
    Math.max(1, Math.ceil(safeViewport / rowHeight)) + safeOverscan * 2;
  const end = Math.min(items.length, start + count);
  return {
    items: items.slice(start, end),
    start,
    end,
    paddingTop: start * rowHeight,
    paddingBottom: Math.max(0, (items.length - end) * rowHeight),
  };
}
