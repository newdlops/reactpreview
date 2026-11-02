/**
 * Indexes exact identifier occurrences for repeated hook analysis of one immutable function AST.
 * A query skips only subtrees with no tracked spelling. Consumers retain their own scope,
 * shadowing, usage budgets and preorder decisions; no inference result or filesystem state is
 * cached. Weak ownership releases the index with its parser tree, including after editor changes.
 */
import ts from 'typescript';

interface NodeInterval {
  /** Direct children in source order, retained only for wide nodes that would be rescanned. */
  readonly children?: readonly ts.Node[];
  /** Inclusive ordinal assigned before visiting this node's children. */
  readonly start: number;
  /** Exclusive ordinal after every descendant has been visited. */
  readonly end: number;
}

interface ReferenceIndex {
  readonly intervals: ReadonlyMap<ts.Node, NodeInterval>;
  readonly occurrencesByName: ReadonlyMap<string, readonly number[]>;
}

/** Explicit DFS frame keeps deeply nested syntax off the JavaScript call stack. */
interface ReferenceFrame {
  readonly node: ts.Node;
  readonly start: number;
  readonly children: readonly ts.Node[];
  nextChild: number;
}

/** Source-order child visitor shared by full walks and exact-name indexed walks. */
type ReferenceTraversal = (node: ts.Node, visit: (child: ts.Node) => void) => void;

const indexesByOwner = new WeakMap<ts.Node, ReferenceIndex>();
const MINIMUM_INDEXED_CHILDREN = 16;
const NO_CHILDREN: readonly ts.Node[] = [];

/**
 * Creates a child walk restricted to ancestors of exact tracked identifier spellings.
 *
 * @param owner Immutable parser-tree root shared by adjacent binding analyses.
 * @param names Tracked binding names, captured when the walk is created.
 * @returns Original-order child traversal; the caller still decides whether to enter a child.
 */
export function createPreviewRuntimeHookReferenceTraversal(
  owner: ts.Node,
  names: ReadonlySet<string>,
): ReferenceTraversal {
  let index = indexesByOwner.get(owner);
  if (index === undefined) {
    index = indexReferences(owner);
    indexesByOwner.set(owner, index);
  }
  return createIndexedTraversal(index, names);
}

/**
 * Reuses an existing exact-name index without building a tree for an isolated auxiliary scan.
 *
 * @param owner Immutable parser-tree root previously admitted by the main hook analysis.
 * @param names Exact spellings captured for this consumer's unchanged scope rules.
 * @returns Indexed child walk when available, otherwise the ordinary complete TypeScript walk.
 */
export function reusePreviewRuntimeHookReferenceTraversal(
  owner: ts.Node,
  names: ReadonlySet<string>,
): ReferenceTraversal {
  const index = indexesByOwner.get(owner);
  return index === undefined
    ? (node, visit) => ts.forEachChild(node, visit)
    : createIndexedTraversal(index, names);
}

/** Captures this query's exact names while retaining only its immutable owner index. */
function createIndexedTraversal(
  index: ReferenceIndex,
  names: ReadonlySet<string>,
): ReferenceTraversal {
  const occurrences = [...names]
    .flatMap((name) => index.occurrencesByName.get(name) ?? [])
    .sort((left, right) => left - right);
  return (node, visit) => {
    const interval = index.intervals.get(node);
    if (interval?.children !== undefined) {
      visitIndexedChildren(index, interval, occurrences, visit);
      return;
    }
    ts.forEachChild(node, (child) => {
      const interval = index.intervals.get(child);
      // A foreign node cannot be ruled out by this tree's index. Preserve the full walk there.
      if (interval === undefined || containsOccurrence(occurrences, interval)) visit(child);
    });
  };
}

/** Seeks the next relevant child and skips the remaining occurrences inside its complete subtree. */
function visitIndexedChildren(
  index: ReferenceIndex,
  interval: NodeInterval,
  occurrences: readonly number[],
  visit: (child: ts.Node) => void,
): void {
  const children = interval.children;
  if (children === undefined) return;
  let childStart = 0;
  let occurrenceIndex = findOccurrenceAtOrAfter(occurrences, interval.start + 1);
  while ((occurrences[occurrenceIndex] ?? Infinity) < interval.end) {
    const occurrence = occurrences[occurrenceIndex] ?? Infinity;
    let lower = childStart;
    let upper = children.length;
    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      const child = children[middle];
      const end = child === undefined ? Infinity : (index.intervals.get(child)?.end ?? Infinity);
      if (end <= occurrence) lower = middle + 1;
      else upper = middle;
    }
    const child = children[lower];
    if (child === undefined) return;
    const childInterval = index.intervals.get(child);
    if (childInterval === undefined) return;
    visit(child);
    occurrenceIndex = findOccurrenceAtOrAfter(occurrences, childInterval.end);
    childStart = lower + 1;
  }
}

/** Assigns preorder intervals in one complete walk, before any name-specific scope pruning. */
function indexReferences(owner: ts.Node): ReferenceIndex {
  const intervals = new Map<ts.Node, NodeInterval>();
  const occurrencesByName = new Map<string, number[]>();
  let ordinal = 0;
  const open = (node: ts.Node): ReferenceFrame => {
    const start = ordinal++;
    if (ts.isIdentifier(node)) {
      const occurrences = occurrencesByName.get(node.text) ?? [];
      occurrences.push(start);
      occurrencesByName.set(node.text, occurrences);
    }
    let children: ts.Node[] | undefined;
    ts.forEachChild(node, (child) => {
      (children ??= []).push(child);
    });
    return { children: children ?? NO_CHILDREN, nextChild: 0, node, start };
  };
  const pending = [open(owner)];
  while (pending.length > 0) {
    const frame = pending.at(-1);
    if (frame === undefined) break;
    const child = frame.children[frame.nextChild++];
    if (child !== undefined) {
      pending.push(open(child));
      continue;
    }
    intervals.set(
      frame.node,
      frame.children.length >= MINIMUM_INDEXED_CHILDREN
        ? { children: frame.children, end: ordinal, start: frame.start }
        : { end: ordinal, start: frame.start },
    );
    pending.pop();
  }
  return { intervals, occurrencesByName };
}

/** Finds the first occurrence at or after a subtree's start without rescanning other names. */
function containsOccurrence(occurrences: readonly number[], interval: NodeInterval): boolean {
  const first = findOccurrenceAtOrAfter(occurrences, interval.start);
  return (occurrences[first] ?? Number.POSITIVE_INFINITY) < interval.end;
}

/** Returns a source-order insertion point without enumerating unrelated sibling syntax. */
function findOccurrenceAtOrAfter(occurrences: readonly number[], start: number): number {
  let lower = 0;
  let upper = occurrences.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if ((occurrences[middle] ?? Number.POSITIVE_INFINITY) < start) lower = middle + 1;
    else upper = middle;
  }
  return lower;
}
