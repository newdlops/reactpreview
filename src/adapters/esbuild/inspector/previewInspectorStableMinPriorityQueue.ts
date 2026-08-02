/** Stable synchronous minimum-priority queue backed by a binary heap. */
export interface PreviewInspectorStableMinPriorityQueue<Value> {
  readonly size: number;
  push(value: Value): void;
  popMinimum(): Value | undefined;
}

interface HeapEntry<Value> {
  readonly ordinal: number;
  readonly value: Value;
}

/** Creates a stable minimum-priority queue without rewriting queued values. */
export function createPreviewInspectorStableMinPriorityQueue<Value>(
  initialValues: readonly Value[],
  compare: (left: Value, right: Value) => number,
): PreviewInspectorStableMinPriorityQueue<Value> {
  let nextOrdinal = 0;
  const heap = initialValues.map((value) => ({ ordinal: nextOrdinal++, value }));
  const compareEntries = (left: HeapEntry<Value>, right: HeapEntry<Value>): number => {
    const compared = compare(left.value, right.value);
    return compared === 0 || Number.isNaN(compared) ? left.ordinal - right.ordinal : compared;
  };
  const siftDown = (startIndex: number): void => {
    let parentIndex = startIndex;
    for (;;) {
      const leftIndex = parentIndex * 2 + 1;
      const leftEntry = heap[leftIndex];
      if (leftEntry === undefined) return;
      const rightIndex = leftIndex + 1;
      const rightEntry = heap[rightIndex];
      const minimumChildIndex =
        rightEntry !== undefined && compareEntries(rightEntry, leftEntry) < 0
          ? rightIndex
          : leftIndex;
      const minimumChild = heap[minimumChildIndex];
      const parentEntry = heap[parentIndex];
      if (
        minimumChild === undefined ||
        parentEntry === undefined ||
        compareEntries(minimumChild, parentEntry) >= 0
      )
        return;
      heap[parentIndex] = minimumChild;
      heap[minimumChildIndex] = parentEntry;
      parentIndex = minimumChildIndex;
    }
  };
  for (let index = Math.floor(heap.length / 2) - 1; index >= 0; index -= 1) siftDown(index);
  return Object.freeze({
    get size(): number {
      return heap.length;
    },
    popMinimum(): Value | undefined {
      const minimum = heap[0];
      if (minimum === undefined) return undefined;
      const last = heap.pop();
      if (heap.length > 0 && last !== undefined) {
        heap[0] = last;
        siftDown(0);
      }
      return minimum.value;
    },
    push(value: Value): void {
      const entry = { ordinal: nextOrdinal++, value };
      heap.push(entry);
      let childIndex = heap.length - 1;
      while (childIndex > 0) {
        const parentIndex = Math.floor((childIndex - 1) / 2);
        const childEntry = heap[childIndex];
        const parentEntry = heap[parentIndex];
        if (
          childEntry === undefined ||
          parentEntry === undefined ||
          compareEntries(childEntry, parentEntry) >= 0
        )
          return;
        heap[parentIndex] = childEntry;
        heap[childIndex] = parentEntry;
        childIndex = parentIndex;
      }
    },
  });
}
