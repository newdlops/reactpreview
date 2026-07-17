/**
 * Generates the isolated, read-only React Fiber adapter used by Page Inspector.
 *
 * React does not expose a public component-tree or component-to-host-node API. This compatibility
 * layer therefore reads a deliberately small subset of Fiber fields, never writes to Fiber, and
 * advertises an unavailable or partial capability when a React version no longer matches. Keeping
 * the adapter separate from the toolbar lets the UI consume a stable snapshot contract without
 * depending on React's private objects.
 */

/** Maximum private Fiber records inspected during one component-tree snapshot. */
export const PREVIEW_INSPECTOR_FIBER_VISIT_LIMIT = 4096;

/** Maximum project/component/host records exposed to the Inspector UI in one snapshot. */
export const PREVIEW_INSPECTOR_TREE_NODE_LIMIT = 512;

/**
 * Builds browser source for bounded component-tree collection, selection, and host lookup.
 *
 * Expected generated-entry binding: `normalizePreviewInspectorHostElement(value)`. Function
 * declarations are hoisted, so this source may be inserted before that normalizer is declared.
 * The emitted public runtime helpers are:
 *
 * - `collectPreviewInspectorFiberTree(boundaries, selectedId, options)`
 * - `selectPreviewInspectorFiberTreeNode(snapshot, id)`
 * - `findPreviewInspectorFiberTreeNodeByHost(snapshot, hostNode)`
 * - `collectPreviewInspectorFiberElements(boundary)` (legacy target-highlighting compatibility)
 *
 * @returns Plain JavaScript source with no React DevTools dependency and no Fiber mutation.
 */
export function createPreviewInspectorFiberRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_FIBER_VISIT_LIMIT = ${PREVIEW_INSPECTOR_FIBER_VISIT_LIMIT};
const PREVIEW_INSPECTOR_TREE_NODE_LIMIT = ${PREVIEW_INSPECTOR_TREE_NODE_LIMIT};
const PREVIEW_INSPECTOR_TREE_DEPTH_LIMIT = 128;
const PREVIEW_INSPECTOR_VALUE_DEPTH_LIMIT = 3;
const PREVIEW_INSPECTOR_VALUE_KEY_LIMIT = 24;
const PREVIEW_INSPECTOR_VALUE_ARRAY_LIMIT = 20;
const PREVIEW_INSPECTOR_VALUE_STRING_LIMIT = 240;
const PREVIEW_INSPECTOR_HOOK_LIMIT = 16;
const previewInspectorBlockedSnapshotKeys = new Set(['__proto__', 'constructor', 'prototype']);
const previewInspectorOwnedComponentNames = new Set([
  'PreviewContextSubscriptionBoundary',
  'PreviewErrorBoundary',
  'PreviewExportErrorBoundary',
  'PreviewExportGallery',
  'PreviewExportRenderer',
  'PreviewInspectorButton',
  'PreviewInspectorTargetBoundary',
  'PreviewInspectorTargetRenderer',
  'PreviewInspectorToolbar',
  'PreviewPageInspectorExportBoundary',
  'PreviewPageInspectorRootRenderer',
  'PreviewPageInspectorShell',
  'PreviewRenderedCommitSignal',
  'PreviewSetupFallbackBoundary',
]);

/** Reads only an own data descriptor and deliberately declines accessors and inherited getters. */
function readPreviewInspectorOwnData(value, propertyName) {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, propertyName);
    return descriptor !== undefined && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

/** Reads one private Fiber link without invoking a project-defined accessor. */
function readPreviewInspectorFiberLink(fiber, propertyName) {
  const value = readPreviewInspectorOwnData(fiber, propertyName);
  return value !== null && typeof value === 'object' ? value : undefined;
}

/** Reads the current boundary Fiber across React 16-19 class-instance field spellings. */
function readPreviewInspectorBoundaryFiber(boundary) {
  const modernFiber = readPreviewInspectorOwnData(boundary, '_reactInternals');
  if (modernFiber !== null && typeof modernFiber === 'object') return modernFiber;
  const legacyFiber = readPreviewInspectorOwnData(boundary, '_reactInternalFiber');
  return legacyFiber !== null && typeof legacyFiber === 'object' ? legacyFiber : undefined;
}

/** Returns a descriptor-safe component name through memo, forward-ref, and lazy-like wrappers. */
function readPreviewInspectorTypeName(type, seenTypes = new Set(), depth = 0) {
  if (typeof type === 'string') return type;
  if ((typeof type !== 'object' && typeof type !== 'function') || type === null) return undefined;
  if (depth >= 6 || seenTypes.has(type)) return undefined;
  seenTypes.add(type);
  const displayName = readPreviewInspectorOwnData(type, 'displayName');
  if (typeof displayName === 'string' && displayName.length > 0) return displayName;
  const functionName = readPreviewInspectorOwnData(type, 'name');
  if (typeof functionName === 'string' && functionName.length > 0) return functionName;
  for (const propertyName of ['render', 'type', '_result']) {
    const innerName = readPreviewInspectorTypeName(
      readPreviewInspectorOwnData(type, propertyName),
      seenTypes,
      depth + 1,
    );
    if (innerName !== undefined) return innerName;
  }
  const reactType = readPreviewInspectorOwnData(type, '$$typeof');
  const reactTypeName = typeof reactType === 'symbol' ? String(reactType) : '';
  if (reactTypeName.includes('react.memo')) return 'Memo';
  if (reactTypeName.includes('react.forward_ref')) return 'ForwardRef';
  if (reactTypeName.includes('react.lazy')) return 'Lazy';
  if (reactTypeName.includes('react.provider')) return 'Context.Provider';
  if (reactTypeName.includes('react.context')) return 'Context';
  return undefined;
}

/** Classifies common Fiber tags while treating unknown future tags as an inert other node. */
function classifyPreviewInspectorFiber(fiber) {
  const tag = readPreviewInspectorOwnData(fiber, 'tag');
  const type = readPreviewInspectorOwnData(fiber, 'type');
  const elementType = readPreviewInspectorOwnData(fiber, 'elementType');
  const stateNode = readPreviewInspectorOwnData(fiber, 'stateNode');
  const stateNodeType = readPreviewInspectorOwnData(stateNode, 'nodeType');
  if (typeof type === 'string') return 'host';
  if (stateNodeType === 3 || tag === 6) return 'text';
  if (tag === 3) return 'root';
  if (tag === 4) return 'portal';
  if (tag === 5 || stateNodeType === 1) return 'host';
  if (tag === 7) return 'fragment';
  if (tag === 9 || tag === 10) return 'context';
  if (tag === 11) return 'forward-ref';
  if (tag === 13 || tag === 19) return 'suspense';
  if (tag === 14 || tag === 15) return 'memo';
  if (tag === 16) return 'lazy';
  if (tag === 1) return 'class';
  const typePrototype = readPreviewInspectorOwnData(type, 'prototype');
  if (readPreviewInspectorOwnData(typePrototype, 'isReactComponent') !== undefined) return 'class';
  const reactType = readPreviewInspectorOwnData(elementType ?? type, '$$typeof');
  const reactTypeName = typeof reactType === 'symbol' ? String(reactType) : '';
  if (reactTypeName.includes('react.memo')) return 'memo';
  if (reactTypeName.includes('react.forward_ref')) return 'forward-ref';
  if (reactTypeName.includes('react.lazy')) return 'lazy';
  if (typeof type === 'function' || typeof elementType === 'function' || tag === 0 || tag === 2) {
    return 'function';
  }
  return 'other';
}

/** Creates a readable label without evaluating lazy payload initializers or component accessors. */
function namePreviewInspectorFiber(fiber, kind) {
  const type = readPreviewInspectorOwnData(fiber, 'type');
  const elementType = readPreviewInspectorOwnData(fiber, 'elementType');
  const namedType = readPreviewInspectorTypeName(type) ?? readPreviewInspectorTypeName(elementType);
  if (namedType !== undefined) return namedType;
  if (kind === 'root') return 'ReactRoot';
  if (kind === 'fragment') return 'Fragment';
  if (kind === 'suspense') return 'Suspense';
  if (kind === 'context') return 'Context';
  if (kind === 'text') return '#text';
  return kind === 'other' ? 'Anonymous' : kind;
}

/** Reports preview-owned wrappers that should be transparent in the project component tree. */
function isPreviewInspectorOwnedFiber(fiber, name, kind) {
  if (kind === 'root' || kind === 'fragment' || kind === 'portal') return true;
  if (previewInspectorOwnedComponentNames.has(name)) return true;
  return name.startsWith('ReactPreviewInspector(') || name.startsWith('ReactPreviewInspectorTarget(');
}

/** Detects the isolated Inspector host or shadow root without excluding authored application portals. */
function isPreviewInspectorUiContainer(value) {
  let current = value;
  const visited = new Set();
  for (let depth = 0; current !== null && current !== undefined && depth < 16; depth += 1) {
    if ((typeof current !== 'object' && typeof current !== 'function') || visited.has(current)) {
      return false;
    }
    visited.add(current);
    try {
      if (
        typeof current.getAttribute === 'function' &&
        current.getAttribute('data-react-preview-inspector-ui') !== null
      ) {
        return true;
      }
      current = current.host ?? current.parentElement ?? current.parentNode;
    } catch {
      return false;
    }
  }
  return false;
}

/** Prunes only the Inspector toolbar portal; project-owned modal and overlay portals remain visible. */
function isPreviewInspectorOwnedPortalFiber(fiber) {
  if (readPreviewInspectorOwnData(fiber, 'tag') !== 4) return false;
  const stateNode = readPreviewInspectorOwnData(fiber, 'stateNode');
  const containerInfo = readPreviewInspectorOwnData(stateNode, 'containerInfo') ?? stateNode;
  return isPreviewInspectorUiContainer(containerInfo);
}

/** Produces a short diagnostic token for a function without retaining executable project values. */
function describePreviewInspectorFunction(value) {
  const name = readPreviewInspectorOwnData(value, 'name');
  return '[Function' + (typeof name === 'string' && name.length > 0 ? ' ' + name : '') + ']';
}

/** Produces a bounded getter-free JSON-like copy of props, class state, and hook values. */
function snapshotPreviewInspectorValue(value, depth = 0, seen = new WeakSet()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    return value.length <= PREVIEW_INSPECTOR_VALUE_STRING_LIMIT
      ? value
      : value.slice(0, PREVIEW_INSPECTOR_VALUE_STRING_LIMIT - 1) + '…';
  }
  if (value === undefined) return '[undefined]';
  if (typeof value === 'bigint') return value.toString() + 'n';
  if (typeof value === 'symbol') return String(value);
  if (typeof value === 'function') return describePreviewInspectorFunction(value);
  if (typeof value !== 'object') return '[' + typeof value + ']';
  const nodeType = readPreviewInspectorOwnData(value, 'nodeType');
  if (nodeType === 1 || nodeType === 3) return '[DOM Node]';
  if (seen.has(value)) return '[Circular]';
  if (depth >= PREVIEW_INSPECTOR_VALUE_DEPTH_LIMIT) {
    return Array.isArray(value) ? '[Array]' : '[Object]';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const output = [];
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    const length = Math.min(
      Number.isSafeInteger(lengthDescriptor?.value) ? lengthDescriptor.value : 0,
      PREVIEW_INSPECTOR_VALUE_ARRAY_LIMIT,
    );
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      output.push(
        descriptor !== undefined && Object.prototype.hasOwnProperty.call(descriptor, 'value')
          ? snapshotPreviewInspectorValue(descriptor.value, depth + 1, seen)
          : descriptor === undefined
            ? '[empty]'
            : '[Getter]',
      );
    }
    if ((lengthDescriptor?.value ?? 0) > length) output.push('[+' + String(lengthDescriptor.value - length) + ']');
    return output;
  }
  const output = {};
  let keys;
  try {
    keys = Reflect.ownKeys(value).slice(0, PREVIEW_INSPECTOR_VALUE_KEY_LIMIT);
  } catch {
    return '[Uninspectable Object]';
  }
  for (const key of keys) {
    const name = typeof key === 'symbol' ? '[' + String(key) + ']' : key;
    if (previewInspectorBlockedSnapshotKeys.has(name)) continue;
    let descriptor;
    try {
      descriptor = Object.getOwnPropertyDescriptor(value, key);
    } catch {
      output[name] = '[Uninspectable]';
      continue;
    }
    if (descriptor === undefined) continue;
    if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      output[name] = descriptor.get !== undefined && descriptor.set !== undefined
        ? '[Getter/Setter]'
        : descriptor.get !== undefined
          ? '[Getter]'
          : '[Setter]';
      continue;
    }
    output[name] = snapshotPreviewInspectorValue(descriptor.value, depth + 1, seen);
  }
  try {
    if (Reflect.ownKeys(value).length > keys.length) output['…'] = '[Truncated]';
  } catch {
    output['…'] = '[Uninspectable remainder]';
  }
  return output;
}

/** Normalizes JSX-development or static graph evidence for the source-navigation protocol. */
function normalizePreviewInspectorSource(value, origin, approximate = false) {
  if (typeof value === 'string' && value.length > 0) {
    return { approximate, origin, sourcePath: value };
  }
  if (value === null || typeof value !== 'object') return undefined;
  const sourcePath =
    readPreviewInspectorOwnData(value, 'sourcePath') ??
    readPreviewInspectorOwnData(value, 'fileName');
  if (typeof sourcePath !== 'string' || sourcePath.length === 0) return undefined;
  const line = readPreviewInspectorOwnData(value, 'line') ?? readPreviewInspectorOwnData(value, 'lineNumber');
  const column =
    readPreviewInspectorOwnData(value, 'column') ?? readPreviewInspectorOwnData(value, 'columnNumber');
  const occurrenceStart = readPreviewInspectorOwnData(value, 'occurrenceStart');
  return {
    approximate,
    origin,
    sourcePath,
    ...(Number.isSafeInteger(line) && line > 0 ? { line } : {}),
    ...(Number.isSafeInteger(column) && column > 0 ? { column } : {}),
    ...(Number.isSafeInteger(occurrenceStart) && occurrenceStart >= 0 ? { occurrenceStart } : {}),
  };
}

/** Reads JSX debug source first, followed by data-only metadata on wrapper render chains. */
function readPreviewInspectorRuntimeSource(fiber) {
  const fiberSource = normalizePreviewInspectorSource(
    readPreviewInspectorOwnData(fiber, '_debugSource'),
    'jsx-debug',
  );
  if (fiberSource !== undefined) return fiberSource;
  let type = readPreviewInspectorOwnData(fiber, 'type') ?? readPreviewInspectorOwnData(fiber, 'elementType');
  const visited = new Set();
  for (let depth = 0; type !== null && type !== undefined && depth < 6; depth += 1) {
    if ((typeof type !== 'object' && typeof type !== 'function') || visited.has(type)) break;
    visited.add(type);
    for (const propertyName of ['_debugSource', '__source', 'source']) {
      const source = normalizePreviewInspectorSource(
        readPreviewInspectorOwnData(type, propertyName),
        'type-descriptor',
      );
      if (source !== undefined) return source;
    }
    type = readPreviewInspectorOwnData(type, 'render') ?? readPreviewInspectorOwnData(type, 'type');
  }
  return undefined;
}

/** Finds a matching static source from a name map, ancestry edge, or render-chain step. */
function readPreviewInspectorStaticSource(name, options) {
  const sourceByName = readPreviewInspectorOwnData(options, 'sourceByName');
  if (sourceByName instanceof Map) {
    const mapped = normalizePreviewInspectorSource(sourceByName.get(name), 'descriptor');
    if (mapped !== undefined) return mapped;
  } else {
    const mapped = normalizePreviewInspectorSource(
      readPreviewInspectorOwnData(sourceByName, name),
      'descriptor',
    );
    if (mapped !== undefined) return mapped;
  }
  const descriptor = readPreviewInspectorOwnData(options, 'descriptor');
  const inspector = readPreviewInspectorOwnData(descriptor, 'inspector') ?? descriptor;
  for (const referenceName of ['target', 'root']) {
    const reference = readPreviewInspectorOwnData(inspector, referenceName);
    if (readPreviewInspectorOwnData(reference, 'exportName') === name) {
      const source = normalizePreviewInspectorSource(reference, 'descriptor');
      if (source !== undefined) return source;
    }
  }
  const ancestry = readPreviewInspectorOwnData(inspector, 'ancestry');
  if (Array.isArray(ancestry)) {
    for (const edge of ancestry.slice(0, 32)) {
      for (const referenceName of ['child', 'owner']) {
        const reference = readPreviewInspectorOwnData(edge, referenceName);
        if (readPreviewInspectorOwnData(reference, 'exportName') === name) {
          const source = normalizePreviewInspectorSource(reference, 'ancestry');
          if (source !== undefined) return source;
        }
      }
      const localNames = readPreviewInspectorOwnData(edge, 'localOwnerNames');
      if (Array.isArray(localNames) && localNames.includes(name)) {
        const owner = readPreviewInspectorOwnData(edge, 'owner');
        const source = normalizePreviewInspectorSource(owner, 'ancestry', true);
        if (source !== undefined) return source;
      }
    }
  }
  const renderChain = readPreviewInspectorOwnData(inspector, 'renderChain');
  const paths = readPreviewInspectorOwnData(renderChain, 'paths');
  const steps = Array.isArray(paths) ? readPreviewInspectorOwnData(paths[0], 'steps') : undefined;
  if (Array.isArray(steps)) {
    for (const step of steps.slice(0, 64)) {
      const wrapperNames = readPreviewInspectorOwnData(step, 'wrapperNames');
      if (
        readPreviewInspectorOwnData(step, 'label') === name ||
        (Array.isArray(wrapperNames) && wrapperNames.includes(name))
      ) {
        const source = normalizePreviewInspectorSource(step, 'render-chain', true);
        if (source !== undefined) return source;
      }
    }
  }
  return undefined;
}

/** Resolves exact runtime evidence before bounded static and ancestor approximations. */
function readPreviewInspectorFiberSource(fiber, name, options, ancestorSource) {
  const runtimeSource = readPreviewInspectorRuntimeSource(fiber);
  if (runtimeSource !== undefined) return runtimeSource;
  const staticSource = readPreviewInspectorStaticSource(name, options);
  if (staticSource !== undefined) return staticSource;
  if (ancestorSource === undefined) return undefined;
  return { ...ancestorSource, approximate: true, origin: 'ancestry' };
}

/** Derives only the two instrumented export identities that the UI may edit or remount. */
function readPreviewInspectorEditableExportIdentities(options) {
  const descriptor = readPreviewInspectorOwnData(options, 'descriptor');
  const inspector = readPreviewInspectorOwnData(descriptor, 'inspector') ?? descriptor;
  const target = readPreviewInspectorOwnData(inspector, 'target');
  const root = readPreviewInspectorOwnData(inspector, 'root');
  const configuredTargetName = readPreviewInspectorOwnData(options, 'targetExportName');
  const targetName = typeof configuredTargetName === 'string'
    ? configuredTargetName
    : readPreviewInspectorOwnData(target, 'exportName');
  const configuredRootName = readPreviewInspectorOwnData(options, 'rootExportName');
  const rootSourcePath = readPreviewInspectorOwnData(root, 'sourcePath');
  const rootExportName = readPreviewInspectorOwnData(root, 'exportName');
  const rootName = typeof configuredRootName === 'string'
    ? configuredRootName
    : typeof rootSourcePath === 'string' && typeof rootExportName === 'string'
      ? '@root:' + rootSourcePath + ':' + rootExportName
      : undefined;
  return {
    rootName,
    selectedName: readPreviewInspectorOwnData(options, 'selectedExportName'),
    targetName: typeof targetName === 'string' ? targetName : undefined,
  };
}

/** Extracts class state or a bounded read-only sequence of function hook memoized values. */
function snapshotPreviewInspectorFiberState(fiber, kind) {
  const memoizedState = readPreviewInspectorOwnData(fiber, 'memoizedState');
  if (memoizedState === undefined || memoizedState === null) return null;
  if (kind === 'class') return snapshotPreviewInspectorValue(memoizedState);
  if (!['function', 'memo', 'forward-ref', 'lazy'].includes(kind)) return null;
  const hooks = [];
  const visitedHooks = new Set();
  let hook = memoizedState;
  while (hook !== null && typeof hook === 'object' && hooks.length < PREVIEW_INSPECTOR_HOOK_LIMIT) {
    if (visitedHooks.has(hook)) {
      hooks.push('[Circular hook list]');
      break;
    }
    visitedHooks.add(hook);
    hooks.push(snapshotPreviewInspectorValue(readPreviewInspectorOwnData(hook, 'memoizedState')));
    hook = readPreviewInspectorOwnData(hook, 'next');
  }
  if (hook !== undefined && hook !== null && hooks.length >= PREVIEW_INSPECTOR_HOOK_LIMIT) {
    hooks.push('[Hooks truncated]');
  }
  return hooks.length > 0 ? hooks : null;
}

/** Finds the descriptor-owned application slice above a target boundary but below Inspector chrome. */
function findPreviewInspectorApplicationSliceFiber(boundaryFiber) {
  let current = boundaryFiber;
  let childOnPath = boundaryFiber;
  const visited = new Set();
  for (let depth = 0; current !== undefined && depth < PREVIEW_INSPECTOR_TREE_DEPTH_LIMIT; depth += 1) {
    if (visited.has(current)) break;
    visited.add(current);
    const kind = classifyPreviewInspectorFiber(current);
    const name = namePreviewInspectorFiber(current, kind);
    if (name === 'PreviewPageInspectorExportBoundary') {
      return readPreviewInspectorFiberLink(current, 'child') ?? childOnPath;
    }
    if (name === 'PreviewPageInspectorShell') return childOnPath;
    childOnPath = current;
    current = readPreviewInspectorFiberLink(current, 'return');
  }
  return readPreviewInspectorFiberLink(boundaryFiber, 'child');
}

/** Normalizes one boundary, array, or Set without invoking arbitrary iterators. */
function normalizePreviewInspectorBoundaries(boundaries) {
  if (Array.isArray(boundaries)) return boundaries.slice(0, 64);
  if (boundaries instanceof Set) return [...boundaries].slice(0, 64);
  return boundaries === undefined || boundaries === null ? [] : [boundaries];
}

/** Returns unique connected host roots suitable for overlay outlines. */
function normalizePreviewInspectorHostRoots(values) {
  const roots = [];
  for (const value of values) {
    const element = normalizePreviewInspectorHostElement(value);
    if (element !== undefined && element?.isConnected !== false && !roots.includes(element)) {
      roots.push(element);
    }
  }
  return roots;
}

/**
 * Collects a stable UI snapshot around selected target boundaries.
 * IDs are snapshot-stable structural paths, not persistent React identities across reorders.
 */
function collectPreviewInspectorFiberTree(boundaries, selectedId, options = {}) {
  const roots = [];
  const nodeById = new Map();
  const parentIdById = new Map();
  const hostNodesById = new Map();
  const nodeIdByHost = new WeakMap();
  const nodeIdByFiber = new WeakMap();
  const visitedFibers = new Set();
  const boundaryFibers = [];
  const sliceFibers = [];
  let visitCount = 0;
  let nodeCount = 0;
  let truncated = false;

  /** Builds a promoted forest so private wrapper and fragment nodes never pollute the UI tree. */
  function buildForest(firstFiber, parentId, pathPrefix, depth, ancestorSource) {
    const nodes = [];
    const promotedHostRoots = [];
    let fiber = firstFiber;
    let siblingIndex = 0;
    while (fiber !== undefined) {
      if (
        visitCount >= PREVIEW_INSPECTOR_FIBER_VISIT_LIMIT ||
        nodeCount >= PREVIEW_INSPECTOR_TREE_NODE_LIMIT ||
        depth >= PREVIEW_INSPECTOR_TREE_DEPTH_LIMIT
      ) {
        truncated = true;
        break;
      }
      const nextSibling = readPreviewInspectorFiberLink(fiber, 'sibling');
      if (!visitedFibers.has(fiber)) {
        visitedFibers.add(fiber);
        visitCount += 1;
        const path = pathPrefix + '.' + String(siblingIndex);
        if (!isPreviewInspectorOwnedPortalFiber(fiber)) {
          const kind = classifyPreviewInspectorFiber(fiber);
          const name = namePreviewInspectorFiber(fiber, kind);
          const source = readPreviewInspectorFiberSource(fiber, name, options, ancestorSource);
          const owned = isPreviewInspectorOwnedFiber(fiber, name, kind);
          if (owned) {
            const promoted = buildForest(
              readPreviewInspectorFiberLink(fiber, 'child'),
              parentId,
              path + '.i',
              depth + 1,
              source ?? ancestorSource,
            );
            nodes.push(...promoted.nodes);
            promotedHostRoots.push(...promoted.hostRoots);
          } else {
            const id = 'fiber:' + path;
            const stateNode = readPreviewInspectorOwnData(fiber, 'stateNode');
            const directHost = normalizePreviewInspectorHostElement(stateNode);
            const node = {
              children: [],
              hostElementCount: 0,
              id,
              kind,
              name,
              props: snapshotPreviewInspectorValue(readPreviewInspectorOwnData(fiber, 'memoizedProps')),
              state: snapshotPreviewInspectorFiberState(fiber, kind),
              ...(source === undefined ? {} : { source }),
            };
            nodeCount += 1;
            nodeById.set(id, node);
            nodeIdByFiber.set(fiber, id);
            if (parentId !== undefined) parentIdById.set(id, parentId);
            const childResult = buildForest(
              readPreviewInspectorFiberLink(fiber, 'child'),
              id,
              path,
              depth + 1,
              source ?? ancestorSource,
            );
            node.children = childResult.nodes;
            const hostRoots = directHost === undefined ? childResult.hostRoots : [directHost];
            const normalizedHosts = normalizePreviewInspectorHostRoots(hostRoots);
            node.hostElementCount = normalizedHosts.length;
            hostNodesById.set(id, normalizedHosts);
            if (
              directHost !== undefined &&
              readPreviewInspectorOwnData(stateNode, 'nodeType') === 1
            ) {
              nodeIdByHost.set(directHost, id);
            }
            nodes.push(node);
            promotedHostRoots.push(...normalizedHosts);
          }
        }
      }
      fiber = nextSibling;
      siblingIndex += 1;
    }
    return { hostRoots: normalizePreviewInspectorHostRoots(promotedHostRoots), nodes };
  }

  const seenSlices = new Set();
  for (const boundary of normalizePreviewInspectorBoundaries(boundaries)) {
    const boundaryFiber = readPreviewInspectorBoundaryFiber(boundary);
    if (boundaryFiber === undefined) continue;
    boundaryFibers.push(boundaryFiber);
    const sliceFiber = findPreviewInspectorApplicationSliceFiber(boundaryFiber);
    if (sliceFiber === undefined || seenSlices.has(sliceFiber)) continue;
    seenSlices.add(sliceFiber);
    sliceFibers.push(sliceFiber);
  }
  for (let rootIndex = 0; rootIndex < sliceFibers.length; rootIndex += 1) {
    const result = buildForest(sliceFibers[rootIndex], undefined, String(rootIndex), 0, undefined);
    roots.push(...result.nodes);
  }

  /** Finds the first displayed descendant below one target boundary for initial selection. */
  function findTargetNodeId(boundaryFiber) {
    const pending = [readPreviewInspectorFiberLink(boundaryFiber, 'child')];
    const seen = new Set();
    while (pending.length > 0 && seen.size < PREVIEW_INSPECTOR_FIBER_VISIT_LIMIT) {
      const fiber = pending.shift();
      if (fiber === undefined || seen.has(fiber)) continue;
      seen.add(fiber);
      const nodeId = nodeIdByFiber.get(fiber);
      if (nodeId !== undefined) return nodeId;
      pending.push(
        readPreviewInspectorFiberLink(fiber, 'child'),
        readPreviewInspectorFiberLink(fiber, 'sibling'),
      );
    }
    return undefined;
  }

  const defaultSelectedId = boundaryFibers.map(findTargetNodeId).find((id) => id !== undefined);
  const resolvedSelectedId =
    typeof selectedId === 'string' && nodeById.has(selectedId)
      ? selectedId
      : defaultSelectedId ?? roots[0]?.id;
  const editableIdentities = readPreviewInspectorEditableExportIdentities(options);
  const rootNode = roots[0];
  const targetNode = defaultSelectedId === undefined ? undefined : nodeById.get(defaultSelectedId);
  if (rootNode !== undefined && editableIdentities.rootName !== undefined) {
    rootNode.exportName = editableIdentities.rootName;
  }
  if (targetNode !== undefined && editableIdentities.targetName !== undefined) {
    const preferredIdentity =
      targetNode === rootNode && editableIdentities.selectedName === editableIdentities.rootName
        ? editableIdentities.rootName
        : editableIdentities.targetName;
    targetNode.exportName = preferredIdentity;
  }
  const snapshot = {
    roots,
    selectedId: resolvedSelectedId,
    status: roots.length === 0 ? 'unavailable' : truncated ? 'partial' : 'available',
    truncated,
    visitedCount: visitCount,
  };
  Object.defineProperties(snapshot, {
    hostNodesById: { value: hostNodesById },
    nodeById: { value: nodeById },
    nodeIdByHost: { value: nodeIdByHost },
    parentIdById: { value: parentIdById },
  });
  return snapshot;
}

/** Resolves one tree ID into its serializable node and currently connected host roots. */
function selectPreviewInspectorFiberTreeNode(snapshot, id) {
  const node = snapshot?.nodeById?.get?.(id);
  if (node === undefined) return undefined;
  const hostNodes = normalizePreviewInspectorHostRoots(snapshot.hostNodesById?.get?.(id) ?? []);
  return { hostNodes, node };
}

/** Maps a picked DOM descendant to the nearest authored React component, with host fallback. */
function findPreviewInspectorFiberTreeNodeByHost(snapshot, hostValue, preferComponent = true) {
  let host = normalizePreviewInspectorHostElement(hostValue);
  let id;
  const visited = new Set();
  while (host !== undefined && !visited.has(host)) {
    visited.add(host);
    id = snapshot?.nodeIdByHost?.get?.(host);
    if (id !== undefined) break;
    host = normalizePreviewInspectorHostElement(host.parentElement);
  }
  if (id === undefined) return undefined;
  if (preferComponent) {
    let candidateId = id;
    const seenIds = new Set();
    while (candidateId !== undefined && !seenIds.has(candidateId)) {
      seenIds.add(candidateId);
      const candidate = snapshot?.nodeById?.get?.(candidateId);
      if (
        candidate !== undefined &&
        !['host', 'text', 'root', 'fragment', 'other'].includes(candidate.kind)
      ) {
        id = candidateId;
        break;
      }
      candidateId = snapshot?.parentIdById?.get?.(candidateId);
    }
  }
  return selectPreviewInspectorFiberTreeNode(snapshot, id);
}

/**
 * Preserves the original exact-target highlighting contract instead of outlining the entire page
 * slice now exposed by the component tree.
 */
function collectPreviewInspectorFiberElements(boundary) {
  const boundaryFiber = readPreviewInspectorBoundaryFiber(boundary);
  if (boundaryFiber === undefined) return [];
  const elements = [];
  const pendingFibers = [readPreviewInspectorFiberLink(boundaryFiber, 'child')];
  const visitedFibers = new Set();
  let visitCount = 0;
  while (pendingFibers.length > 0 && visitCount < PREVIEW_INSPECTOR_FIBER_VISIT_LIMIT) {
    const fiber = pendingFibers.pop();
    if (fiber === undefined || visitedFibers.has(fiber)) continue;
    visitedFibers.add(fiber);
    visitCount += 1;
    const sibling = readPreviewInspectorFiberLink(fiber, 'sibling');
    if (sibling !== undefined) pendingFibers.push(sibling);
    if (isPreviewInspectorOwnedPortalFiber(fiber)) continue;
    const hostElement = normalizePreviewInspectorHostElement(
      readPreviewInspectorOwnData(fiber, 'stateNode'),
    );
    if (hostElement !== undefined) {
      elements.push(hostElement);
      continue;
    }
    const child = readPreviewInspectorFiberLink(fiber, 'child');
    if (child !== undefined) pendingFibers.push(child);
  }
  return normalizePreviewInspectorHostRoots(elements);
}
`;
}
