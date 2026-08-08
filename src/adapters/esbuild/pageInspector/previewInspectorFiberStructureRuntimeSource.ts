/**
 * Generates Fiber-side structure classification for transparent wrappers and overlay portals.
 * The helpers read only bounded own-data fields through the surrounding adapter and never mutate
 * React internals, invoke project components, or retain application values after one snapshot.
 */

/**
 * Creates browser helpers consumed by the read-only Fiber collector.
 *
 * Expected lexical functions are `readPreviewInspectorOwnData`,
 * `readPreviewInspectorFiberLink`, and `classifyPreviewInspectorFiber`; function declarations in
 * the composed source are hoisted so insertion order does not couple these modules.
 *
 * @returns Plain JavaScript source classifying mounted overlays and child-preserving wrappers.
 */
export function createPreviewInspectorFiberStructureRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_STRUCTURE_DEPTH_LIMIT = 12;
const PREVIEW_INSPECTOR_CHILD_ELEMENT_LIMIT = 32;
const previewInspectorOverlayNamePattern =
  /(?:modal|dialog|drawer|popover|popper|popup|overlay|portal|sheet|lightbox|tooltip|toast|dropdown|menu)$/iu;
const previewInspectorFiberOverlayVisibilityPropNames = [
  'anchorEl',
  'hidden',
  'isOpen',
  'isShown',
  'isVisible',
  'open',
  'show',
  'visible',
];

/** Detects the isolated Inspector host or shadow root without excluding application portals. */
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

/** Prunes only the Inspector toolbar portal while retaining project modal/overlay portals. */
function isPreviewInspectorOwnedPortalFiber(fiber) {
  if (readPreviewInspectorOwnData(fiber, 'tag') !== 4) return false;
  const stateNode = readPreviewInspectorOwnData(fiber, 'stateNode');
  const containerInfo = readPreviewInspectorOwnData(stateNode, 'containerInfo') ?? stateNode;
  return isPreviewInspectorUiContainer(containerInfo);
}

/** Adds React element types found in bounded props.children arrays without invoking iterators. */
function collectPreviewInspectorChildElementTypes(value, output, depth = 0) {
  if (
    output.size >= PREVIEW_INSPECTOR_CHILD_ELEMENT_LIMIT ||
    depth >= PREVIEW_INSPECTOR_STRUCTURE_DEPTH_LIMIT ||
    value === null ||
    typeof value !== 'object'
  ) {
    return;
  }
  const elementType = readPreviewInspectorOwnData(value, 'type');
  if (elementType !== undefined && elementType !== null) output.add(elementType);
  if (!Array.isArray(value)) return;
  const length = Math.min(value.length, PREVIEW_INSPECTOR_CHILD_ELEMENT_LIMIT);
  for (let index = 0; index < length; index += 1) {
    collectPreviewInspectorChildElementTypes(
      readPreviewInspectorOwnData(value, String(index)),
      output,
      depth + 1,
    );
  }
}

/**
 * Proves that a component forwards one authored child through only hostless React boundaries.
 * Encountering a DOM host or another unmatched component stops that branch, distinguishing a
 * provider/fragment pass-through from a layout that independently constructs page markup.
 */
function preservesPreviewInspectorChildrenTransparently(fiber) {
  const props = readPreviewInspectorOwnData(fiber, 'memoizedProps');
  const authoredChildren = readPreviewInspectorOwnData(props, 'children');
  if (authoredChildren === undefined) return false;
  const elementTypes = new Set();
  collectPreviewInspectorChildElementTypes(authoredChildren, elementTypes);
  if (elementTypes.size === 0) return false;
  const pending = [readPreviewInspectorFiberLink(fiber, 'child')];
  const visited = new Set();
  while (pending.length > 0 && visited.size < PREVIEW_INSPECTOR_CHILD_ELEMENT_LIMIT * 2) {
    const current = pending.shift();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    const type =
      readPreviewInspectorOwnData(current, 'elementType') ??
      readPreviewInspectorOwnData(current, 'type');
    if (elementTypes.has(type)) return true;
    const kind = classifyPreviewInspectorFiber(current);
    if (['context', 'fragment', 'memo', 'suspense', 'other'].includes(kind)) {
      pending.push(
        readPreviewInspectorFiberLink(current, 'child'),
        readPreviewInspectorFiberLink(current, 'sibling'),
      );
    }
  }
  return false;
}

/** Reports an own visibility control without executing a project getter or proxy-like accessor. */
function hasPreviewInspectorOverlayVisibilityProp(fiber) {
  const props = readPreviewInspectorOwnData(fiber, 'memoizedProps');
  if (props === null || (typeof props !== 'object' && typeof props !== 'function')) return false;
  return previewInspectorFiberOverlayVisibilityPropNames.some((propertyName) => {
    const descriptor = Object.getOwnPropertyDescriptor(props, propertyName);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return false;
    if (propertyName === 'anchorEl') return true;
    return typeof descriptor.value === 'boolean';
  });
}

/** Reads semantic dialog evidence from one host Fiber without consulting computed layout styles. */
function hasPreviewInspectorOverlayHostSemantics(fiber) {
  const hostType = readPreviewInspectorOwnData(fiber, 'type');
  const stateNode = readPreviewInspectorOwnData(fiber, 'stateNode');
  const localName =
    typeof hostType === 'string'
      ? hostType.toLocaleLowerCase()
      : typeof readPreviewInspectorOwnData(stateNode, 'localName') === 'string'
        ? readPreviewInspectorOwnData(stateNode, 'localName').toLocaleLowerCase()
        : '';
  if (localName === 'dialog') return true;
  try {
    const role = stateNode?.getAttribute?.('role');
    if (role === 'dialog' || role === 'alertdialog') return true;
    return stateNode?.getAttribute?.('aria-modal') === 'true';
  } catch {
    return false;
  }
}

/**
 * Confirms a name-based candidate with a bounded live portal or semantic dialog descendant.
 *
 * Component names are weak evidence: Menu, Sheet, or Overlay can be ordinary inline layout
 * components. Runtime evidence turns the static hint into a role without forcing a style/layout
 * read, while a dormant controlled overlay is still recognized from its own visibility prop.
 */
function hasPreviewInspectorOverlayRuntimeEvidence(fiber) {
  if (hasPreviewInspectorOverlayVisibilityProp(fiber)) return true;
  const pending = [readPreviewInspectorFiberLink(fiber, 'child')];
  const visited = new Set();
  while (pending.length > 0 && visited.size < PREVIEW_INSPECTOR_CHILD_ELEMENT_LIMIT * 2) {
    const current = pending.shift();
    if (current === undefined || visited.has(current)) continue;
    visited.add(current);
    const kind = classifyPreviewInspectorFiber(current);
    if (kind === 'portal' && !isPreviewInspectorOwnedPortalFiber(current)) return true;
    if (kind === 'host' && hasPreviewInspectorOverlayHostSemantics(current)) return true;
    pending.push(
      readPreviewInspectorFiberLink(current, 'child'),
      readPreviewInspectorFiberLink(current, 'sibling'),
    );
  }
  return false;
}

/** Assigns a stable visual role from strong runtime evidence without changing authored ownership. */
function readPreviewInspectorFiberStructureRole(fiber, kind, name) {
  if (kind === 'portal') return 'overlay';
  if (
    previewInspectorOverlayNamePattern.test(String(name ?? '')) &&
    hasPreviewInspectorOverlayRuntimeEvidence(fiber)
  ) {
    return 'overlay';
  }
  if (preservesPreviewInspectorChildrenTransparently(fiber)) return 'transparent-wrapper';
  return undefined;
}

/** Distinguishes a mounted overlay branch from a dormant component that currently returns null. */
function readPreviewInspectorOverlayState(fiber, role) {
  if (role !== 'overlay') return undefined;
  return readPreviewInspectorFiberLink(fiber, 'child') === undefined ? 'dormant' : 'mounted';
}
`;
}
