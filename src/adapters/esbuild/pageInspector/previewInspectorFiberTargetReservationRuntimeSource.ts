/**
 * Generates the exact-target reservation used when a very wide live Fiber tree reaches its normal
 * UI node budget before visiting the selected component.
 *
 * General siblings stay bounded by the main collector. This helper admits at most one additional
 * target record per exact source/export boundary, preserving truthful mounted Fiber evidence
 * without increasing broad traversal or allowing large application shells to monopolize the UI.
 */

/** Returns browser JavaScript that reserves omitted target boundaries after ordinary collection. */
export function createPreviewInspectorFiberTargetReservationRuntimeSource(): string {
  return String.raw`
/**
 * Appends one exact source/export record outside the general sibling budget. The record is backed
 * by the mounted boundary Fiber and its Fiber-connected hosts; DOM ownership, output, and static
 * reachability are deliberately insufficient to claim a current-file mount.
 */
function reservePreviewInspectorTargetNode(entry, exportName, index, collections, options) {
  if (typeof exportName !== 'string') return undefined;
  const source = readPreviewInspectorStaticSource(exportName, options);
  const sourcePath = typeof source?.sourcePath === 'string'
    ? source.sourcePath.replaceAll('\\', '/')
    : undefined;
  const boundarySourcePath = typeof entry.sourcePath === 'string'
    ? entry.sourcePath.replaceAll('\\', '/')
    : undefined;
  if (
    sourcePath === undefined ||
    boundarySourcePath === undefined ||
    sourcePath !== boundarySourcePath ||
    source.approximate === true
  ) return undefined;
  if (typeof registerPreviewInspectorTargetOwnershipPhase === 'function') {
    registerPreviewInspectorTargetOwnershipPhase(
      { exportName, sourcePath: boundarySourcePath },
      'source-export-match',
    );
  }
  if (entry.fiber === undefined) return undefined;
  if (typeof registerPreviewInspectorTargetOwnershipPhase === 'function') {
    registerPreviewInspectorTargetOwnershipPhase(
      { exportName, sourcePath: boundarySourcePath },
      'fiber-availability',
    );
  }
  const representative = readPreviewInspectorFiberLink(entry.fiber, 'child') ?? entry.fiber;
  const collectedId = collections.nodeIdByFiber.get(representative);
  if (collectedId !== undefined && collections.nodeById.has(collectedId)) {
    const collectedNode = collections.nodeById.get(collectedId);
    /*
     * jsxDEV points source at the page invocation site. Preserve that navigation detail while
     * carrying the separately proven export-definition identity into UI reconciliation.
     */
    collectedNode.currentFileExportSourcePath = boundarySourcePath;
    return collectedId;
  }

  const id = createPreviewInspectorTreeNodeId(
    'reserved-target',
    String(index),
    'target',
    exportName,
  );
  const hosts = collectPreviewInspectorFiberElements(entry.boundary);
  const node = {
    children: [],
    currentFileExport: true,
    currentFileExportSourcePath: boundarySourcePath,
    exportName,
    hostElementCount: hosts.length,
    id,
    kind: 'target',
    mounted: true,
    name: exportName,
    props: snapshotPreviewInspectorValue(readPreviewInspectorOwnData(representative, 'memoizedProps')),
    source,
    state: snapshotPreviewInspectorFiberState(
      representative,
      classifyPreviewInspectorFiber(representative),
    ),
  };
  collections.nodeById.set(id, node);
  collections.nodeIdByFiber.set(entry.fiber, id);
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
