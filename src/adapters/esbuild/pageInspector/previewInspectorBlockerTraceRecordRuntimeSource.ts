/**
 * Serializes bounded anonymous blocker records and correlated host envelopes without retaining project objects.
 * This adapter emits a lexical fragment composed by previewInspectorBlockerTraceRuntimeSource.
 * Session state and helper ownership remain in the same generated browser module.
 */

/** Returns the ordered browser fragment; no project code runs during source generation. */
export function createPreviewInspectorBlockerTraceRecordRuntimeSource(): string {
  return String.raw`
/** Returns selected preview identity without retaining descriptor or page-candidate objects. */
function readPreviewInspectorBlockerTraceTarget() {
  return {
    exportName:
      typeof previewInspectorSession.selectedExportName === 'string'
        ? previewInspectorSession.selectedExportName
        : undefined,
    pageCandidateId:
      typeof previewInspectorSession.selectedPageCandidateId === 'string'
        ? previewInspectorSession.selectedPageCandidateId
        : undefined,
    renderScenario:
      typeof previewInspectorSession.renderScenario === 'string'
        ? previewInspectorSession.renderScenario
        : undefined,
    revision:
      typeof previewEntryRevision === 'number' && Number.isSafeInteger(previewEntryRevision)
        ? previewEntryRevision
        : 0,
  };
}

/** Posts one bounded event without allowing diagnostic delivery to affect project rendering. */
function postPreviewInspectorBlockerTraceEvent(event, traceId, fields = {}) {
  if (typeof previewInspectorPostHostMessage !== 'function') return;
  initializePreviewInspectorBlockerTraceState();
  previewInspectorSession.blockerTraceEventSequence += 1;
  const message = {
    ...readPreviewInspectorRuntimeCorrelation(),
    event: {
      ...fields,
      event,
      // Canonical campaign command identity; paths and target names stay inside the private manifest.
      previewCommand: 'page-inspector',
      sequence: previewInspectorSession.blockerTraceEventSequence,
      target: readPreviewInspectorBlockerTraceTarget(),
      timestamp: new Date().toISOString(),
      traceId,
    },
    type: 'react-preview-blocker-trace',
  };
  try {
    const delivery = previewInspectorPostHostMessage(message);
    if (delivery !== null && typeof delivery === 'object' && typeof delivery.catch === 'function') {
      delivery.catch(() => undefined);
    }
  } catch {
    /* Blocker diagnostics must never become a new render blocker. */
  }
}

/** Reads one own data property without invoking project getters or proxy fallbacks. */
function readPreviewInspectorBlockerTraceOwnValue(value, propertyName) {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, propertyName);
    return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/** Copies arbitrary internal records into small JSON-compatible diagnostic values. */
function copyPreviewInspectorBlockerTraceValue(
  value,
  depth = 0,
  state = { limit: 384, nodes: 0, seen: new WeakSet() },
) {
  state.nodes += 1;
  if (state.nodes > state.limit) return '[Node limit]';
  if (typeof value === 'string') return value.slice(0, PREVIEW_INSPECTOR_BLOCKER_TRACE_TEXT_LIMIT);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (value === undefined) return '[undefined]';
  if (typeof value === 'bigint') return String(value) + 'n';
  if (typeof value === 'symbol') return '[Symbol]';
  if (typeof value === 'function') {
    const name = readPreviewInspectorBlockerTraceOwnValue(value, 'name');
    return '[Function' + (typeof name === 'string' && name.length > 0 ? ' ' + name : '') + ']';
  }
  if (typeof value !== 'object') return '[' + typeof value + ']';
  if (state.seen.has(value)) return '[Circular]';
  if (depth >= 5) return '[Depth limit]';
  state.seen.add(value);
  let isArray = false;
  try { isArray = Array.isArray(value); } catch { return '[Uninspectable]'; }
  if (isArray) {
    const result = [];
    const length = Math.min(Number.isSafeInteger(value.length) ? value.length : 0, 48);
    for (let index = 0; index < length; index += 1) {
      result.push(copyPreviewInspectorBlockerTraceValue(value[index], depth + 1, state));
    }
    if (value.length > length) result.push('[Truncated]');
    return result;
  }
  let keys;
  try { keys = Object.keys(value).slice(0, 48); } catch { return '[Uninspectable]'; }
  const result = {};
  for (const propertyName of keys) {
    if (blockedInspectorPropNames.has(propertyName)) continue;
    const propertyValue = readPreviewInspectorBlockerTraceOwnValue(value, propertyName);
    result[propertyName] = copyPreviewInspectorBlockerTraceValue(
      propertyValue,
      depth + 1,
      state,
    );
  }
  return result;
}

/** Keeps only absolute authored JS/TS locations; the host performs the authoritative graph check. */
function createPreviewInspectorBlockerTraceSource(value) {
  const sourcePath =
    typeof value?.sourcePath === 'string'
      ? value.sourcePath
      : typeof value?.path === 'string'
        ? value.path
        : '';
  const absolute = sourcePath.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(sourcePath);
  if (!absolute) return undefined;
  const source = { sourcePath };
  if (Number.isSafeInteger(value?.line) && value.line > 0) source.line = value.line;
  if (Number.isSafeInteger(value?.column) && value.column > 0 && source.line !== undefined) {
    source.column = value.column;
  }
  if (Number.isSafeInteger(value?.occurrenceStart) && value.occurrenceStart >= 0) {
    source.occurrenceStart = value.occurrenceStart;
  }
  return source;
}

/** Converts one enriched tree blocker into a stable, source-backed diagnostic record. */
function createPreviewInspectorBlockerTraceRecord(node) {
  const blocker = node?.blocker;
  const source = createPreviewInspectorBlockerTraceSource(
    node?.source ?? {
      column: blocker?.column,
      line: blocker?.line,
      occurrenceStart: blocker?.occurrenceStart,
      sourcePath: blocker?.sourcePath,
    },
  );
  const diagnosticState =
    node?.blockerKind === 'target-reachability'
      ? node?.state
      : node?.blockerKind === 'runtime-fallback'
        ? { error: blocker?.error, reason: blocker?.reason }
        : node?.blockerKind === 'target-error' || node?.blockerKind === 'runtime-global'
          ? { error: blocker?.headline, requiredPaths: blocker?.requiredPaths }
          : undefined;
  const kind = String(node?.blockerKind ?? node?.kind ?? 'blocker').slice(0, 120);
  return {
    category: normalizePreviewInspectorBlockerTraceCategory(kind),
    id: String(node?.blockerId ?? node?.id ?? 'unknown-blocker').slice(0, 160),
    kind,
    name: String(node?.name ?? 'Render blocker').slice(0, PREVIEW_INSPECTOR_BLOCKER_TRACE_TEXT_LIMIT),
    outcome: 'report-only',
    ownerName:
      typeof blocker?.ownerName === 'string'
        ? blocker.ownerName
        : typeof node?.ownerExportName === 'string'
          ? node.ownerExportName
          : undefined,
    ...(source === undefined ? {} : { source }),
    summary: copyPreviewInspectorBlockerTraceValue({
      active: typeof isPreviewInspectorBlockingNode === 'function'
        ? isPreviewInspectorBlockingNode(node)
        : true,
      props: node?.props,
      state: diagnosticState,
    }),
  };
}

/** Maps existing generic kinds to the host's bounded, privacy-preserving taxonomy. */
function normalizePreviewInspectorBlockerTraceCategory(kind) {
  return PREVIEW_INSPECTOR_BLOCKER_CATEGORY_BY_KIND[kind] ?? 'unsupported';
}

/** Collects only unresolved blocker pseudo-nodes without retaining Fiber/component references. */
function collectPreviewInspectorBlockerTraceRecords(nodes, records = new Map(), depth = 0) {
  if (!Array.isArray(nodes) || depth > 80 || records.size >= PREVIEW_INSPECTOR_BLOCKER_TRACE_RECORD_LIMIT) {
    return records;
  }
  for (const node of nodes) {
    if (node?.kind === 'blocker' && typeof node?.blockerKind === 'string') {
      const blocking =
        typeof isPreviewInspectorBlockingNode === 'function'
          ? isPreviewInspectorBlockingNode(node)
          : true;
      if (blocking) {
        const record = createPreviewInspectorBlockerTraceRecord(node);
        records.set(record.id, record);
        if (records.size >= PREVIEW_INSPECTOR_BLOCKER_TRACE_RECORD_LIMIT) break;
      }
    }
    collectPreviewInspectorBlockerTraceRecords(node?.children, records, depth + 1);
  }
  return records;
}

/** Creates a stable comparison string from an already bounded blocker record. */
function fingerprintPreviewInspectorBlockerTraceRecord(record) {
  try { return JSON.stringify(record); } catch { return String(record?.id ?? 'blocker'); }
}

/** Reduces a group to one source-backed record while retaining bounded member identities. */
function createPreviewInspectorBlockerTraceBatchRecord(records, label, totalCount = records.length) {
  const first = records[0];
  if (totalCount <= 1 || first === undefined) return first;
  const blockers = records.slice(0, PREVIEW_INSPECTOR_BLOCKER_TRACE_BATCH_DETAIL_LIMIT).map(
    (record) => ({
      id: record.id,
      kind: record.kind,
      name: record.name,
      category: record.category,
      outcome: record.outcome,
      ownerName: record.ownerName,
      source: record.source,
    }),
  );
  return {
    ...first,
    id: 'batch:' + label + ':' + first.id,
    name: label + ' · ' + String(totalCount) + ' blockers',
    summary: {
      batchCount: totalCount,
      blockers,
      truncatedCount: Math.max(0, totalCount - blockers.length),
    },
  };
}

/** Posts one discovery/update group so host source reads do not scale with tree breadth. */
function postPreviewInspectorBlockerTraceRecordBatch(event, traceId, blockerIds, records) {
  const blockers = blockerIds.map((id) => records.get(id)).filter((record) => record !== undefined);
  const blocker = createPreviewInspectorBlockerTraceBatchRecord(blockers, event);
  if (blocker === undefined) return;
  postPreviewInspectorBlockerTraceEvent(event, traceId, { blocker });
}
`;
}
