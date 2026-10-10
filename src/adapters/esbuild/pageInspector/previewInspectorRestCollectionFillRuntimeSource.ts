/**
 * Generates the verified post-reach row fill for empty REST collections.
 *
 * While the Page Inspector looks for the selected target, every virtual REST collection is served
 * empty ("corridor Auto"), so unrelated siblings cannot run row code with generated values before
 * the target is known. GraphQL pages later get rows through compiler-proven render demand, but a
 * REST response crosses a JSON boundary and has no such proof, so list pages stayed in their empty
 * state ("No orders yet."). Once the target has rendered and nothing is pending, this runtime makes
 * one attempt per entry revision and target corridor: requests whose declared or compiler-inferred
 * response shape has object rows are re-served with sample rows in their outermost collections
 * (nested collections stay empty), and the one-row minimum an Auto requirement pass wrote as an
 * automatic Smart override is served with sample rows after its first row (the override itself is
 * untouched, so each revision verifies again); then the page remounts. Rows are withdrawn for that revision on a
 * target error or a new fatal error, or when the page is quiet again (or at a deadline) without the
 * target's output or with more Inspector blockers than before; an error also bars that corridor
 * for the rest of the session. After a kept round, requests registered later (a tab, a modal, a
 * delayed query) get up to two more verified rounds while the kept rows stay served. While rows are served, VirtualPage bootstrap continuations do not
 * open guards first seen in row components. Endpoint-name guesses, user payloads, and non-success
 * scenarios are never filled. Generated GraphQL hook values whose one-row lists the page renders
 * without compiler render demand join the same rounds (previewInspectorHookCollectionFillRuntimeSource).
 */

import { createPreviewInspectorHookCollectionFillRuntimeSource } from './previewInspectorHookCollectionFillRuntimeSource';

/** Creates browser source composed into the Page Inspector data runtime. */
export function createPreviewInspectorRestCollectionFillRuntimeSource(): string {
  const hookCollectionFillRuntimeSource = createPreviewInspectorHookCollectionFillRuntimeSource();
  return String.raw`
const PREVIEW_INSPECTOR_REST_COLLECTION_FILL_REQUEST_LIMIT = 8;
const PREVIEW_INSPECTOR_REST_COLLECTION_FILL_WATCH_MS = 2_000;
const PREVIEW_INSPECTOR_REST_COLLECTION_FILL_POLL_MS = 250;
const PREVIEW_INSPECTOR_REST_COLLECTION_FILL_DEADLINE_MS = 10_000;
const PREVIEW_INSPECTOR_REST_COLLECTION_FILL_START_RETRY_LIMIT = 40;
const PREVIEW_INSPECTOR_REST_COLLECTION_FILL_FAILED_KEY_LIMIT = 64;
const PREVIEW_INSPECTOR_REST_COLLECTION_FILL_ROUND_LIMIT = 3;

/** Serves empty lists before reach; requests admitted by a live fill get rows in outer lists. */
function readPreviewInspectorAutoPayloadProfile(requestId, renderScenario) {
  if (
    renderScenario !== 'authored-page' &&
    typeof previewInspectorSession.activeTargetReachabilityKey !== 'string'
  ) return 'auto';
  return isPreviewInspectorRestCollectionFillRequestServed(requestId) ? 'corridor-rows' : 'corridor-auto';
}

/** Lists outermost array paths whose items declare object fields. */
function readPreviewInspectorStructuredCollectionPaths(shape, prefix = '', paths = [], depth = 0) {
  if (depth > 8 || paths.length >= 8 || shape === null || typeof shape !== 'object') return paths;
  if (shape.kind === 'array') {
    const fields = shape.items?.kind === 'object' ? shape.items.fields : undefined;
    if (fields !== null && typeof fields === 'object' && Object.keys(fields).length > 0) {
      paths.push(prefix);
    }
    return paths;
  }
  if (shape.kind !== 'object' || shape.fields === null || typeof shape.fields !== 'object') {
    return paths;
  }
  for (const [fieldName, child] of Object.entries(shape.fields)) {
    if (blockedInspectorPropNames.has(fieldName)) continue;
    readPreviewInspectorStructuredCollectionPaths(
      child,
      prefix.length > 0 ? prefix + '.' + fieldName : fieldName,
      paths,
      depth + 1,
    );
  }
  return paths;
}

/** Reads one own data path without invoking getters. */
function readPreviewInspectorRestCollectionValue(value, path) {
  let current = value;
  for (const segment of path.length === 0 ? [] : path.split('.')) {
    if (current === null || typeof current !== 'object' || blockedInspectorPropNames.has(segment)) {
      return undefined;
    }
    const descriptor = Object.getOwnPropertyDescriptor(current, segment);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return undefined;
    current = descriptor.value;
  }
  return current;
}

/** Reports a REST request whose response shape is declared or compiler-inferred, not name-guessed. */
function isPreviewInspectorDeclaredRestRequest(record) {
  if (record?.kind !== 'rest' || record.shape === null || typeof record.shape !== 'object') {
    return false;
  }
  const guessedShape = inferPreviewInspectorEndpointShape({
    label: record.label,
    url: record.url ?? '',
  });
  return stringifyPreviewInspectorProps(record.shape) !== stringifyPreviewInspectorProps(guessedShape);
}

/**
 * Selects successful, declared REST requests whose outer object collections are short: empty lists
 * served by the corridor profile, or the one-row minimum that an Auto requirement pass wrote as an
 * automatic Smart override. User payloads (custom, Smart button, Lorem) are never touched.
 */
function selectPreviewInspectorRestCollectionFillRequests(knownRequestIds) {
  const selected = [];
  const sampleCount = readPreviewGeneratedListSampleCount();
  for (const record of previewInspectorSession.dataRequests?.values?.() ?? []) {
    if (selected.length >= PREVIEW_INSPECTOR_REST_COLLECTION_FILL_REQUEST_LIMIT) break;
    if (knownRequestIds?.has?.(record?.id) === true) continue;
    const override = previewInspectorSession.dataPayloadOverrides?.get?.(record?.id);
    const automaticSmart = override?.mode === 'smart' && override.automatic === true;
    if (
      record?.kind !== 'rest' ||
      (override !== undefined && !automaticSmart) ||
      (!automaticSmart && record.autoPayloadProfile !== 'corridor-auto') ||
      readPreviewInspectorVirtualBackendScenario(record.id)?.mode !== 'success'
    ) continue;
    // An endpoint-name guess is shape-blind; only declared or compiler-inferred rows are filled.
    if (!isPreviewInspectorDeclaredRestRequest(record)) continue;
    const served = automaticSmart ? override.payload : record.lastPayload ?? record.autoPayload;
    const paths = readPreviewInspectorStructuredCollectionPaths(record.shape).filter((path) => {
      const value = readPreviewInspectorRestCollectionValue(served, path);
      return Array.isArray(value) && (automaticSmart ? value.length < sampleCount : value.length === 0);
    });
    if (paths.length === 0) continue;
    const payload = automaticSmart
      ? expandPreviewInspectorRestCollectionRows(served, record.shape, paths, sampleCount)
      : undefined;
    if (automaticSmart && payload === undefined) continue;
    selected.push({ id: record.id, label: record.label, override, paths, payload });
  }
  return selected;
}

/** Returns the array shape at one structured collection path. */
function readPreviewInspectorRestCollectionShape(shape, path) {
  let current = shape;
  for (const segment of path.length === 0 ? [] : path.split('.')) {
    current = current?.kind === 'object' ? current.fields?.[segment] : undefined;
  }
  return current?.kind === 'array' ? current : undefined;
}

/**
 * Appends generated rows after the Smart rows at each path so the requirement-guided first row keeps
 * its values. Returns undefined when a generated row would repeat an identity value (React keys).
 */
function expandPreviewInspectorRestCollectionRows(payload, shape, paths, sampleCount) {
  const expanded = JSON.parse(stringifyPreviewInspectorProps(payload));
  for (const path of paths) {
    const arrayShape = readPreviewInspectorRestCollectionShape(shape, path);
    const rows = readPreviewInspectorRestCollectionValue(expanded, path);
    if (arrayShape === undefined || !Array.isArray(rows)) return undefined;
    const generated = generatePreviewInspectorDataValue(
      arrayShape,
      path.split('.').at(-1) ?? '',
      'corridor-rows',
    );
    if (!Array.isArray(generated)) return undefined;
    rows.push(...generated.slice(rows.length, sampleCount));
    for (const field of ['id', 'key', 'uuid', '_id', 'slug', 'code']) {
      const values = rows
        .map((row) => (row !== null && typeof row === 'object' ? row[field] : undefined))
        .filter((value) => typeof value === 'string' || typeof value === 'number');
      if (new Set(values).size !== values.length) return undefined;
    }
  }
  return expanded;
}

/** Reports a reached target with its own output and no target error. */
function isPreviewInspectorRestCollectionFillTargetReached(detail) {
  const target = detail?.targetState;
  return target?.status === 'reached' &&
    target.stage === 'target-output' &&
    target.hasOutput === true &&
    !target.errorMessage;
}

/** Starts the one fill attempt of this revision and target once nothing else is pending. */
function startPreviewInspectorRestCollectionFill(detail) {
  const reachabilityKey = previewInspectorSession.activeTargetReachabilityKey;
  const previous = previewInspectorSession.restCollectionFill;
  const sameCorridor = previous?.revision === previewEntryRevision &&
    previous.reachabilityKey === reachabilityKey;
  // After a kept round, requests registered since it started (a tab, a modal, a delayed query) get
  // one more verified round; earlier requests and withdrawn rounds are never retried.
  const lateRound = sameCorridor && previous.status === 'kept' &&
    (previous.round ?? 1) < PREVIEW_INSPECTOR_REST_COLLECTION_FILL_ROUND_LIMIT &&
    previewInspectorSession.restCollectionFillLateFailedKeys?.has?.(reachabilityKey) !== true;
  if (
    typeof reachabilityKey !== 'string' ||
    (sameCorridor && !lateRound) ||
    previewInspectorSession.restCollectionFillFailedKeys?.has?.(reachabilityKey) === true ||
    previewInspectorSession.dataAutoEnabled !== true ||
    !isPreviewInspectorRestCollectionFillTargetReached(detail)
  ) return false;
  if (isPreviewInspectorRestCollectionFillDeferred(detail)) {
    schedulePreviewInspectorRestCollectionFillStartRetry();
    return false;
  }
  const requests = selectPreviewInspectorRestCollectionFillRequests(
    lateRound ? previous.knownRequestIds : undefined,
  );
  const hooks = selectPreviewInspectorHookCollectionFills(
    lateRound ? previous.knownHookIds : undefined,
  );
  if (requests.length === 0 && hooks.length === 0) return false;
  const recentFatalErrors = previewInspectorSession.blockerTraceRecentFatalErrors;
  const fill = {
    activeBlockers: Number(detail?.blockerSummary?.active) || 0,
    // Hook rows are served beside the cached generated value of each admitted hook.
    hookValues: new Map(hooks.map((hook) => [hook.id, { base: hook.base, value: hook.value }])),
    inheritedHookValues: lateRound
      ? new Map([...previous.inheritedHookValues ?? [], ...previous.hookValues ?? []])
      : new Map(),
    inheritedPayloads: lateRound
      ? new Map([...previous.inheritedPayloads ?? [], ...previous.payloads ?? []])
      : new Map(),
    inheritedRequestIds: lateRound
      ? new Set([...previous.inheritedRequestIds ?? [], ...previous.requestIds])
      : new Set(),
    knownHookIds: new Set(previewInspectorSession.runtimeFallbacks?.keys?.() ?? []),
    knownRequestIds: new Set(previewInspectorSession.dataRequests?.keys?.() ?? []),
    knownFatalErrors: new Set(
      typeof recentFatalErrors?.keys === 'function' ? recentFatalErrors.keys() : [],
    ),
    lastDetail: detail,
    quietSince: undefined,
    reachabilityKey,
    requestIds: new Set(requests.map((request) => request.id)),
    revision: previewEntryRevision,
    startedAt: Date.now(),
    // Expanded automatic Smart payloads are served beside their untouched overrides, so a new
    // revision or a withdrawal returns to the one-row minimum and the rows are verified again.
    payloads: new Map(
      requests.flatMap((request) =>
        request.payload === undefined ? [] : [[request.id, request.payload]]),
    ),
    round: lateRound ? (previous.round ?? 1) + 1 : 1,
    status: 'applied',
    traceId: undefined,
  };
  previewInspectorSession.restCollectionFill = fill;
  for (const requestId of fill.payloads.keys()) {
    clearPreviewInspectorRestCollectionFillResource(requestId);
  }
  fill.traceId = recordPreviewInspectorRestCollectionFillDecision(
    'Fill REST collection sample rows',
    [...requests, ...hooks],
    (fill.round > 1 ? 'Requests registered after the kept rows (round ' + String(fill.round) + ')'
      : 'Target reached') +
      ' with empty or one-row declared REST collections or rendered one-row GraphQL hook' +
      ' collections; serving sample rows and verifying',
  );
  commitPreviewInspectorDataChange();
  notifyPreviewInspectorCollectionFillHookConsumers(fill);
  schedulePreviewInspectorRestCollectionFillEvaluation(fill);
  return true;
}

/**
 * Reports work that would observe the remount: an open render attempt, requirement search, page
 * execution preparation, or neural assistance. Neural path restoration compares a fingerprint of
 * the session's requests, so rows served mid-restoration read as a lost target, and a fill taken
 * during a success sweep would record an explored alternative instead of the page.
 */
function isPreviewInspectorRestCollectionFillDeferred(detail) {
  const attempt = previewInspectorSession.blockerTraceActiveAttempt;
  return (attempt !== undefined && attempt.settledAt === undefined) ||
    detail?.requirementSearch?.searchStatus === 'searching' ||
    previewInspectorSession.pendingPageExecutionPreparation !== undefined ||
    previewInspectorSession.neuralAssistancePending === true ||
    (typeof isPreviewInspectorNeuralSuccessfulPathRestorationActive === 'function' &&
      isPreviewInspectorNeuralSuccessfulPathRestorationActive()) ||
    (typeof isPreviewInspectorNeuralSuccessCollectionBusy === 'function' &&
      isPreviewInspectorNeuralSuccessCollectionBusy());
}


/** Rechecks a deferred start with the latest snapshot, since quiet pages emit no new snapshot. */
function schedulePreviewInspectorRestCollectionFillStartRetry() {
  const reachabilityKey = previewInspectorSession.activeTargetReachabilityKey;
  let retry = previewInspectorSession.restCollectionFillStartRetry;
  if (retry?.revision !== previewEntryRevision || retry.reachabilityKey !== reachabilityKey) {
    retry = { count: 0, reachabilityKey, revision: previewEntryRevision, scheduled: false };
    previewInspectorSession.restCollectionFillStartRetry = retry;
  }
  if (
    retry.scheduled ||
    retry.count >= PREVIEW_INSPECTOR_REST_COLLECTION_FILL_START_RETRY_LIMIT ||
    typeof globalThis.setTimeout !== 'function'
  ) return;
  retry.scheduled = true;
  retry.count += 1;
  globalThis.setTimeout(() => {
    retry.scheduled = false;
    if (previewInspectorSession.restCollectionFillStartRetry !== retry) return;
    try {
      startPreviewInspectorRestCollectionFill(previewInspectorSession.restCollectionFillLatestDetail);
    } catch {
      // A failed retry leaves the lists empty, exactly as before the fill existed.
    }
  }, PREVIEW_INSPECTOR_REST_COLLECTION_FILL_POLL_MS * 2);
}

/** Reports whether rows are served for the current revision and target corridor. */
function isPreviewInspectorRestCollectionFillServing() {
  const fill = readPreviewInspectorRestCollectionFillCorridor();
  return fill !== undefined && (
    fill.status === 'applied' || fill.status === 'kept' ||
    fill.inheritedRequestIds?.size > 0 || fill.inheritedHookValues?.size > 0
  );
}

/** Returns the fill of the current revision and target corridor, if any. */
function readPreviewInspectorRestCollectionFillCorridor() {
  const fill = previewInspectorSession.restCollectionFill;
  return fill !== undefined &&
    fill.revision === previewEntryRevision &&
    fill.reachabilityKey === previewInspectorSession.activeTargetReachabilityKey
    ? fill
    : undefined;
}

/** Reports rows for one request: kept rows of earlier rounds, or this round while it is live. */
function isPreviewInspectorRestCollectionFillRequestServed(requestId) {
  const fill = readPreviewInspectorRestCollectionFillCorridor();
  return fill !== undefined && (
    fill.inheritedRequestIds?.has?.(requestId) === true ||
    ((fill.status === 'applied' || fill.status === 'kept') && fill.requestIds.has(requestId))
  );
}

/** Returns the expanded automatic Smart payload served for one request while rows are served. */
function readPreviewInspectorRestCollectionFillPayload(requestId) {
  if (!isPreviewInspectorRestCollectionFillRequestServed(requestId)) return undefined;
  const fill = previewInspectorSession.restCollectionFill;
  return fill.payloads?.get?.(requestId) ?? fill.inheritedPayloads?.get?.(requestId);
}

/** Reads the verdict evidence: the target still owns its output with no more blockers than before. */
function isPreviewInspectorRestCollectionFillHealthy(fill, detail) {
  const target = detail?.targetState;
  return target?.status === 'reached' &&
    target.stage === 'target-output' &&
    target.hasOutput === true &&
    !target.errorMessage &&
    (Number(detail?.blockerSummary?.active) || 0) <= fill.activeBlockers;
}

/**
 * Records each remounted snapshot. A target error withdraws the rows at once; loading states,
 * blocker churn, and Inspector search passes are only remembered until the page is quiet.
 */
function verifyPreviewInspectorRestCollectionFill(fill, detail) {
  fill.lastDetail = detail;
  const target = detail?.targetState;
  if (target?.errorMessage || target?.status === 'target-error') {
    withdrawPreviewInspectorRestCollectionFill(fill, 'Rows left the target with an error', true);
    return true;
  }
  const attempt = previewInspectorSession.blockerTraceActiveAttempt;
  fill.quietSince = attempt !== undefined && attempt.settledAt === undefined ? undefined : Date.now();
  return false;
}

/** Polls a live fill until the page is quiet, then keeps or withdraws the rows exactly once. */
function schedulePreviewInspectorRestCollectionFillEvaluation(fill) {
  if (typeof globalThis.setTimeout !== 'function') return;
  globalThis.setTimeout(() => {
    try {
      evaluatePreviewInspectorRestCollectionFill(fill);
    } catch {
      // The rows stay applied; a later target error or fatal error still withdraws them.
    }
  }, PREVIEW_INSPECTOR_REST_COLLECTION_FILL_POLL_MS);
}

/**
 * Decides once no attempt has been open and no snapshot has arrived for the watch window, or at the
 * deadline: the latest snapshot must show the target's output without additional blockers.
 */
function evaluatePreviewInspectorRestCollectionFill(fill) {
  if (
    previewInspectorSession.restCollectionFill !== fill ||
    fill.status !== 'applied' ||
    fill.revision !== previewEntryRevision
  ) return false;
  if (fill.reachabilityKey !== previewInspectorSession.activeTargetReachabilityKey) {
    // The user left this corridor before a verdict; its rows are no longer served anywhere.
    fill.status = 'superseded';
    fill.lastDetail = undefined;
    return false;
  }
  const now = Date.now();
  const attempt = previewInspectorSession.blockerTraceActiveAttempt;
  if (attempt !== undefined && attempt.settledAt === undefined) fill.quietSince = undefined;
  else fill.quietSince ??= now;
  const quiet = fill.quietSince !== undefined &&
    now - fill.quietSince >= PREVIEW_INSPECTOR_REST_COLLECTION_FILL_WATCH_MS;
  if (!quiet && now - fill.startedAt < PREVIEW_INSPECTOR_REST_COLLECTION_FILL_DEADLINE_MS) {
    schedulePreviewInspectorRestCollectionFillEvaluation(fill);
    return false;
  }
  if (isPreviewInspectorRestCollectionFillHealthy(fill, fill.lastDetail)) {
    fill.status = 'kept';
    fill.lastDetail = undefined;
    // A quiet page sends no further snapshot: check once for requests registered during this round.
    schedulePreviewInspectorRestCollectionFillStartRetry();
    return true;
  }
  withdrawPreviewInspectorRestCollectionFill(
    fill,
    (fill.lastDetail?.targetState?.stage === 'target-output'
      ? 'Rows added Inspector blockers'
      : 'Rows left the target without verified output'),
  );
  return true;
}

/** Withdraws rows when the page reports a fatal error it had not reported before the fill. */
function withdrawPreviewInspectorRestCollectionFillAfterError(fatalErrorFingerprint) {
  const fill = previewInspectorSession.restCollectionFill;
  if (
    fill?.status !== 'applied' ||
    fill.revision !== previewEntryRevision ||
    fill.knownFatalErrors?.has?.(fatalErrorFingerprint) === true
  ) return false;
  // The rows stop at once; the decision and remount run after the error handler returns.
  fill.status = 'rolled-back';
  const finish = () =>
    withdrawPreviewInspectorRestCollectionFill(fill, 'Rows raised a new fatal error', true);
  if (typeof queueMicrotask === 'function') queueMicrotask(finish);
  else finish();
  return true;
}

/**
 * Serves the admitted requests empty again for the rest of this revision and remounts once. A
 * withdrawal after an error also bars the corridor (or, for a late round, only later rounds) for
 * the rest of the session, so hot revisions do not refill and crash the same page again.
 */
function withdrawPreviewInspectorRestCollectionFill(fill, reason, afterError = false) {
  fill.status = 'rolled-back';
  fill.lastDetail = undefined;
  for (const requestId of fill.payloads?.keys?.() ?? []) {
    clearPreviewInspectorRestCollectionFillResource(requestId);
  }
  if (afterError) {
    // A crash in a late round bars only later rounds; the first round's lists stay eligible.
    rememberPreviewInspectorRestCollectionFillFailure(
      fill.reachabilityKey,
      (fill.round ?? 1) > 1 ? 'restCollectionFillLateFailedKeys' : 'restCollectionFillFailedKeys',
    );
  }
  recordPreviewInspectorRestCollectionFillDecision(
    'Withdraw REST collection rows',
    [
      ...[...fill.requestIds].map((id) => ({
        id,
        label: previewInspectorSession.dataRequests?.get?.(id)?.label ?? id,
        paths: [],
      })),
      ...[...fill.hookValues?.keys?.() ?? []].map((id) => ({
        id,
        label: previewInspectorSession.runtimeFallbacks?.get?.(id)?.hookName ?? id,
        paths: [],
      })),
    ],
    reason,
  );
  commitPreviewInspectorDataChange();
  notifyPreviewInspectorCollectionFillHookConsumers(fill);
}

/** Drops the virtual backend's cached resource so the next refetch serves the selected payload. */
function clearPreviewInspectorRestCollectionFillResource(requestId) {
  if (typeof clearPreviewInspectorVirtualBackendResource === 'function') {
    clearPreviewInspectorVirtualBackendResource(requestId);
  }
}

/** Bars one corridor from later fills, or only from late rounds, in this session (bounded). */
function rememberPreviewInspectorRestCollectionFillFailure(reachabilityKey, sessionField) {
  if (typeof reachabilityKey !== 'string') return;
  if (!(previewInspectorSession[sessionField] instanceof Set)) {
    previewInspectorSession[sessionField] = new Set();
  }
  const failedKeys = previewInspectorSession[sessionField];
  failedKeys.add(reachabilityKey);
  while (failedKeys.size > PREVIEW_INSPECTOR_REST_COLLECTION_FILL_FAILED_KEY_LIMIT) {
    failedKeys.delete(failedKeys.values().next().value);
  }
}

/** Records the fill or its withdrawal as one render attempt the trace and headless bridge track. */
function recordPreviewInspectorRestCollectionFillDecision(action, requests, reason) {
  if (typeof recordPreviewInspectorBlockerAutoDecision !== 'function') return undefined;
  return recordPreviewInspectorBlockerAutoDecision({
    action,
    blockerId: 'rest-collection-fill',
    blockerKind: 'data-request',
    blockerName: 'REST collection rows · ' + requests.map((request) => request.label).join(', '),
    generatedPaths: requests.flatMap((request) =>
      request.paths.map((path) => request.label + '.' + (path || '<response>') + '[]'),
    ).slice(0, 32),
    mode: 'rest-collection-auto',
    reason,
    selectedValue: { requestIds: requests.map((request) => request.id) },
    startsRenderAttempt: true,
    summary: { requestCount: requests.length },
    targetReachabilityKey: previewInspectorSession.activeTargetReachabilityKey,
  });
}

/** Starts or verifies the fill from each committed page composition snapshot. */
function observePreviewInspectorRestCollectionFill(detail) {
  try {
    previewInspectorSession.restCollectionFillLatestDetail = detail;
    const fill = previewInspectorSession.restCollectionFill;
    if (
      fill?.status === 'applied' &&
      fill.revision === previewEntryRevision &&
      fill.reachabilityKey === previewInspectorSession.activeTargetReachabilityKey
    ) {
      return verifyPreviewInspectorRestCollectionFill(fill, detail);
    }
    return startPreviewInspectorRestCollectionFill(detail);
  } catch {
    return false;
  }
}
${hookCollectionFillRuntimeSource}
`;
}
