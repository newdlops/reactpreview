/**
 * Generates the exact-target reservation used when a very wide live Fiber tree reaches its normal
 * UI node budget before visiting the selected component.
 *
 * General siblings stay bounded by the main collector. This helper admits at most one additional
 * target record per instrumented export boundary, preserving truthful mounted/output evidence
 * without increasing broad traversal or allowing large application shells to monopolize the UI.
 */

/** Returns browser JavaScript that reserves omitted target boundaries after ordinary collection. */
export function createPreviewInspectorFiberTargetReservationRuntimeSource(): string {
  return String.raw`
/**
 * Finds a collected target descendant or appends one exact synthetic record outside the general
 * sibling budget. The synthetic record is backed by the live boundary Fiber and connected hosts;
 * it is not static path evidence and therefore remains safe to mark as mounted.
 */
function reservePreviewInspectorTargetNode(entry, exportName, index, collections, options) {
  const pending = [readPreviewInspectorFiberLink(entry.fiber, 'child')];
  const seen = new Set();
  let representative;
  while (pending.length > 0 && seen.size < PREVIEW_INSPECTOR_FIBER_VISIT_LIMIT) {
    const fiber = pending.shift();
    if (fiber === undefined || seen.has(fiber)) continue;
    seen.add(fiber);
    representative ??= fiber;
    const nodeId = collections.nodeIdByFiber.get(fiber);
    if (nodeId !== undefined && collections.nodeById.has(nodeId)) return nodeId;
    pending.push(
      readPreviewInspectorFiberLink(fiber, 'child'),
      readPreviewInspectorFiberLink(fiber, 'sibling'),
    );
  }
  if (representative === undefined || typeof exportName !== 'string') return undefined;

  const id = createPreviewInspectorTreeNodeId(
    'reserved-target',
    String(index),
    'target',
    exportName,
  );
  const hosts = collectPreviewInspectorFiberElements(entry.boundary);
  const source =
    readPreviewInspectorStaticSource(exportName, options) ??
    readPreviewInspectorFiberSource(representative, exportName, options, undefined);
  const node = {
    children: [],
    currentFileExport: true,
    exportName,
    hostElementCount: hosts.length,
    id,
    kind: 'target',
    mounted: true,
    name: exportName,
    props: snapshotPreviewInspectorValue(
      readPreviewInspectorOwnData(representative, 'memoizedProps'),
    ),
    state: snapshotPreviewInspectorFiberState(
      representative,
      classifyPreviewInspectorFiber(representative),
    ),
    ...(source === undefined ? {} : { source }),
  };
  collections.nodeById.set(id, node);
  collections.nodeIdByFiber.set(representative, id);
  collections.hostNodesById.set(id, hosts);
  for (const host of hosts) collections.nodeIdByHost.set(host, id);

  let parentFiber = readPreviewInspectorFiberLink(entry.fiber, 'return');
  const visitedParents = new Set();
  let parentId;
  while (parentFiber !== undefined && !visitedParents.has(parentFiber)) {
    visitedParents.add(parentFiber);
    const candidateId = collections.nodeIdByFiber.get(parentFiber);
    if (candidateId !== undefined && collections.nodeById.has(candidateId)) {
      parentId = candidateId;
      break;
    }
    parentFiber = readPreviewInspectorFiberLink(parentFiber, 'return');
  }
  const parent = parentId === undefined ? undefined : collections.nodeById.get(parentId);
  if (parent !== undefined) {
    parent.children.push(node);
    collections.parentIdById.set(id, parentId);
  } else {
    collections.roots.push(node);
  }
  return id;
}
`;
}
