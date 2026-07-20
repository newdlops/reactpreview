/**
 * Generates the page-layout wireframe shown above the rendered preview document.
 *
 * The Fiber collector already records the host DOM roots owned by each React component. This
 * module turns those transient roots into viewport rectangles without retaining Fibers in React
 * state. Components that failed before producing a host node receive a bounded synthetic slot
 * inside their nearest rendered ancestor, so a missing subtree still has a visible location.
 */

/** Maximum component outlines admitted into one viewport overlay refresh. */
export const PREVIEW_INSPECTOR_WIREFRAME_ITEM_LIMIT = 160;

/** Maximum tree records visited while locating outlines, context, and blockers. */
export const PREVIEW_INSPECTOR_WIREFRAME_VISIT_LIMIT = 768;

/**
 * Creates browser source for the non-destructive page wireframe and interactive blocker markers.
 *
 * Expected lexical bindings include `React`, `isPreviewInspectorBlockerNode`, and the descriptor
 * readers supplied by the surrounding Page Inspector runtime. All ordinary outlines ignore pointer
 * events; only explicit blocker buttons intercept a click from the previewed application.
 *
 * @returns Plain JavaScript source concatenated into the DevTools-style Inspector runtime.
 */
export function createPreviewInspectorWireframeUiRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_WIREFRAME_ITEM_LIMIT = ${PREVIEW_INSPECTOR_WIREFRAME_ITEM_LIMIT};
const PREVIEW_INSPECTOR_WIREFRAME_VISIT_LIMIT = ${PREVIEW_INSPECTOR_WIREFRAME_VISIT_LIMIT};
let previewInspectorTreeRevealRequest;

/** Marks an explicit navigation action for one unfiltered, expanded Components-tree reveal. */
function requestPreviewInspectorTreeReveal(nodeId) {
  previewInspectorTreeRevealRequest =
    typeof nodeId === 'string' && nodeId.length > 0 ? nodeId : true;
  previewInspectorDevtoolsSessionState.treeRevealRevision =
    (previewInspectorDevtoolsSessionState.treeRevealRevision ?? 0) + 1;
}

/** Consumes a matching one-shot reveal while ordinary row selection leaves scroll untouched. */
function consumePreviewInspectorTreeReveal(nodeId) {
  if (previewInspectorTreeRevealRequest !== true && previewInspectorTreeRevealRequest !== nodeId) {
    return false;
  }
  previewInspectorTreeRevealRequest = undefined;
  return true;
}

/** Routes one marker to its tree row, Blocker detail, and focused companion Inspector tab. */
function revealPreviewInspectorWireframeBlocker(node, setCollapsed) {
  if (node === null || typeof node !== 'object' || typeof node.id !== 'string') return;
  previewInspectorDevtoolsSessionState.collapsed = false;
  previewInspectorDevtoolsSessionState.activeTab = 'blocker';
  previewInspectorDevtoolsSessionState.blockerDetailRevision =
    (previewInspectorDevtoolsSessionState.blockerDetailRevision ?? 0) + 1;
  requestPreviewInspectorTreeReveal(node.id);
  setCollapsed(false);
  selectPreviewInspectorUiNode(node);
  previewInspectorPostHostMessage?.({ type: 'react-preview-inspector-companion-reveal' });
}

/**
 * Preserves the collector's deliberately non-enumerable DOM indexes across serializable UI copies.
 * Keeping these properties hidden prevents persistence/JSON code from ever traversing live nodes.
 */
function copyPreviewInspectorSnapshotRuntimeIndexes(source, target) {
  if (source === null || typeof source !== 'object' || target === null || typeof target !== 'object') {
    return target;
  }
  for (const key of ['hostNodesById', 'nodeById', 'nodeIdByHost', 'parentIdById']) {
    const value = source[key];
    if (value === undefined) continue;
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: false,
      value,
    });
  }
  return target;
}

/** Returns a finite viewport shape without assuming a fully initialized browser environment. */
function readPreviewInspectorWireframeViewport() {
  return {
    height: Number.isFinite(globalThis.innerHeight) ? Math.max(1, globalThis.innerHeight) : 800,
    width: Number.isFinite(globalThis.innerWidth) ? Math.max(1, globalThis.innerWidth) : 1280,
  };
}

/** Clips one DOM rectangle to the visible page viewport and discards non-rendered geometry. */
function normalizePreviewInspectorWireframeRect(value, viewport) {
  const leftValue = Number(value?.left);
  const topValue = Number(value?.top);
  const rightValue = Number(value?.right);
  const bottomValue = Number(value?.bottom);
  if (![leftValue, topValue, rightValue, bottomValue].every(Number.isFinite)) return undefined;
  const left = Math.max(0, Math.min(viewport.width, leftValue));
  const top = Math.max(0, Math.min(viewport.height, topValue));
  const right = Math.max(0, Math.min(viewport.width, rightValue));
  const bottom = Math.max(0, Math.min(viewport.height, bottomValue));
  if (right - left < 1 || bottom - top < 1) return undefined;
  return { bottom, height: bottom - top, left, right, top, width: right - left };
}

/** Unions the connected host roots owned by one component into a single visual placement box. */
function readPreviewInspectorWireframeHostRect(snapshot, nodeId, viewport, rectByHost) {
  const values = snapshot?.hostNodesById?.get?.(nodeId);
  if (!Array.isArray(values) || values.length === 0) return undefined;
  let union;
  for (const host of values) {
    if (host?.isConnected === false || typeof host?.getBoundingClientRect !== 'function') continue;
    const inspectorOwner = host?.closest?.('[data-react-preview-inspector-ui]');
    if (inspectorOwner !== null && inspectorOwner !== undefined) continue;
    let rect = rectByHost.get(host);
    if (rect === undefined) {
      try {
        rect = normalizePreviewInspectorWireframeRect(host.getBoundingClientRect(), viewport) ?? null;
      } catch {
        rect = null;
      }
      rectByHost.set(host, rect);
    }
    if (rect === null || rect === undefined) continue;
    union = union === undefined
      ? { ...rect }
      : {
          bottom: Math.max(union.bottom, rect.bottom),
          left: Math.min(union.left, rect.left),
          right: Math.max(union.right, rect.right),
          top: Math.min(union.top, rect.top),
        };
  }
  if (union === undefined) return undefined;
  return {
    ...union,
    height: union.bottom - union.top,
    width: union.right - union.left,
  };
}

/** Distinguishes authored or React wrapper nodes from host/text and synthetic control records. */
function isPreviewInspectorWireframeComponentNode(node) {
  if (node === null || typeof node !== 'object' || node.contextOnly === true) return false;
  if (isPreviewInspectorBlockerNode(node) || node.kind === 'condition') return false;
  if (node.role === 'transparent-wrapper') return false;
  if (['host', 'text', 'condition-group', 'context', 'other', 'suspense'].includes(node.kind)) {
    return false;
  }
  const name = typeof node.name === 'string' ? node.name : '';
  if (
    name.length === 0 ||
    ['Anonymous', 'ForwardRef', 'Fragment', 'Suspense', 'function'].includes(name) ||
    name.startsWith('Styled(') ||
    name.startsWith('styled.')
  ) {
    return false;
  }
  return true;
}

/** Shows only unresolved render stops; dormant authored branches remain ordinary Inspector controls. */
function isPreviewInspectorWireframeBlockingNode(node) {
  return isPreviewInspectorBlockerNode(node) && isPreviewInspectorBlockingNode(node);
}

/** Reports whether a synthetic failed owner still contains a blocker that actively stops output. */
function hasPreviewInspectorWireframeBlockingDescendant(node) {
  const pending = [...(node?.children ?? [])];
  let visited = 0;
  while (pending.length > 0 && visited < PREVIEW_INSPECTOR_WIREFRAME_VISIT_LIMIT) {
    const child = pending.shift();
    visited += 1;
    if (isPreviewInspectorWireframeBlockingNode(child)) return true;
    pending.push(...(child?.children ?? []));
  }
  return false;
}

/** Creates a bounded placeholder for a failed component that has no measurable host output. */
function createPreviewInspectorWireframePlaceholderRect(anchor, index, depth, viewport) {
  if (anchor !== undefined) {
    const inset = Math.min(18, Math.max(6, anchor.width * 0.04));
    const width = Math.max(24, anchor.width - inset * 2);
    const height = Math.max(34, Math.min(72, Math.max(34, anchor.height * 0.24)));
    const availableTop = anchor.top + 24 + (index % 5) * 42;
    const top = Math.max(anchor.top + 2, Math.min(anchor.bottom - height - 2, availableTop));
    return {
      bottom: top + height,
      height,
      left: anchor.left + inset,
      right: anchor.left + inset + width,
      top,
      width,
    };
  }
  const left = Math.min(viewport.width - 32, 16 + Math.min(depth, 12) * 10);
  const width = Math.max(24, viewport.width - left - 16);
  const height = 52;
  const top = Math.min(
    Math.max(34, viewport.height - height - 8),
    46 + (index % Math.max(1, Math.floor((viewport.height - 60) / 62))) * 62,
  );
  return { bottom: top + height, height, left, right: left + width, top, width };
}

/** Assigns a stable label row when several transparent components share the same DOM rectangle. */
function assignPreviewInspectorWireframeLabelOffsets(boxes) {
  const counts = new Map();
  return boxes.map((box) => {
    const signature = [
      Math.round(box.rect.left),
      Math.round(box.rect.top),
      Math.round(box.rect.width),
      Math.round(box.rect.height),
    ].join(':');
    const offset = counts.get(signature) ?? 0;
    counts.set(signature, offset + 1);
    return { ...box, labelOffset: Math.min(offset, 4) * 16 };
  });
}

/**
 * Collapses transparent React ownership layers that resolve to the same visual rectangle.
 * The selected current-file export wins, followed by source-backed authored components, so dozens
 * of styled/HOC layers cannot darken one page region or stack unreadable labels over its content.
 */
function coalescePreviewInspectorWireframeBoxes(boxes) {
  const selectedByRect = new Map();
  const score = (box) =>
    (box.node?.currentFileExport === true ? 10_000 : 0) +
    (box.node?.source?.approximate === false ? 1_000 : 0) +
    (box.node?.kind === 'function' || box.node?.kind === 'class' ? 200 : 0) +
    (/(?:Page|Layout|Section|Panel|Modal)$/u.test(box.node?.name ?? '') ? 100 : 0) +
    Math.min(99, box.depth);
  for (const box of boxes) {
    const signature = [
      Math.round(box.rect.left),
      Math.round(box.rect.top),
      Math.round(box.rect.width),
      Math.round(box.rect.height),
    ].join(':');
    const previous = selectedByRect.get(signature);
    if (previous === undefined || score(box) > score(previous)) selectedByRect.set(signature, box);
  }
  return [...selectedByRect.values()];
}

/**
 * Builds a viewport-only layout model. Tree traversal supplies ownership for blockers even when
 * their failed component never committed a Fiber host node.
 */
function collectPreviewInspectorWireframeLayout(snapshot, viewport = readPreviewInspectorWireframeViewport()) {
  const boxes = [];
  const blockers = [];
  const context = [];
  const rectByHost = new WeakMap();
  let visitCount = 0;
  let placeholderCount = 0;
  const markerCountByAnchor = new Map();

  const visit = (nodes, depth, nearestAnchor, nearestOwner) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (visitCount >= PREVIEW_INSPECTOR_WIREFRAME_VISIT_LIMIT) return;
      visitCount += 1;
      if (node?.contextOnly === true && context.length < 6 && node.edgeKind !== 'current-file-export') {
        context.push({ depth, id: node.id, name: node.name });
      }
      if (isPreviewInspectorWireframeBlockingNode(node)) {
        const anchor = nearestAnchor ?? createPreviewInspectorWireframePlaceholderRect(
          undefined,
          placeholderCount++,
          depth,
          viewport,
        );
        const anchorKey = nearestOwner?.id ?? 'page';
        const markerIndex = markerCountByAnchor.get(anchorKey) ?? 0;
        markerCountByAnchor.set(anchorKey, markerIndex + 1);
        blockers.push({ anchor, depth, markerIndex, node, owner: nearestOwner });
        continue;
      }

      const measured = readPreviewInspectorWireframeHostRect(
        snapshot,
        node?.id,
        viewport,
        rectByHost,
      );
      let anchor = measured ?? nearestAnchor;
      let owner = measured === undefined ? nearestOwner : node;
      if (isPreviewInspectorWireframeComponentNode(node) && measured !== undefined) {
        if (boxes.length < PREVIEW_INSPECTOR_WIREFRAME_ITEM_LIMIT) {
          boxes.push({ depth, node, placeholder: false, rect: measured });
        }
      } else if (
        (node?.blockedOwner === true && hasPreviewInspectorWireframeBlockingDescendant(node)) ||
        (node?.mounted === false && node?.currentFileExport === true)
      ) {
        const placeholder = createPreviewInspectorWireframePlaceholderRect(
          nearestAnchor,
          placeholderCount++,
          depth,
          viewport,
        );
        boxes.push({ depth, node, placeholder: true, rect: placeholder });
        anchor = placeholder;
        owner = node;
      }
      visit(node?.children, depth + 1, anchor, owner);
    }
  };
  visit(snapshot?.roots, 0, undefined, undefined);
  return {
    blockers: blockers.slice(0, PREVIEW_INSPECTOR_WIREFRAME_ITEM_LIMIT),
    boxes: assignPreviewInspectorWireframeLabelOffsets(
      coalescePreviewInspectorWireframeBoxes(boxes).slice(0, 48),
    ),
    context,
    truncated: visitCount >= PREVIEW_INSPECTOR_WIREFRAME_VISIT_LIMIT,
    viewport,
  };
}

/** Reads the best authored page label without executing an entry module or route loader. */
function readPreviewInspectorWireframePageName(snapshot) {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const candidateName = candidate?.root?.exportName;
  if (typeof candidateName === 'string' && candidateName.length > 0) return candidateName;
  const pending = [...(snapshot?.roots ?? [])];
  while (pending.length > 0) {
    const node = pending.shift();
    if (node?.contextOnly !== true && typeof node?.name === 'string') return node.name;
    pending.push(...(node?.children ?? []));
  }
  return 'Page';
}

/** Coalesces scroll/resize geometry refreshes into one animation-frame DOM read. */
function usePreviewInspectorWireframeGeometryRefresh(enabled) {
  const [, setRevision] = React.useState(0);
  React.useEffect(() => {
    if (!enabled) return undefined;
    let frame;
    const schedule = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        setRevision((revision) => revision + 1);
      });
    };
    globalThis.addEventListener?.('resize', schedule);
    document?.addEventListener?.('scroll', schedule, true);
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(schedule)
      : undefined;
    if (document?.documentElement !== undefined) resizeObserver?.observe(document.documentElement);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      globalThis.removeEventListener?.('resize', schedule);
      document?.removeEventListener?.('scroll', schedule, true);
      resizeObserver?.disconnect();
    };
  }, [enabled]);
}

/** Converts a rectangle into the exact fixed-position style shared by boxes and markers. */
function createPreviewInspectorWireframeRectStyle(rect) {
  return {
    height: rect.height,
    left: rect.left,
    top: rect.top,
    width: rect.width,
  };
}

/** Renders the full viewport frame, component placement boxes, and clickable blocker markers. */
function PreviewInspectorWireframeLayer({ enabled, onSelectBlocker, snapshot }) {
  usePreviewInspectorWireframeGeometryRefresh(enabled);
  if (!enabled) return null;
  const layout = collectPreviewInspectorWireframeLayout(snapshot);
  const pageName = readPreviewInspectorWireframePageName(snapshot);
  return React.createElement(
    'section',
    {
      'aria-label': 'React page layout wireframe',
      className: 'rpi-wireframe-layer',
      'data-truncated': layout.truncated ? 'true' : undefined,
    },
    React.createElement(
      'div',
      { className: 'rpi-wireframe-page-frame' },
      React.createElement('span', { className: 'rpi-wireframe-page-label' }, 'Page · ' + pageName),
    ),
    layout.boxes.map((item) => React.createElement(
      'div',
      {
        'aria-hidden': true,
        className: 'rpi-wireframe-box',
        'data-current-file-export': item.node.currentFileExport === true ? 'true' : undefined,
        'data-placeholder': item.placeholder ? 'true' : undefined,
        key: item.node.id,
        style: createPreviewInspectorWireframeRectStyle(item.rect),
      },
      React.createElement(
        'span',
        {
          className: 'rpi-wireframe-box-label',
          style: { top: item.labelOffset },
        },
        item.placeholder ? 'Unrendered · ' + item.node.name : item.node.name,
      ),
    )),
    layout.blockers.map((item) => {
      const markerTop = Math.min(
        layout.viewport.height - 30,
        item.anchor.top + 20 + (item.markerIndex % 5) * 27,
      );
      const markerLeft = Math.min(
        layout.viewport.width - 30,
        Math.max(4, item.anchor.left + 7),
      );
      return React.createElement(
        'button',
        {
          'aria-label': 'Open render blocker details: ' + item.node.name,
          className: 'rpi-wireframe-blocker',
          'data-react-preview-wireframe-blocker': item.node.id,
          key: item.node.id,
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            onSelectBlocker(item.node);
          },
          style: {
            left: markerLeft,
            top: markerTop,
          },
          title: item.node.name + ' · open blocker details in React Page Inspector',
          type: 'button',
        },
        '!',
      );
    }),
  );
}
`;
}
