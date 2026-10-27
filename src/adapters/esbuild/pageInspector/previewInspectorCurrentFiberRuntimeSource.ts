/**
 * Resolves committed class boundaries without treating a reused Fiber return link as proof.
 * The generated adapter reads own data only, never mutates React, and bounds both ancestry and
 * child-membership work. Unsupported root shapes retain the legacy compatibility fallback.
 */

/** Creates the boundary resolver consumed by the surrounding read-only Fiber adapter. */
export function createPreviewInspectorCurrentFiberRuntimeSource(): string {
  return String.raw`
/** Finds a candidate through the committed root's child links, restricted to its ancestor corridor. */
function resolvePreviewInspectorCommittedBoundary(candidates) {
  const ancestors = new Set();
  const roots = new Set();
  const pendingAncestors = candidates.map((fiber) => ({ fiber, depth: 0 }));
  for (let index = 0; index < pendingAncestors.length && ancestors.size < 512; index += 1) {
    const { fiber, depth } = pendingAncestors[index];
    if (fiber === undefined || ancestors.has(fiber)) continue;
    ancestors.add(fiber);
    if (readPreviewInspectorOwnData(fiber, 'tag') === 3) {
      const current = readPreviewInspectorFiberLink(
        readPreviewInspectorOwnData(fiber, 'stateNode'), 'current',
      );
      if (readPreviewInspectorOwnData(current, 'tag') === 3) roots.add(current);
    }
    if (depth >= 256) continue;
    pendingAncestors.push(
      { fiber: readPreviewInspectorFiberLink(fiber, 'return'), depth: depth + 1 },
      { fiber: readPreviewInspectorFiberLink(fiber, 'alternate'), depth },
    );
  }
  if (roots.size === 0) return { rootObserved: false };
  const pending = [...roots];
  const visited = new Set();
  let visits = 0;
  while (pending.length > 0 && visits < PREVIEW_INSPECTOR_FIBER_VISIT_LIMIT) {
    const fiber = pending.pop();
    if (fiber === undefined || visited.has(fiber)) continue;
    visited.add(fiber);
    visits += 1;
    if (candidates.includes(fiber)) return { rootObserved: true, fiber };
    if (!roots.has(fiber)) pending.push(readPreviewInspectorFiberLink(fiber, 'sibling'));
    // Descend into the known corridor first: later unrelated siblings cannot hide an early target.
    if (ancestors.has(fiber) || roots.has(fiber)) {
      pending.push(readPreviewInspectorFiberLink(fiber, 'child'));
    }
  }
  return { rootObserved: true };
}

/** Reads the committed boundary across React 16-19 field spellings and shared bailout parents. */
function readPreviewInspectorBoundaryFiber(boundary) {
  const modernFiber = readPreviewInspectorOwnData(boundary, '_reactInternals');
  const legacyFiber = readPreviewInspectorOwnData(boundary, '_reactInternalFiber');
  const primary = modernFiber !== null && typeof modernFiber === 'object'
    ? modernFiber
    : legacyFiber !== null && typeof legacyFiber === 'object'
      ? legacyFiber
      : undefined;
  if (primary === undefined) return undefined;
  const alternate = readPreviewInspectorFiberLink(primary, 'alternate');
  const candidates = [primary, alternate].filter((candidate) => candidate !== undefined && (
    readPreviewInspectorOwnData(candidate, 'stateNode') === undefined ||
    readPreviewInspectorOwnData(candidate, 'stateNode') === boundary
  ));
  const committed = resolvePreviewInspectorCommittedBoundary(candidates);
  if (committed.rootObserved) return committed.fiber;
  return candidates.find((candidate) =>
    readPreviewInspectorFiberLink(candidate, 'child') !== undefined) ?? candidates[0];
}
`;
}
