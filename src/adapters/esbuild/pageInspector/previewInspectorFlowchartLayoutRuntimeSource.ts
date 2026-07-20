/**
 * Generates the pure bounded layout model for React Page Inspector's render-flow debugger.
 *
 * The layout accepts explicit graph nodes and edges from the render-flow product model, assigns a
 * stable lane to every retained node, and expands long edges across adjacent rank connectors. It
 * deliberately emits semantic cells rather than browser coordinates so the separate companion tab
 * can sanitize and clone the graph without losing its orthogonal connectors.
 */

/** Maximum graph nodes retained by one debugger flowchart. */
export const PREVIEW_INSPECTOR_FLOWCHART_NODE_LIMIT = 128;

/** Maximum explicit graph edges retained before visual routing begins. */
export const PREVIEW_INSPECTOR_FLOWCHART_EDGE_LIMIT = 256;

/** Maximum parallel lanes shown before lower-priority graph nodes are summarized as omitted. */
export const PREVIEW_INSPECTOR_FLOWCHART_LANE_LIMIT = 32;

/** Maximum independently routed edges shown between two adjacent ranks. */
export const PREVIEW_INSPECTOR_FLOWCHART_TRACK_LIMIT = 8;

/**
 * Creates browser-side helpers that normalize, rank, lane, and route a debugger flowchart.
 *
 * Expected input nodes retain their existing render-step fields and may add `graphKind`, `rank`,
 * `branchState`, and `branchLabel`. Explicit edges are authoritative; legacy predecessor arrays are
 * converted only when a graph product has not yet supplied edges.
 *
 * @returns Plain JavaScript source concatenated before the flowchart React components.
 */
export function createPreviewInspectorFlowchartLayoutRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_FLOWCHART_NODE_LIMIT = ${PREVIEW_INSPECTOR_FLOWCHART_NODE_LIMIT};
const PREVIEW_INSPECTOR_FLOWCHART_EDGE_LIMIT = ${PREVIEW_INSPECTOR_FLOWCHART_EDGE_LIMIT};
const PREVIEW_INSPECTOR_FLOWCHART_LANE_LIMIT = ${PREVIEW_INSPECTOR_FLOWCHART_LANE_LIMIT};
const PREVIEW_INSPECTOR_FLOWCHART_TRACK_LIMIT = ${PREVIEW_INSPECTOR_FLOWCHART_TRACK_LIMIT};
const previewInspectorFlowchartGraphKinds = new Set([
  'entry', 'decision', 'branch', 'join', 'return', 'component', 'hoc',
  'component-slot', 'blocker',
]);

/** Infers a conservative shape while older render-flow snapshots gain explicit graph metadata. */
function normalizePreviewInspectorFlowchartGraphKind(step) {
  if (previewInspectorFlowchartGraphKinds.has(step?.graphKind)) return step.graphKind;
  if (step?.kind === 'condition') return 'decision';
  if (step?.kind === 'return') return 'return';
  if (step?.kind === 'blocker' || isPreviewInspectorBlockerNode(step?.node)) return 'blocker';
  if (String(step?.id ?? '').startsWith('render-entry:')) {
    return (step?.ownerIds?.length ?? 0) <= 1 ? 'entry' : 'component';
  }
  return 'component';
}

/** Reads a bounded non-negative authored rank, falling back to the previous stage level. */
function readPreviewInspectorFlowchartRawRank(step) {
  if (Number.isSafeInteger(step?.rank) && step.rank >= 0) return step.rank;
  if (Number.isSafeInteger(step?.level) && step.level >= 0) return step.level;
  return 0;
}

/** Returns explicit graph edges or derives a compatibility graph from predecessor identities. */
function readPreviewInspectorFlowchartInputEdges(flow, nodes) {
  if (Array.isArray(flow?.graphEdges) && flow.graphEdges.length > 0) {
    return flow.graphEdges;
  }
  return nodes.flatMap((step) => (step?.predecessorIds ?? []).map((predecessorId, index) => ({
    active: true,
    certainty: 'confirmed',
    fromId: predecessorId,
    id: 'legacy-flow-edge:' + predecessorId + ':' + step.id + ':' + String(index),
    kind: 'next',
    label: '',
    toId: step.id,
  })));
}

/** Ranks active-path and current-file nodes ahead of dormant overflow without changing source order. */
function scorePreviewInspectorFlowchartRetention(step) {
  if (step?.currentFileTarget === true) return 0;
  if (step?.directCurrentFileBlocker === true) return 1;
  if (step?.status === 'active') return 2;
  if (step?.currentFileContext === true) return 3;
  if (step?.branchState === 'active') return 4;
  if (step?.branchState === 'inactive') return 6;
  return 5;
}

/** Finds the closest unoccupied lane to a predecessor-guided preference. */
function selectPreviewInspectorFlowchartLane(occupied, preferred) {
  const boundedPreferred = Number.isSafeInteger(preferred)
    ? Math.max(0, Math.min(PREVIEW_INSPECTOR_FLOWCHART_LANE_LIMIT - 1, preferred))
    : 0;
  for (let distance = 0; distance < PREVIEW_INSPECTOR_FLOWCHART_LANE_LIMIT; distance += 1) {
    for (const lane of [boundedPreferred - distance, boundedPreferred + distance]) {
      if (lane >= 0 && lane < PREVIEW_INSPECTOR_FLOWCHART_LANE_LIMIT && !occupied.has(lane)) {
        return lane;
      }
    }
  }
  return undefined;
}

/** Chooses a predecessor lane, preferring the currently executed branch over dormant alternatives. */
function readPreviewInspectorFlowchartPreferredLane(node, incomingEdges, nodeById) {
  const incoming = (incomingEdges.get(node.id) ?? [])
    .map((edge) => ({ edge, predecessor: nodeById.get(edge.fromId) }))
    .filter((item) => Number.isSafeInteger(item.predecessor?.lane))
    .sort((left, right) => Number(right.edge.active === true) - Number(left.edge.active === true));
  if (incoming.length === 0) return undefined;
  const active = incoming.filter((item) => item.edge.active === true);
  const candidates = active.length > 0 ? active : incoming;
  const lanes = candidates.map((item) => item.predecessor.lane).sort((left, right) => left - right);
  return lanes[Math.floor((lanes.length - 1) / 2)];
}

/** Labels one connector cell's orthogonal line segment without relying on inline geometry. */
function classifyPreviewInspectorFlowchartEdgeCell(sourceLane, targetLane, lane) {
  if (sourceLane === targetLane) return lane === sourceLane ? 'straight' : 'empty';
  const minimum = Math.min(sourceLane, targetLane);
  const maximum = Math.max(sourceLane, targetLane);
  if (lane < minimum || lane > maximum) return 'empty';
  if (lane !== sourceLane && lane !== targetLane) return 'vertical';
  if (targetLane > sourceLane) return lane === sourceLane ? 'start-down' : 'end-down';
  return lane === sourceLane ? 'start-up' : 'end-up';
}

/** Expands one edge hop into repeated lane cells consumed directly by the CSS connector renderer. */
function createPreviewInspectorFlowchartEdgeCells(sourceLane, targetLane, laneCount) {
  return Array.from({ length: laneCount }, (_, lane) => ({
    lane,
    path: classifyPreviewInspectorFlowchartEdgeCell(sourceLane, targetLane, lane),
  }));
}

/** Keeps valid forward DAG edges and assigns their layout endpoints after node lanes are known. */
function normalizePreviewInspectorFlowchartEdges(rawEdges, nodeById) {
  const edges = [];
  const seen = new Set();
  for (const [index, rawEdge] of rawEdges.entries()) {
    if (edges.length >= PREVIEW_INSPECTOR_FLOWCHART_EDGE_LIMIT) break;
    const fromId = typeof rawEdge?.fromId === 'string' ? rawEdge.fromId : '';
    const toId = typeof rawEdge?.toId === 'string' ? rawEdge.toId : '';
    const from = nodeById.get(fromId);
    const to = nodeById.get(toId);
    if (from === undefined || to === undefined || from.rank >= to.rank) continue;
    const id = typeof rawEdge.id === 'string' && rawEdge.id.length > 0
      ? rawEdge.id
      : 'flow-edge:' + fromId + ':' + toId + ':' + String(index);
    if (seen.has(id)) continue;
    seen.add(id);
    edges.push({
      active: rawEdge.active !== false,
      certainty: rawEdge.certainty === 'conditional' ? 'conditional' : 'confirmed',
      fromId,
      id,
      kind: typeof rawEdge.kind === 'string' ? rawEdge.kind : 'next',
      label: typeof rawEdge.label === 'string' ? rawEdge.label.slice(0, 120) : '',
      sourceIndex: index,
      toId,
    });
  }
  return edges;
}

/** Builds one adjacent-rank connector while bounding parallel visual tracks. */
function createPreviewInspectorFlowchartTransition(rank, edges, nodeById, laneCount) {
  const crossing = edges.filter((edge) => {
    const from = nodeById.get(edge.fromId);
    const to = nodeById.get(edge.toId);
    return from.rank <= rank && to.rank > rank;
  }).sort((left, right) =>
    Number(right.active === true) - Number(left.active === true) ||
    left.sourceIndex - right.sourceIndex || left.id.localeCompare(right.id));
  const retained = crossing.slice(0, PREVIEW_INSPECTOR_FLOWCHART_TRACK_LIMIT);
  const segments = retained.map((edge, track) => {
    const from = nodeById.get(edge.fromId);
    const to = nodeById.get(edge.toId);
    const terminal = rank === to.rank - 1;
    const sourceLane = from.lane;
    const targetLane = terminal ? to.lane : from.lane;
    return {
      ...edge,
      cells: createPreviewInspectorFlowchartEdgeCells(sourceLane, targetLane, laneCount),
      label: rank === from.rank ? edge.label : '',
      sourceLane,
      targetLane,
      terminal,
      track,
    };
  });
  return {
    omittedCount: crossing.length - retained.length,
    rank,
    segments,
  };
}

/**
 * Produces the complete rank/lane/connector view model without reading DOM layout or project values.
 * Duplicate IDs, backward edges, hostile ranks, and oversized parallel stages fail closed.
 */
function createPreviewInspectorFlowchartLayout(flow) {
  const sourceNodes = Array.isArray(flow?.graphNodes) && flow.graphNodes.length > 0
    ? flow.graphNodes
    : Array.isArray(flow?.steps) ? flow.steps : [];
  const uniqueCandidates = [];
  const seenIds = new Set();
  for (const [sourceIndex, step] of sourceNodes.entries()) {
    if (typeof step?.id !== 'string' || step.id.length === 0 || seenIds.has(step.id)) continue;
    seenIds.add(step.id);
    uniqueCandidates.push({
      ...step,
      branchLabel: typeof step.branchLabel === 'string' ? step.branchLabel.slice(0, 120) : '',
      branchState: step.branchState === 'inactive' ? 'inactive' : 'active',
      graphKind: normalizePreviewInspectorFlowchartGraphKind(step),
      rawRank: readPreviewInspectorFlowchartRawRank(step),
      sourceIndex,
    });
  }
  // Select globally before restoring source order. A target or active blocker near the end of a
  // large graph must not disappear merely because explanatory nodes filled the prefix first.
  const retainedCandidateIds = new Set(
    [...uniqueCandidates]
      .sort((left, right) =>
        scorePreviewInspectorFlowchartRetention(left) -
          scorePreviewInspectorFlowchartRetention(right) ||
        left.sourceIndex - right.sourceIndex)
      .slice(0, PREVIEW_INSPECTOR_FLOWCHART_NODE_LIMIT)
      .map((node) => node.id),
  );
  const uniqueNodes = uniqueCandidates.filter((node) => retainedCandidateIds.has(node.id));
  const rawRanks = [...new Set(uniqueNodes.map((node) => node.rawRank))].sort((a, b) => a - b);
  const rankByRawRank = new Map(rawRanks.map((rawRank, rank) => [rawRank, rank]));
  const candidatesByRank = new Map();
  for (const node of uniqueNodes) {
    const rank = rankByRawRank.get(node.rawRank) ?? 0;
    const candidates = candidatesByRank.get(rank) ?? [];
    candidates.push({ ...node, rank });
    candidatesByRank.set(rank, candidates);
  }
  const retainedNodes = [];
  let omittedNodeCount = sourceNodes.length - uniqueNodes.length;
  for (const candidates of candidatesByRank.values()) {
    const retained = [...candidates].sort((left, right) =>
      scorePreviewInspectorFlowchartRetention(left) -
        scorePreviewInspectorFlowchartRetention(right) ||
      left.sourceIndex - right.sourceIndex).slice(0, PREVIEW_INSPECTOR_FLOWCHART_LANE_LIMIT);
    retainedNodes.push(...retained);
    omittedNodeCount += candidates.length - retained.length;
  }
  const retainedIds = new Set(retainedNodes.map((node) => node.id));
  const rawEdges = readPreviewInspectorFlowchartInputEdges(flow, retainedNodes).filter(
    (edge) => retainedIds.has(edge?.fromId) && retainedIds.has(edge?.toId),
  );
  const preliminaryEdges = rawEdges.map((edge, sourceIndex) => ({ ...edge, sourceIndex }));
  const incomingEdges = new Map();
  for (const edge of preliminaryEdges) {
    const incoming = incomingEdges.get(edge.toId) ?? [];
    incoming.push(edge);
    incomingEdges.set(edge.toId, incoming);
  }
  const nodeById = new Map();
  const orderedNodes = [];
  for (let rank = 0; rank < rawRanks.length; rank += 1) {
    const nodes = retainedNodes.filter((node) => node.rank === rank).sort((left, right) =>
      scorePreviewInspectorFlowchartRetention(left) -
        scorePreviewInspectorFlowchartRetention(right) ||
      left.sourceIndex - right.sourceIndex);
    const occupied = new Set();
    for (const node of nodes) {
      const preferred = readPreviewInspectorFlowchartPreferredLane(node, incomingEdges, nodeById);
      const lane = selectPreviewInspectorFlowchartLane(occupied, preferred);
      if (lane === undefined) {
        omittedNodeCount += 1;
        continue;
      }
      occupied.add(lane);
      const laidOut = { ...node, lane };
      nodeById.set(laidOut.id, laidOut);
      orderedNodes.push(laidOut);
    }
  }
  const edges = normalizePreviewInspectorFlowchartEdges(rawEdges, nodeById);
  const laneCount = Math.max(1, ...orderedNodes.map((node) => node.lane + 1));
  const rankCount = Math.max(0, ...orderedNodes.map((node) => node.rank + 1));
  const ranks = Array.from({ length: rankCount }, (_, rank) => ({
    nodesByLane: Array.from({ length: laneCount }, (_, lane) =>
      orderedNodes.find((node) => node.rank === rank && node.lane === lane)),
    rank,
  }));
  const transitions = Array.from({ length: Math.max(0, rankCount - 1) }, (_, rank) =>
    createPreviewInspectorFlowchartTransition(rank, edges, nodeById, laneCount));
  const predecessorIdsByNode = new Map(orderedNodes.map((node) => [node.id, []]));
  const successorIdsByNode = new Map(orderedNodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    predecessorIdsByNode.get(edge.toId)?.push(edge.fromId);
    successorIdsByNode.get(edge.fromId)?.push(edge.toId);
  }
  return {
    edges,
    laneCount,
    nodeById,
    omittedEdgeCount:
      Math.max(0, rawEdges.length - edges.length) +
      transitions.reduce((total, transition) => total + transition.omittedCount, 0),
    omittedNodeCount,
    orderedNodes,
    predecessorIdsByNode,
    rankCount,
    ranks,
    successorIdsByNode,
    transitions,
    truncated: omittedNodeCount > 0 || rawEdges.length > edges.length ||
      transitions.some((transition) => transition.omittedCount > 0),
  };
}
`;
}
