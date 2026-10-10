/**
 * Generates identity proofs that the authored page owners of a Page Execution are mounted.
 *
 * Owner names alone fail for factory, HOC, and styled-components roots (`withProps(Component)`,
 * `Styled(Component)`). The generated execution source therefore marks its own function and the
 * bridge that renders the execution root, and registers every imported owner component with its
 * source and export. These helpers read those marks from live Fibers. A target mounted beside the
 * page (overlay or deferred sibling, as for content of a closed modal) is proven by the bridge and
 * owners mounted in the same execution, never by anything outside it.
 */

/** Symbol key marking the generated bridge that renders the Page Execution root directly. */
export const PREVIEW_INSPECTOR_EXECUTION_ROOT_BRIDGE_KEY =
  'react-file-preview.page-execution-root-bridge';

/** Symbol key of the generated list of imported Page Execution owner components. */
export const PREVIEW_INSPECTOR_EXECUTION_SURFACES_KEY =
  'react-file-preview.page-execution-surfaces';

/** Symbol key marking the generated Page Execution component that contains one whole execution. */
export const PREVIEW_INSPECTOR_PAGE_EXECUTION_KEY = 'react-file-preview.page-execution';

/** Returns the browser fragment composed into the page-execution context runtime. */
export function createPreviewInspectorPageExecutionOwnerProofRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_EXECUTION_ROOT_BRIDGE_SYMBOL = Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_EXECUTION_ROOT_BRIDGE_KEY)});
const PREVIEW_INSPECTOR_EXECUTION_SURFACES_SYMBOL = Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_EXECUTION_SURFACES_KEY)});
const PREVIEW_INSPECTOR_PAGE_EXECUTION_SYMBOL = Symbol.for(${JSON.stringify(PREVIEW_INSPECTOR_PAGE_EXECUTION_KEY)});
const PREVIEW_INSPECTOR_EXECUTION_ROOT_BRIDGE_DEPTH_LIMIT = 256;
const PREVIEW_INSPECTOR_DETACHED_EXECUTION_FIBER_LIMIT = 4_000;
const previewInspectorDetachedTargetPlacements = new Set(['deferred-sibling', 'overlay-sibling']);

/** Reports whether the generator marked one component type with the given symbol. */
function hasPreviewInspectorGeneratedMark(fiber, symbol) {
  const type = typeof readPreviewInspectorOwnData === 'function'
    ? readPreviewInspectorOwnData(fiber, 'type')
    : undefined;
  try {
    return typeof type === 'function' && type[symbol] === true;
  } catch {
    return false;
  }
}

/** Visits the Fiber ancestors of each target boundary (bounded) until the visitor returns true. */
function visitPreviewInspectorTargetAncestors(state, visit) {
  if (
    typeof readPreviewInspectorTargetBoundaries !== 'function' ||
    typeof readPreviewInspectorBoundaryFiber !== 'function' ||
    typeof readPreviewInspectorFiberLink !== 'function' ||
    typeof readPreviewInspectorOwnData !== 'function'
  ) return false;
  const boundaries = readPreviewInspectorTargetBoundaries(state);
  if (!(boundaries instanceof Set)) return false;
  for (const boundary of boundaries) {
    let fiber = readPreviewInspectorFiberLink(readPreviewInspectorBoundaryFiber(boundary), 'return');
    const visited = new Set();
    for (
      let depth = 0;
      fiber !== undefined && depth < PREVIEW_INSPECTOR_EXECUTION_ROOT_BRIDGE_DEPTH_LIMIT &&
        !visited.has(fiber);
      depth += 1
    ) {
      visited.add(fiber);
      if (visit(fiber) === true) return true;
      fiber = readPreviewInspectorFiberLink(fiber, 'return');
    }
  }
  return false;
}

/**
 * Reports whether the generated execution-root bridge is a Fiber ancestor of the target. The bridge
 * renders the execution root as its only element, so the root is then mounted above the target even
 * when its runtime name differs from the export (a factory or HOC such as recompose withProps).
 */
function isPreviewInspectorExecutionRootMountedAboveTarget(state) {
  return visitPreviewInspectorTargetAncestors(state, (fiber) =>
    hasPreviewInspectorGeneratedMark(fiber, PREVIEW_INSPECTOR_EXECUTION_ROOT_BRIDGE_SYMBOL));
}

/** Normalizes one compiler source/export reference for identity comparison. */
function createPreviewInspectorExecutionSurfaceKey(sourcePath, exportName) {
  return typeof sourcePath === 'string' && typeof exportName === 'string'
    ? sourcePath.replaceAll('\\', '/') + '\0' + exportName
    : undefined;
}

/** Maps each registered imported owner component to its source/export key. */
function readPreviewInspectorExecutionSurfaceKeysByComponent() {
  const keyByComponent = new Map();
  let registry;
  try { registry = globalThis[PREVIEW_INSPECTOR_EXECUTION_SURFACES_SYMBOL]; } catch {}
  if (!Array.isArray(registry)) return keyByComponent;
  for (const entry of registry.slice(0, 64)) {
    const component = entry?.component;
    const key = createPreviewInspectorExecutionSurfaceKey(entry?.sourcePath, entry?.exportName);
    if (key !== undefined && (typeof component === 'function' ||
      (typeof component === 'object' && component !== null))) {
      keyByComponent.set(component, key);
    }
  }
  return keyByComponent;
}

/** Adds the registered owner key of one Fiber (by element type or resolved type) to keys. */
function addPreviewInspectorExecutionSurfaceKey(fiber, keyByComponent, keys) {
  for (const field of ['elementType', 'type']) {
    const key = keyByComponent.get(readPreviewInspectorOwnData(fiber, field));
    if (key !== undefined) keys.add(key);
  }
}

/**
 * Collects the imported Page Execution owner surfaces whose exact component is a Fiber ancestor of
 * the target. Styled-components and HOC owners mount under generated names such as
 * Styled(Component), so their identity, not their name, proves them.
 */
function collectPreviewInspectorMountedExecutionSurfaceKeys(state) {
  const keys = new Set();
  const keyByComponent = readPreviewInspectorExecutionSurfaceKeysByComponent();
  if (keyByComponent.size === 0) return keys;
  visitPreviewInspectorTargetAncestors(state, (fiber) => {
    addPreviewInspectorExecutionSurfaceKey(fiber, keyByComponent, keys);
    return false;
  });
  return keys;
}

/**
 * Reads the compiler-proven detached placement of the selected candidate. A placement the runtime
 * sets on the state for its contextual-target fallback (the page did not render the target) is a
 * repair, not authored page structure, and never proves the page owners.
 */
function readPreviewInspectorDetachedTargetPlacement(candidate) {
  const placement = candidate?.detachedTargetPlacement;
  return previewInspectorDetachedTargetPlacements.has(placement) ? placement : undefined;
}

/**
 * Proves the owners of a detached target. The exact target is mounted beside the authentic page,
 * so its owners are siblings, not ancestors: this searches only the generated Page Execution that
 * contains the target (bounded) for the marked bridge with a committed child and for registered
 * owner components below that bridge.
 */
function collectPreviewInspectorDetachedExecutionOwners(state) {
  const proof = { bridgeMounted: false, keys: new Set() };
  let execution;
  visitPreviewInspectorTargetAncestors(state, (fiber) => {
    if (!hasPreviewInspectorGeneratedMark(fiber, PREVIEW_INSPECTOR_PAGE_EXECUTION_SYMBOL)) {
      return false;
    }
    execution = fiber;
    return true;
  });
  if (execution === undefined) return proof;
  const keyByComponent = readPreviewInspectorExecutionSurfaceKeysByComponent();
  const pending = [readPreviewInspectorFiberLink(execution, 'child')];
  let bridge;
  for (let visited = 0; pending.length > 0 && visited < PREVIEW_INSPECTOR_DETACHED_EXECUTION_FIBER_LIMIT;) {
    const fiber = pending.pop();
    if (fiber === undefined) continue;
    visited += 1;
    if (
      bridge === undefined &&
      hasPreviewInspectorGeneratedMark(fiber, PREVIEW_INSPECTOR_EXECUTION_ROOT_BRIDGE_SYMBOL) &&
      readPreviewInspectorFiberLink(fiber, 'child') !== undefined
    ) {
      bridge = fiber;
      proof.bridgeMounted = true;
    }
    pending.push(
      readPreviewInspectorFiberLink(fiber, 'sibling'),
      readPreviewInspectorFiberLink(fiber, 'child'),
    );
  }
  if (bridge === undefined || keyByComponent.size === 0) return proof;
  const below = [readPreviewInspectorFiberLink(bridge, 'child')];
  for (let visited = 0; below.length > 0 && visited < PREVIEW_INSPECTOR_DETACHED_EXECUTION_FIBER_LIMIT;) {
    const fiber = below.pop();
    if (fiber === undefined) continue;
    visited += 1;
    addPreviewInspectorExecutionSurfaceKey(fiber, keyByComponent, proof.keys);
    below.push(
      readPreviewInspectorFiberLink(fiber, 'sibling'),
      readPreviewInspectorFiberLink(fiber, 'child'),
    );
  }
  return proof;
}

/** Compares one compiler reference with the selected execution root's source and export. */
function isPreviewInspectorExecutionRootReference(execution, sourcePath, exportName) {
  const rootPath = execution?.executionRootSourcePath;
  return typeof sourcePath === 'string' && typeof rootPath === 'string' &&
    sourcePath.replaceAll('\\', '/') === rootPath.replaceAll('\\', '/') &&
    exportName === execution.executionRootExportName;
}
`;
}
