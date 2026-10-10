/**
 * Generates the GraphQL hook part of the verified post-reach collection fill.
 *
 * A wrapped `useQuery` whose data arrives later (or whose transport response lacks a selected
 * field) renders the hook-level GraphQL value, which holds the one-row Smart minimum in every list.
 * When the page maps that list itself, compiler render demand lets the rendered-collection
 * strategy choose the row count; when it passes the list to a child component as props, no demand
 * exists and the page stays at one row. Within the same fill round as REST collections, this
 * runtime serves such a value with sample rows in its outer object collections: only for
 * Auto-generated values without render demand whose hook record shows the page rendered that part
 * of the value, beside the cached value (never inside it, so neural checkpoints and the Fallbacks
 * pane keep the original), and only while the round is live or kept. Overrides, Smart values, and
 * data-flow recommendations are never touched.
 */

/** Creates browser source composed into the REST collection fill runtime. */
export function createPreviewInspectorHookCollectionFillRuntimeSource(): string {
  return String.raw`
/** Hook outcomes that hand the generated value (or a part of it) to the page. */
const PREVIEW_INSPECTOR_HOOK_COLLECTION_FILL_REASONS = new Set(['nullish', 'partial', 'threw']);

/**
 * Reads the parts of a generated hook value its last record proves the page received. A whole
 * list item (data.items.0) was added to a shorter authored list, so that list shows generated rows;
 * a field inside an item (data.items.0.name) only completed a row the page already owns.
 */
function readPreviewInspectorHookCollectionVisiblePaths(record) {
  if (record.reason !== 'partial') return [''];
  return (Array.isArray(record.generatedPaths) ? record.generatedPaths : []).flatMap((path) => {
    if (path === '<root>') return [''];
    if (typeof path !== 'string') return [];
    const normalized = path.replace(/(?:\[\]|\.map\(\))$/u, '');
    if (/[[\]()<>]/u.test(normalized)) return [];
    const item = /^(.+)\.(?:0|[1-9][0-9]*)$/u.exec(normalized);
    return [item === null ? normalized : item[1]];
  });
}

/**
 * Selects generated GraphQL hook values of this corridor whose outer object collections hold
 * fewer rows than the sample count in a part the page received, skipping hooks known to an
 * earlier round. Each selection carries the cached value and its expanded copy.
 */
function selectPreviewInspectorHookCollectionFills(knownHookIds) {
  const selected = [];
  if (typeof readPreviewInspectorHookGraphqlRowEvidence !== 'function') return selected;
  const session = previewInspectorSession;
  const sampleCount = readPreviewGeneratedListSampleCount();
  for (const record of session.runtimeFallbacks?.values?.() ?? []) {
    if (selected.length >= PREVIEW_INSPECTOR_REST_COLLECTION_FILL_REQUEST_LIMIT) break;
    const id = record?.id;
    if (
      typeof id !== 'string' ||
      knownHookIds?.has?.(id) === true ||
      record.reachabilityKey !== session.activeTargetReachabilityKey ||
      record.mode !== 'auto' ||
      !PREVIEW_INSPECTOR_HOOK_COLLECTION_FILL_REASONS.has(record.reason) ||
      session.runtimeFallbackOverrides?.has?.(id) === true ||
      session.runtimeFallbackSmartIds?.has?.(id) === true ||
      session.runtimeFallbackDataFlowRecommendations?.has?.(id) === true
    ) continue;
    const base = session.runtimeFallbackValues?.get?.(id);
    const evidence = readPreviewInspectorHookGraphqlRowEvidence(base);
    if (evidence === undefined) continue;
    const visiblePaths = readPreviewInspectorHookCollectionVisiblePaths(record);
    const paths = readPreviewInspectorStructuredCollectionPaths(evidence.shape)
      .map((path) => (path.length > 0 ? 'data.' + path : 'data'))
      .filter((path) => {
        const rows = readPreviewInspectorRestCollectionValue(base, path);
        return Array.isArray(rows) && rows.length > 0 && rows.length < sampleCount &&
          visiblePaths.some((visible) =>
            visible === '' || path === visible || path.startsWith(visible + '.'));
      });
    if (paths.length === 0) continue;
    const value = expandPreviewInspectorHookCollectionRows(base, evidence, paths, sampleCount);
    if (value === undefined) continue;
    selected.push({
      base,
      id,
      label: String(record.hookName ?? 'hook') + ' · ' + (evidence.operationName || 'GraphQL'),
      paths,
      value,
    });
  }
  return selected;
}

/**
 * Appends generated rows after the generated rows of each list, copying only along the list
 * path so callbacks and sibling fields keep their identity. Returns undefined when a new row would
 * repeat an identity value (React keys), on a row or on one of its direct objects (edge nodes).
 */
function expandPreviewInspectorHookCollectionRows(base, evidence, paths, sampleCount) {
  let expanded = base;
  for (const path of paths) {
    const shapePath = path === 'data' ? '' : path.slice('data.'.length);
    const arrayShape = readPreviewInspectorRestCollectionShape(evidence.shape, shapePath);
    const rows = readPreviewInspectorRestCollectionValue(expanded, path);
    if (arrayShape === undefined || !Array.isArray(rows)) return undefined;
    const generated = generatePreviewInspectorDataValue(
      arrayShape,
      shapePath.split('.').at(-1) ?? '',
      'corridor-rows',
    );
    if (!Array.isArray(generated)) return undefined;
    const added = generated.slice(rows.length, sampleCount).map((row) =>
      evidence.typed === true && typeof applyPreviewTypedGraphqlSeed === 'function'
        ? applyPreviewTypedGraphqlSeed(row, arrayShape.items, 1)
        : row);
    const nextRows = [...rows, ...added];
    if (hasPreviewInspectorHookCollectionIdentityCollision(nextRows)) return undefined;
    expanded = replacePreviewInspectorHookCollectionValue(
      expanded,
      path.split('.'),
      Object.isFrozen(rows) ? Object.freeze(nextRows) : nextRows,
    );
    if (expanded === undefined) return undefined;
  }
  if (typeof markPreviewInspectorGeneratedValue === 'function') {
    markPreviewInspectorGeneratedValue(expanded);
  }
  return expanded;
}

/** Copies plain objects along one path without invoking getters; undefined when the path breaks. */
function replacePreviewInspectorHookCollectionValue(value, segments, replacement) {
  if (segments.length === 0) return replacement;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const [segment, ...rest] = segments;
  if (blockedInspectorPropNames.has(segment)) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const descriptor = descriptors[segment];
  if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return undefined;
  const child = replacePreviewInspectorHookCollectionValue(descriptor.value, rest, replacement);
  if (child === undefined) return undefined;
  descriptors[segment] = { ...descriptor, value: child };
  const copy = Object.defineProperties({}, descriptors);
  return Object.isFrozen(value) ? Object.freeze(copy) : copy;
}

/** Reports a repeated identity value among rows or among their direct object children. */
function hasPreviewInspectorHookCollectionIdentityCollision(rows) {
  const valuesByField = new Map();
  const collect = (owner, prefix) => {
    if (owner === null || typeof owner !== 'object' || Array.isArray(owner)) return;
    for (const field of ['id', 'key', 'uuid', '_id', 'slug', 'code']) {
      const value = Object.hasOwn(owner, field) ? owner[field] : undefined;
      if (typeof value !== 'string' && typeof value !== 'number') continue;
      const values = valuesByField.get(prefix + field) ?? [];
      values.push(value);
      valuesByField.set(prefix + field, values);
    }
  };
  for (const row of rows) {
    collect(row, '');
    if (row === null || typeof row !== 'object' || Array.isArray(row)) continue;
    for (const [name, child] of Object.entries(row)) collect(child, name + '.');
  }
  return [...valuesByField.values()].some((values) => new Set(values).size !== values.length);
}

/** Returns the sample-row copy served for one cached generated hook value, or that value. */
function readPreviewInspectorCollectionFillHookValue(hookId, fallback) {
  const fill = readPreviewInspectorRestCollectionFillCorridor();
  if (fill === undefined || previewInspectorSession.runtimeFallbackSmartIds?.has?.(hookId) === true) {
    return fallback;
  }
  const entry = fill.inheritedHookValues?.get?.(hookId) ??
    (fill.status === 'applied' || fill.status === 'kept'
      ? fill.hookValues?.get?.(hookId)
      : undefined);
  // A recreated cache value (new scope or sample count) is not the value these rows extend.
  return entry !== undefined && entry.base === fallback ? entry.value : fallback;
}

/** Re-renders mounted hook consumers; a data revision alone does not re-run their hooks. */
function notifyPreviewInspectorCollectionFillHookConsumers(fill) {
  if (
    (fill.hookValues?.size ?? 0) === 0 ||
    typeof notifyPreviewInspectorRuntimeFallbackNeuralSubscribers !== 'function'
  ) return;
  notifyPreviewInspectorRuntimeFallbackNeuralSubscribers();
}
`;
}
