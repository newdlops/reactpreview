/**
 * Generates the bounded Page Inspector registry for user-fired imperative UI triggers.
 *
 * Compiler metadata can arrive when a module evaluates, before its JSX event prop mounts. Callable
 * handlers are added later while React evaluates that prop. Keeping those phases separate lets the
 * component tree show a dormant placeholder without retaining or invoking speculative functions.
 */

/** Maximum deferred trigger records retained by one pinned preview session and source revision. */
export const PREVIEW_INSPECTOR_DEFERRED_UI_TRIGGER_LIMIT = 128;

/** Maximum Fibers inspected while verifying that one registered handler is still mounted. */
export const PREVIEW_INSPECTOR_DEFERRED_UI_FIBER_VISIT_LIMIT = 4096;

/**
 * Creates browser source for metadata registration, mounted-callable verification, and activation.
 *
 * Expected lexical bindings are `previewEntryRevision`, `previewInspectorSession`, Fiber-safe field
 * readers, notification schedulers, and `console`. Invocation exists only as an Inspector UI action;
 * registration and read operations never execute project handlers.
 */
export function createPreviewInspectorDeferredUiTriggerRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_DEFERRED_UI_TRIGGER_LIMIT = ${PREVIEW_INSPECTOR_DEFERRED_UI_TRIGGER_LIMIT};
const PREVIEW_INSPECTOR_DEFERRED_UI_FIBER_VISIT_LIMIT = ${PREVIEW_INSPECTOR_DEFERRED_UI_FIBER_VISIT_LIMIT};
const previewInspectorDeferredUiMethodNames = new Set([
  'open', 'openModal', 'present', 'presentModal', 'show', 'showModal',
]);

/** Creates or resets revision-local trigger state without retaining stale hot-bundle callables. */
function initializePreviewInspectorDeferredUiTriggerState() {
  if (previewInspectorSession.deferredUiTriggerEntryRevision !== previewEntryRevision) {
    previewInspectorSession.deferredUiTriggerEntryRevision = previewEntryRevision;
    previewInspectorSession.deferredUiTriggerRecords = new Map();
    previewInspectorSession.deferredUiTriggerActivations = new WeakMap();
    previewInspectorSession.deferredUiTriggerAutomaticAttemptKeys = new Set();
    previewInspectorSession.deferredUiTriggerHandlerSources = new WeakMap();
    previewInspectorSession.deferredUiTriggerSequence = 0;
    previewInspectorSession.deferredUiTriggerRefreshScheduled = false;
  }
  if (!(previewInspectorSession.deferredUiTriggerRecords instanceof Map)) {
    previewInspectorSession.deferredUiTriggerRecords = new Map();
  }
  if (!(previewInspectorSession.deferredUiTriggerHandlerSources instanceof WeakMap)) {
    previewInspectorSession.deferredUiTriggerHandlerSources = new WeakMap();
  }
  if (!(previewInspectorSession.deferredUiTriggerActivations instanceof WeakMap)) {
    previewInspectorSession.deferredUiTriggerActivations = new WeakMap();
  }
  if (!(previewInspectorSession.deferredUiTriggerAutomaticAttemptKeys instanceof Set)) {
    previewInspectorSession.deferredUiTriggerAutomaticAttemptKeys = new Set();
  }
  if (!Number.isSafeInteger(previewInspectorSession.deferredUiTriggerSequence)) {
    previewInspectorSession.deferredUiTriggerSequence = 0;
  }
}

/** Bounds compiler-issued metadata before it enters the long-lived pinned webview session. */
function normalizePreviewInspectorDeferredUiTriggerMetadata(metadata) {
  const source = metadata !== null && typeof metadata === 'object' ? metadata : {};
  const id = typeof source.id === 'string' ? source.id.slice(0, 128) : '';
  const eventName = typeof source.eventName === 'string' ? source.eventName.slice(0, 64) : '';
  const methodName = typeof source.methodName === 'string' ? source.methodName.slice(0, 64) : '';
  const kind = source.kind === 'local-state-transition'
    ? 'local-state-transition'
    : 'imperative-visibility';
  const stateName = typeof source.stateName === 'string' ? source.stateName.slice(0, 160) : '';
  if (
    id.length === 0 ||
    !/^on[A-Z][A-Za-z0-9]*$/u.test(eventName) ||
    (kind === 'imperative-visibility' && !previewInspectorDeferredUiMethodNames.has(methodName)) ||
    (kind === 'local-state-transition' &&
      (!/^set[A-Z_$][A-Za-z0-9_$]*$/u.test(methodName) ||
        !/^[$_\p{ID_Start}][$_\u200C\u200D\p{ID_Continue}]*$/u.test(stateName)))
  ) {
    return undefined;
  }
  const readText = (name, limit = 240) =>
    typeof source[name] === 'string' ? source[name].slice(0, limit) : '';
  return {
    column: Number.isSafeInteger(source.column) && source.column > 0 ? source.column : undefined,
    eventName,
    expression: readText('expression'),
    id,
    invocationSafe: source.invocationSafe === true,
    kind,
    line: Number.isSafeInteger(source.line) && source.line > 0 ? source.line : undefined,
    methodName,
    ownerName: readText('ownerName', 160),
    sourcePath: readText('sourcePath', 1024),
    ...(kind === 'local-state-transition' ? { stateName } : {}),
  };
}

/** Coalesces registrations emitted during render so an inline lambda cannot cause a render loop. */
function schedulePreviewInspectorDeferredUiTriggerRefresh() {
  if (previewInspectorSession.deferredUiTriggerRefreshScheduled === true) return;
  previewInspectorSession.deferredUiTriggerRefreshScheduled = true;
  const schedule = globalThis.queueMicrotask ?? ((callback) => Promise.resolve().then(callback));
  schedule(() => {
    previewInspectorSession.deferredUiTriggerRefreshScheduled = false;
    try { markPreviewInspectorTreeDirty(); } catch {
      previewInspectorSession.treeDirty = true;
    }
    try { notifyPreviewInspector(); } catch {
      // Metadata remains available even in a reduced runtime harness without React subscribers.
    }
    try { schedulePreviewInspectorTreeRefresh(); } catch {
      // Tree scheduling is optional until the Inspector shell mounts.
    }
  });
}

/** Evicts the oldest source record before a hostile module graph can grow the session unbounded. */
function admitPreviewInspectorDeferredUiTriggerRecord(metadata) {
  initializePreviewInspectorDeferredUiTriggerState();
  const records = previewInspectorSession.deferredUiTriggerRecords;
  let record = records.get(metadata.id);
  if (record !== undefined) return record;
  while (records.size >= PREVIEW_INSPECTOR_DEFERRED_UI_TRIGGER_LIMIT) {
    const oldestId = records.keys().next().value;
    if (typeof oldestId !== 'string') break;
    records.delete(oldestId);
  }
  previewInspectorSession.deferredUiTriggerSequence += 1;
  record = {
    activationCount: 0,
    hasCallableRegistration: false,
    metadata,
    sequence: previewInspectorSession.deferredUiTriggerSequence,
    status: 'dormant',
  };
  records.set(metadata.id, record);
  schedulePreviewInspectorDeferredUiTriggerRefresh();
  return record;
}

/** Registers static source evidence and deliberately returns no executable project value. */
function registerPreviewInspectorDeferredUiTriggerMetadata(metadata) {
  const normalized = normalizePreviewInspectorDeferredUiTriggerMetadata(metadata);
  if (normalized === undefined) return;
  const record = admitPreviewInspectorDeferredUiTriggerRecord(normalized);
  const previousSignature = JSON.stringify(record.metadata);
  const nextSignature = JSON.stringify(normalized);
  record.metadata = normalized;
  if (previousSignature !== nextSignature) schedulePreviewInspectorDeferredUiTriggerRefresh();
}

/**
 * Registers a reached JSX event handler and returns the exact same function object.
 *
 * Handler-to-source membership lives in a WeakMap so repeated inline closures are not retained by
 * the pinned webview. A later Fiber scan must still prove a mounted closure. Imperative handlers
 * require one exact occurrence; positive local-state collection items are ranked as safe variants.
 */
function registerPreviewInspectorDeferredUiTrigger(handler, metadata, activation) {
  if (typeof handler !== 'function') return handler;
  const normalized = normalizePreviewInspectorDeferredUiTriggerMetadata(metadata);
  if (normalized === undefined) return handler;
  if (normalized.kind === 'local-state-transition' && typeof activation !== 'function') {
    return handler;
  }
  const record = admitPreviewInspectorDeferredUiTriggerRecord(normalized);
  const firstCallable = record.hasCallableRegistration !== true;
  const handlerSources = previewInspectorSession.deferredUiTriggerHandlerSources;
  let sourceIds = handlerSources.get(handler);
  if (!(sourceIds instanceof Set)) {
    sourceIds = new Set();
    handlerSources.set(handler, sourceIds);
  }
  sourceIds.add(normalized.id);
  if (normalized.kind === 'local-state-transition') {
    const activations = previewInspectorSession.deferredUiTriggerActivations;
    let activationsBySource = activations.get(handler);
    if (!(activationsBySource instanceof Map)) {
      activationsBySource = new Map();
      activations.set(handler, activationsBySource);
    }
    activationsBySource.set(normalized.id, activation);
  }
  record.hasCallableRegistration = true;
  record.metadata = normalized;
  if (firstCallable) schedulePreviewInspectorDeferredUiTriggerRefresh();
  return handler;
}

/**
 * Indexes source occurrences and mounted event props with one bounded Fiber traversal per snapshot.
 * Boundary root siblings are intentionally excluded; traversal begins at each boundary child.
 */
function createPreviewInspectorDeferredUiTriggerMountIndex(records) {
  const recordsById = new Map();
  const evidenceByRecordId = new Map();
  const identifierSourceCounts = new Map();
  for (const record of records) {
    const metadata = record?.metadata;
    if (typeof metadata?.id === 'string') recordsById.set(metadata.id, record);
    record.identifierSourceSignature = undefined;
    if (/^[A-Za-z_$][\w$]*$/u.test(metadata?.expression ?? '')) {
      const signature = [
        metadata.sourcePath,
        metadata.ownerName,
        metadata.eventName,
        metadata.expression,
        metadata.methodName,
      ].join('\0');
      identifierSourceCounts.set(signature, (identifierSourceCounts.get(signature) ?? 0) + 1);
      record.identifierSourceSignature = signature;
    }
  }
  const pending = [];
  const appendBoundaryRoot = (boundary) => {
    const boundaryRoot = readPreviewInspectorBoundaryFiber(boundary);
    const child = readPreviewInspectorFiberLink(boundaryRoot, 'child');
    if (child === undefined) return;
    pending.push({ ancestorMatches: new Set(), fiber: child });
  };
  const selectedBoundaries =
    typeof readPreviewInspectorActiveTargetBoundaries === 'function'
      ? readPreviewInspectorActiveTargetBoundaries(previewInspectorSession.selectedExportName)
      : previewInspectorSession.boundariesByExport?.get?.(
          previewInspectorSession.selectedExportName,
        ) ?? new Set();
  if (selectedBoundaries !== null && typeof selectedBoundaries?.[Symbol.iterator] === 'function') {
    for (const boundary of selectedBoundaries) appendBoundaryRoot(boundary);
  }
  const activeReachabilityKey = previewInspectorSession.activeTargetReachabilityKey;
  const activeReachability = typeof activeReachabilityKey === 'string'
    ? previewInspectorSession.targetReachabilityByKey?.get?.(activeReachabilityKey)
    : undefined;
  if (
    activeReachability?.directTarget !== true &&
    activeReachability?.pageRootCommitted === true &&
    activeReachability?.pageCommitBoundary !== undefined
  ) {
    appendBoundaryRoot(activeReachability.pageCommitBoundary);
  }
  const visited = new Set();
  let pendingIndex = 0;
  while (
    pendingIndex < pending.length &&
    visited.size < PREVIEW_INSPECTOR_DEFERRED_UI_FIBER_VISIT_LIMIT
  ) {
    const item = pending[pendingIndex];
    pendingIndex += 1;
    const fiber = item?.fiber;
    if (fiber === undefined || fiber === null || visited.has(fiber)) continue;
    visited.add(fiber);
    const props = readPreviewInspectorOwnData(fiber, 'memoizedProps');
    const currentMatches = [];
    let propNames = [];
    try {
      propNames = Object.getOwnPropertyNames(props).slice(0, 64);
    } catch {
      // An unfamiliar props container cannot prove a mounted event handler.
    }
    for (const propName of propNames) {
      const handler = readPreviewInspectorOwnData(props, propName);
      if (typeof handler !== 'function') continue;
      const sourceIds = previewInspectorSession.deferredUiTriggerHandlerSources.get(handler);
      if (!(sourceIds instanceof Set)) continue;
      const matchedRecords = [];
      for (const sourceId of sourceIds) {
        const record = recordsById.get(sourceId);
        if (record?.metadata?.eventName === propName) matchedRecords.push(record);
      }
      for (const record of matchedRecords) {
        let byHandler = evidenceByRecordId.get(record.metadata.id);
        if (!(byHandler instanceof Map)) {
          byHandler = new Map();
          evidenceByRecordId.set(record.metadata.id, byHandler);
        }
        let evidence = byHandler.get(handler);
        if (evidence === undefined) {
          evidence = {
            activation: previewInspectorSession.deferredUiTriggerActivations
              .get(handler)?.get?.(record.metadata.id),
            discoveryOrder: visited.size,
            handler,
            mountedCount: 0,
            selectionPriority: 0,
            sharedSource: false,
          };
          byHandler.set(handler, evidence);
        }
        const tabIndex = readPreviewInspectorOwnData(props, 'tabIndex');
        const ariaSelected = readPreviewInspectorOwnData(props, 'aria-selected');
        const ariaCurrent = readPreviewInspectorOwnData(props, 'aria-current');
        const ariaLabel = readPreviewInspectorOwnData(props, 'aria-label');
        const dataState = readPreviewInspectorOwnData(props, 'data-state');
        evidence.selectionPriority = Math.max(
          evidence.selectionPriority,
          tabIndex === 0 ? 80 : 0,
          ariaSelected === true || ariaSelected === 'true' ? 70 : 0,
          ariaCurrent === true || ariaCurrent === 'true' ? 60 : 0,
          dataState === 'active' || dataState === 'open' ? 50 : 0,
          typeof ariaLabel === 'string' && ariaLabel.length > 0 ? 20 : 0,
        );
        if (matchedRecords.length > 1) evidence.sharedSource = true;
        if (item.ancestorMatches.has(evidence)) continue;
        evidence.mountedCount += 1;
        currentMatches.push(evidence);
      }
    }
    const childAncestorMatches = currentMatches.length === 0
      ? item.ancestorMatches
      : new Set([...item.ancestorMatches, ...currentMatches]);
    pending.push(
      {
        ancestorMatches: childAncestorMatches,
        fiber: readPreviewInspectorFiberLink(fiber, 'child'),
      },
      {
        ancestorMatches: item.ancestorMatches,
        fiber: readPreviewInspectorFiberLink(fiber, 'sibling'),
      },
    );
  }
  const result = new Map();
  for (const record of records) {
    const handlerEvidence = evidenceByRecordId.get(record.metadata?.id);
    const mountedEvidence = handlerEvidence instanceof Map
      ? [...handlerEvidence.values()].filter((evidence) => evidence.mountedCount > 0)
      : [];
    const mounted = mountedEvidence.length > 0;
    const localStateTransition = record.metadata?.kind === 'local-state-transition';
    const ambiguousSource =
      mountedEvidence.some((evidence) => evidence.sharedSource === true) ||
      (identifierSourceCounts.get(record.identifierSourceSignature) ?? 0) > 1;
    const ambiguousOccurrence =
      mountedEvidence.length > 1 || mountedEvidence.some((evidence) => evidence.mountedCount > 1);
    const ambiguous = ambiguousSource || (!localStateTransition && ambiguousOccurrence);
    const invocationSafe = record.metadata?.invocationSafe === true;
    const selectedEvidence = [...mountedEvidence].sort((left, right) =>
      (right.selectionPriority ?? 0) - (left.selectionPriority ?? 0) ||
      (left.discoveryOrder ?? Number.MAX_SAFE_INTEGER) -
        (right.discoveryOrder ?? Number.MAX_SAFE_INTEGER),
    )[0];
    const activationAvailable = !localStateTransition ||
      typeof selectedEvidence?.activation === 'function';
    result.set(record.metadata.id, {
      ambiguous,
      activation: selectedEvidence?.activation,
      available: mounted && invocationSafe && !ambiguous && activationAvailable,
      handler: selectedEvidence?.handler,
      invocationSafe,
      mounted,
      selectionPriority: selectedEvidence?.selectionPriority ?? 0,
      unavailableReason: !invocationSafe
        ? 'zero-argument invocation contract not proven'
        : ambiguous
          ? 'handler occurrence cannot be uniquely matched to this source'
          : !activationAvailable
            ? 'authored state transition is not callable'
          : mounted
            ? undefined
            : 'event handler is not mounted',
    });
  }
  return result;
}

/** Creates serializable tree/UI records without exposing WeakMap-owned project functions. */
function readPreviewInspectorDeferredUiTriggers() {
  initializePreviewInspectorDeferredUiTriggerState();
  const records = [...previewInspectorSession.deferredUiTriggerRecords.values()].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const mountIndex = createPreviewInspectorDeferredUiTriggerMountIndex(records);
  return records.map((record) => {
    const mount = mountIndex.get(record.metadata.id) ?? {
      ambiguous: false,
      available: false,
      invocationSafe: false,
      mounted: false,
      unavailableReason: 'event handler is not mounted',
    };
    return {
      activationCount: record.activationCount,
      ambiguous: mount.ambiguous,
      available: mount.available,
      invocationSafe: mount.invocationSafe,
      mounted: mount.mounted,
      unavailableReason: mount.unavailableReason,
      ...record.metadata,
      ...(typeof record.lastError === 'string' ? { lastError: record.lastError } : {}),
      status: mount.available
        ? record.status === 'failed'
          ? 'failed'
          : record.status === 'invoked'
            ? 'invoked'
            : 'ready'
        : 'dormant',
    };
  });
}

/** Converts arbitrary thrown data to bounded text without trusting project coercion hooks. */
function describePreviewInspectorDeferredUiTriggerFailure(error) {
  const errorMessage = readPreviewInspectorOwnData(error, 'message');
  if (typeof errorMessage === 'string') return errorMessage.slice(0, 512);
  if (error !== null && (typeof error === 'object' || typeof error === 'function')) {
    return '[Thrown ' + typeof error + ']';
  }
  return String(error).slice(0, 512);
}

/** Records one activation failure without throwing through the Inspector's own click boundary. */
function recordPreviewInspectorDeferredUiTriggerFailure(record, error) {
  record.lastError = describePreviewInspectorDeferredUiTriggerFailure(error);
  record.status = 'failed';
  console.warn(
    '[React Preview] Deferred UI trigger failed: ' + record.metadata.methodName + '()',
    record.lastError,
  );
  schedulePreviewInspectorDeferredUiTriggerRefresh();
}

/** Invokes one exact, unambiguous mounted handler only after a deliberate Inspector action. */
function invokePreviewInspectorDeferredUiTrigger(triggerId) {
  initializePreviewInspectorDeferredUiTriggerState();
  const records = [...previewInspectorSession.deferredUiTriggerRecords.values()];
  const record = previewInspectorSession.deferredUiTriggerRecords.get(triggerId);
  const availability = createPreviewInspectorDeferredUiTriggerMountIndex(records).get(triggerId);
  if (record === undefined || availability?.available !== true) {
    console.warn(
      '[React Preview] Deferred UI trigger activation was ignored: ' +
        (availability?.unavailableReason ?? 'trigger unavailable') + '.',
    );
    return false;
  }
  try {
    const callable = record.metadata?.kind === 'local-state-transition'
      ? availability.activation
      : availability.handler;
    const result = Reflect.apply(callable, undefined, []);
    record.activationCount += 1;
    record.lastError = undefined;
    record.status = 'invoked';
    schedulePreviewInspectorDeferredUiTriggerRefresh();
    try { schedulePreviewInspectorCommitRefresh(); } catch {
      // A reduced runtime still records successful activation without a DOM refresh adapter.
    }
    Promise.resolve(result).catch((error) =>
      recordPreviewInspectorDeferredUiTriggerFailure(record, error));
    return true;
  } catch (error) {
    recordPreviewInspectorDeferredUiTriggerFailure(record, error);
    return false;
  }
}

/** Normalizes only separators needed to compare compiler and runtime source identities. */
function normalizePreviewInspectorDeferredUiSourcePath(value) {
  return typeof value === 'string' ? value.replaceAll('\\\\', '/').replaceAll('\\', '/') : '';
}

/** Matches one local state binding as an identifier instead of a loose text fragment. */
function hasPreviewInspectorDeferredUiStateToken(condition, stateName) {
  const expression = [condition?.expression, condition?.authoredExpression]
    .filter((value) => typeof value === 'string')
    .join(' ');
  let offset = expression.indexOf(stateName);
  const isIdentifierCharacter = (value) =>
    typeof value === 'string' && value.length > 0 && /[A-Za-z0-9_$]/u.test(value);
  while (offset >= 0) {
    const left = expression[offset - 1];
    const right = expression[offset + stateName.length];
    if (!isIdentifierCharacter(left) && !isIdentifierCharacter(right)) return true;
    offset = expression.indexOf(stateName, offset + stateName.length);
  }
  return false;
}

/** Scopes one replay to the current page-remount generation, not the whole editor revision. */
function createPreviewInspectorDeferredUiAutomaticAttemptKey(state, condition, record) {
  const renderGeneration = Number.isSafeInteger(previewInspectorSession.renderConditionRevision)
    ? previewInspectorSession.renderConditionRevision
    : 0;
  return [
    previewEntryRevision,
    renderGeneration,
    state?.key,
    condition?.id,
    record?.metadata?.id,
  ].join(':');
}

/**
 * Replays one compiler-proven positive useState transition inside the mounted authored page.
 *
 * This is intentionally narrower than a synthetic click: the generated closure calls only the
 * exact setter expression captured by React's mounted render. Repeated collection items are safe
 * alternatives for the same positive state hole; active/selected Fiber props rank the first probe.
 */
function autoInvokePreviewInspectorAuthoredStateTrigger(state, condition) {
  initializePreviewInspectorDeferredUiTriggerState();
  if (
    state === undefined || condition === undefined || state.directTarget === true ||
    previewInspectorSession.activeTargetReachabilityKey !== state.key ||
    condition.reachabilityKey !== state.key
  ) return undefined;
  const conditionSourcePath = normalizePreviewInspectorDeferredUiSourcePath(condition.sourcePath);
  const conditionOwner = typeof condition.runtimeOwnerName === 'string' &&
    condition.runtimeOwnerName.length > 0
    ? condition.runtimeOwnerName
    : condition.ownerName;
  const records = [...previewInspectorSession.deferredUiTriggerRecords.values()]
    .filter((record) => {
      const metadata = record?.metadata;
      return metadata?.kind === 'local-state-transition' &&
        metadata.invocationSafe === true &&
        normalizePreviewInspectorDeferredUiSourcePath(metadata.sourcePath) === conditionSourcePath &&
        typeof conditionOwner === 'string' && conditionOwner.length > 0 &&
        metadata.ownerName === conditionOwner &&
        hasPreviewInspectorDeferredUiStateToken(condition, metadata.stateName);
    });
  if (records.length === 0) return undefined;
  const mountIndex = createPreviewInspectorDeferredUiTriggerMountIndex(records);
  const candidates = records
    .map((record) => ({ availability: mountIndex.get(record.metadata.id), record }))
    .filter(({ availability, record }) => {
      if (availability?.available !== true) return false;
      const attemptKey = createPreviewInspectorDeferredUiAutomaticAttemptKey(
        state,
        condition,
        record,
      );
      return !previewInspectorSession.deferredUiTriggerAutomaticAttemptKeys.has(attemptKey);
    });
  if (candidates.length === 0) return undefined;
  const specification = {
    blockerKind: 'target-reachability',
    holeKind: 'authored-local-state-transition',
    numbers: {
      candidateCount: candidates.length,
      conditionLine: condition.line ?? 0,
    },
    texts: [condition.expression, conditionOwner, conditionSourcePath],
    tokens: [
      'condition-kind:' + String(condition.kind ?? 'condition'),
      'desired:true',
      'target:' + String(state.targetExportName ?? ''),
    ],
  };
  const portfolio = candidates.map(({ availability, record }) => ({
    deterministicRank:
      (100 - Math.min(100, availability.selectionPriority ?? 0)) * 1000 +
      (record.sequence ?? 0),
    id: record.metadata.id,
    numbers: { selectionPriority: availability.selectionPriority ?? 0 },
    texts: [record.metadata.expression, record.metadata.ownerName, record.metadata.stateName],
    tokens: ['event:' + record.metadata.eventName, 'setter:' + record.metadata.methodName],
  }));
  const neuralSelection = typeof selectPreviewInspectorNeuralResidualCandidate === 'function'
    ? selectPreviewInspectorNeuralResidualCandidate(specification, portfolio)
    : undefined;
  const selectedId = neuralSelection?.candidateId ?? [...portfolio]
    .sort((left, right) => left.deterministicRank - right.deterministicRank)[0]?.id;
  const selected = candidates.find(({ record }) => record.metadata.id === selectedId);
  if (selected === undefined) return undefined;
  const attemptKey = createPreviewInspectorDeferredUiAutomaticAttemptKey(
    state,
    condition,
    selected.record,
  );
  previewInspectorSession.deferredUiTriggerAutomaticAttemptKeys.add(attemptKey);
  while (previewInspectorSession.deferredUiTriggerAutomaticAttemptKeys.size > 512) {
    previewInspectorSession.deferredUiTriggerAutomaticAttemptKeys.delete(
      previewInspectorSession.deferredUiTriggerAutomaticAttemptKeys.values().next().value,
    );
  }
  if (!invokePreviewInspectorDeferredUiTrigger(selected.record.metadata.id)) return undefined;
  if (typeof recordPreviewInspectorBlockerAutoDecision === 'function') {
    recordPreviewInspectorBlockerAutoDecision({
      action: 'Replay authored page state transition',
      blockerId: 'target-reachability:' + state.key,
      blockerKind: 'target-reachability',
      blockerName: 'Target not reached · ' + String(state.targetExportName ?? ''),
      line: selected.record.metadata.line,
      mode: 'authored-state-transition-auto',
      neuralResidualDecision: neuralSelection?.decision,
      ownerName: selected.record.metadata.ownerName,
      reason: 'A mounted page callback supplies the positive local state required by the target path',
      selectedValue: {
        stateName: selected.record.metadata.stateName,
        triggerId: selected.record.metadata.id,
      },
      startsRenderAttempt: true,
    });
  }
  return {
    metadata: selected.record.metadata,
    neuralResidualDecision: neuralSelection?.decision,
  };
}
`;
}
