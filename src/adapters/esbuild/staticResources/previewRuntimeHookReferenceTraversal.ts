/**
 * Indexes exact identifier occurrences for repeated hook analysis of one immutable function AST.
 * A query skips only subtrees with no tracked spelling. Consumers retain their own scope,
 * shadowing, usage budgets and preorder decisions; no inference result or filesystem state is
 * cached. Weak ownership releases the index with its parser tree, including after editor changes.
 */
import ts from 'typescript';

interface NodeInterval {
  /** Inclusive ordinal assigned before visiting this node's children. */
  readonly start: number;
  /** Exclusive ordinal after every descendant has been visited. */
  readonly end: number;
}

interface ReferenceIndex {
  readonly intervals: ReadonlyMap<ts.Node, NodeInterval>;
  readonly occurrencesByName: ReadonlyMap<string, readonly number[]>;
}

/** Source-order child visitor shared by full walks and exact-name indexed walks. */
type ReferenceTraversal = (node: ts.Node, visit: (child: ts.Node) => void) => void;

const indexesByOwner = new WeakMap<ts.Node, ReferenceIndex>();

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
    ts.forEachChild(node, (child) => {
      const interval = index.intervals.get(child);
      // A foreign node cannot be ruled out by this tree's index. Preserve the full walk there.
      if (interval === undefined || containsOccurrence(occurrences, interval)) visit(child);
    });
  };
}

/** Assigns preorder intervals in one complete walk, before any name-specific scope pruning. */
function indexReferences(owner: ts.Node): ReferenceIndex {
  const intervals = new Map<ts.Node, NodeInterval>();
  const occurrencesByName = new Map<string, number[]>();
  let ordinal = 0;
  const visit = (node: ts.Node): void => {
    const start = ordinal++;
    if (ts.isIdentifier(node)) {
      const occurrences = occurrencesByName.get(node.text) ?? [];
      occurrences.push(start);
      occurrencesByName.set(node.text, occurrences);
    }
    ts.forEachChild(node, visit);
    intervals.set(node, { end: ordinal, start });
  };
  visit(owner);
  return { intervals, occurrencesByName };
}

/** Finds the first occurrence at or after a subtree's start without rescanning other names. */
function containsOccurrence(occurrences: readonly number[], interval: NodeInterval): boolean {
  let lower = 0;
  let upper = occurrences.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if ((occurrences[middle] ?? Number.POSITIVE_INFINITY) < interval.start) lower = middle + 1;
    else upper = middle;
  }
  return (occurrences[lower] ?? Number.POSITIVE_INFINITY) < interval.end;
}
