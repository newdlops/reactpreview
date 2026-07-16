/**
 * Generates the isolated, read-only React tree adapter used by Page Inspector highlighting.
 *
 * React does not expose a public API that maps an arbitrary function-component invocation back to
 * its host DOM nodes. The adapter therefore reads only the boundary class's version-dependent Fiber
 * pointer and never mutates Fiber, hooks, queues, props, or application state. Keeping this private
 * compatibility code separate makes it removable when React publishes a stable host lookup API.
 */

/**
 * Builds browser source that locates the first host node on each rendered target branch.
 *
 * Expected generated-entry binding: `normalizePreviewInspectorHostElement(value)`. Function
 * declarations are hoisted, so this source may be inserted before that normalizer is declared.
 *
 * @returns Plain JavaScript source with a bounded read-only Fiber traversal helper.
 */
export function createPreviewInspectorFiberRuntimeSource(): string {
  return String.raw`
/** Reads the current boundary Fiber across React 16-19 class-instance field spellings. */
function readPreviewInspectorBoundaryFiber(boundary) {
  if (boundary === null || typeof boundary !== 'object') {
    return undefined;
  }
  const modernFiber = boundary._reactInternals;
  return modernFiber !== null && typeof modernFiber === 'object'
    ? modernFiber
    : boundary._reactInternalFiber;
}

/**
 * Finds top-level connected host nodes below one target boundary without changing the React tree.
 * The fixed visit ceiling fails closed if a future React version exposes a cyclic or novel shape.
 */
function collectPreviewInspectorFiberElements(boundary) {
  const boundaryFiber = readPreviewInspectorBoundaryFiber(boundary);
  if (boundaryFiber === undefined || boundaryFiber === null) {
    return [];
  }
  const elements = [];
  const pendingFibers = boundaryFiber.child === undefined ? [] : [boundaryFiber.child];
  const visitedFibers = new Set();
  let visitCount = 0;
  while (pendingFibers.length > 0 && visitCount < 4096) {
    const fiber = pendingFibers.pop();
    if (fiber === undefined || fiber === null || visitedFibers.has(fiber)) {
      continue;
    }
    visitedFibers.add(fiber);
    visitCount += 1;
    if (fiber.sibling !== undefined && fiber.sibling !== null) {
      pendingFibers.push(fiber.sibling);
    }
    const hostElement = normalizePreviewInspectorHostElement(fiber.stateNode);
    if (hostElement !== undefined) {
      elements.push(hostElement);
      continue;
    }
    if (fiber.child !== undefined && fiber.child !== null) {
      pendingFibers.push(fiber.child);
    }
  }
  return [...new Set(elements)].filter((element) => element?.isConnected !== false);
}
`;
}
