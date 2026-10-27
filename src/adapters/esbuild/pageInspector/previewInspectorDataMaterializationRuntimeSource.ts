/** Generates bounded data shapes and deterministic scalar and collection materialization. */
import { PREVIEW_DATE_RANGE_ENDPOINT_PATTERN } from '../previewDateRangeEndpoint';

/** Returns source concatenated at its original lexical position; declarations share the session scope. */
export function createPreviewInspectorDataMaterializationRuntimeSource(): string {
  return String.raw`/** Converts arbitrary seed values into a finite generator shape without retaining prototypes. */
function inferPreviewInspectorDataShape(value, fieldName = '', depth = 0, budget = { fields: 0 }) {
  if (depth > PREVIEW_INSPECTOR_DATA_DEPTH_LIMIT || budget.fields >= PREVIEW_INSPECTOR_DATA_FIELD_LIMIT) {
    return { kind: 'unknown' };
  }
  if (Array.isArray(value)) {
    return {
      items: value.length === 0
        ? { kind: 'unknown' }
        : inferPreviewInspectorDataShape(value[0], fieldName, depth + 1, budget),
      kind: 'array',
    };
  }
  if (value !== null && typeof value === 'object') {
    const fields = Object.create(null);
    for (const [name, child] of Object.entries(value)) {
      if (blockedInspectorPropNames.has(name) || budget.fields >= PREVIEW_INSPECTOR_DATA_FIELD_LIMIT) {
        continue;
      }
      budget.fields += 1;
      fields[name] = inferPreviewInspectorDataShape(child, name, depth + 1, budget);
    }
    return { fields, kind: 'object' };
  }
  if (typeof value === 'boolean') return { kind: 'boolean' };
  if (typeof value === 'number' || typeof value === 'bigint') return { kind: 'number' };
  if (typeof value === 'string') return { kind: 'string' };
  if (value === null) return { kind: 'unknown' };
  return { kind: inferPreviewInspectorSemanticKind(fieldName) };
}

/** Bounds compiler/bridge type descriptors before keeping them in the live request registry. */
function normalizePreviewInspectorDataShape(shape, depth = 0, budget = { fields: 0 }) {
  if (
    shape === null ||
    typeof shape !== 'object' ||
    depth > PREVIEW_INSPECTOR_DATA_DEPTH_LIMIT ||
    budget.fields >= PREVIEW_INSPECTOR_DATA_FIELD_LIMIT
  ) {
    return { kind: 'unknown' };
  }
  const kind = ['array', 'boolean', 'literal', 'null', 'number', 'object', 'string', 'unknown'].includes(shape.kind)
    ? shape.kind
    : 'unknown';
  if (kind === 'array') {
    return { items: normalizePreviewInspectorDataShape(shape.items, depth + 1, budget), kind };
  }
  if (kind === 'literal') {
    const value = shape.value;
    return typeof value === 'string' && value.length <= 160
      ? { kind, value }
      : { kind: 'unknown' };
  }
  if (kind === 'string' && shape.numeric === true) return { kind, numeric: true };
  if (kind !== 'object') return { kind };
  const fields = Object.create(null);
  const rawFields = shape.fields !== null && typeof shape.fields === 'object' ? shape.fields : {};
  for (const [name, child] of Object.entries(rawFields)) {
    if (blockedInspectorPropNames.has(name) || budget.fields >= PREVIEW_INSPECTOR_DATA_FIELD_LIMIT) {
      continue;
    }
    budget.fields += 1;
    fields[name.slice(0, 160)] = normalizePreviewInspectorDataShape(child, depth + 1, budget);
  }
  return { fields, kind };
}

/** Recognizes numeric units only at authored word boundaries, so holidays stays a collection. */
function hasPreviewInspectorNumericUnitFieldSuffix(fieldName) {
  const source = String(fieldName);
  return /(?:Age|Years?|Months?|Days?|Hours?|Minutes?|Seconds?)$/u.test(source) ||
    /(?:^|_)(?:age|years?|months?|days?|hours?|minutes?|seconds?)$/u.test(source);
}

/** Infers a scalar family from common API/GraphQL field naming conventions. */
function inferPreviewInspectorSemanticKind(fieldName) {
  const name = String(fieldName).replaceAll('_', '').toLowerCase();
  if (
    /^(is|has|can|should|allow|enable|disable|visible|active|selected|checked)/u.test(name) ||
    /^(called|completed|finished|succeeded)$/u.test(name)
  ) {
    return 'boolean';
  }
  const paginationNumber = /^(page|currentpage|nextpage|previouspage|totalpages|pageindex|pagenumber)$/u.test(name);
  const sumNumber = name === 'sum' || /Sum$/u.test(String(fieldName)) || /_sum$/iu.test(String(fieldName));
  if (
    paginationNumber ||
    sumNumber ||
    hasPreviewInspectorNumericUnitFieldSuffix(fieldName) ||
    /(count|total|length|size|index|limit|offset|amount|price|cost|fee|rate|ratio|percent|salary|wage|num|den|numerator|denominator|quantity|shares)$/u.test(name)
  ) {
    return 'number';
  }
  return 'string';
}

/**
 * Recognizes an empty object descriptor that is more likely a lost scalar leaf than an authored
 * record. This deliberately accepts only strong display/primitive names; arbitrary empty objects
 * such as metadata and variables must remain objects for downstream property access.
 */
function inferPreviewInspectorEmptyObjectScalarKind(fieldName) {
  const name = String(fieldName).replaceAll('_', '').toLowerCase();
  const semanticKind = inferPreviewInspectorSemanticKind(fieldName);
  if (semanticKind !== 'string') return semanticKind;
  return /(caption|description|headline|label|message|name|subject|summary|text|title)$/u.test(name)
    ? 'string'
    : undefined;
}

/** Recognizes field names that conventionally represent collections without a formal schema. */
function looksLikePreviewInspectorCollection(fieldName) {
  const sourceName = String(fieldName);
  const name = sourceName.toLowerCase();
  if (
    /(status|address|business|success|access|process|progress|news|series|analysis|relations|statistics)$/u.test(
      name,
    )
  ) {
    return false;
  }
  if (hasPreviewInspectorNumericUnitFieldSuffix(sourceName)) return false;
  if (
    /(?:items|nodes|edges|list|collection|connections|results|entries|records)$/u.test(name) ||
    name.startsWith('all') || name.endsWith('ies') || name.endsWith('s')
  ) {
    return true;
  }
  const words = sourceName
    .replace(/([a-z\d])([A-Z])/gu, '$1 $2')
    .split(/[^A-Za-z\d]+/u)
    .map((word) => word.toLowerCase())
    .filter(Boolean);
  const terminalSingularContainers = new Set([
    'connection', 'context', 'detail', 'entity', 'info', 'item', 'node', 'page', 'record',
    'request', 'response', 'result', 'state', 'summary',
  ]);
  if (terminalSingularContainers.has(words.at(-1) ?? '')) return false;
  const relationWords = new Set(['by', 'for', 'from', 'of', 'to', 'under', 'with']);
  const nonCollectionPlurals = new Set([
    'access', 'address', 'analysis', 'business', 'news', 'process', 'progress', 'relations', 'series',
    'days', 'hours', 'minutes', 'months', 'seconds', 'statistics', 'status', 'years',
  ]);
  return words.some((word, index) =>
    relationWords.has(words[index + 1] ?? '') &&
    !nonCollectionPlurals.has(word) &&
    (word.endsWith('ies') || word.endsWith('s')),
  );
}

/**
 * Produces a bounded label from the actual response key for compact Auto-generated UI text.
 * Extremely long schema keys are truncated because their purpose is provenance, not layout stress.
 */
function createPreviewInspectorCompactKeyText(fieldName) {
  return previewInspectorDataSampleLabel(fieldName, 'Value');
}

/** Produces deterministic type-correct text rather than random data that changes on every remount. */
function createPreviewInspectorStringValue(fieldName, mode, itemIndex) {
  const name = String(fieldName).replaceAll('_', '').toLowerCase();
  const suffix = String(itemIndex + 1);
  const keyText = createPreviewInspectorCompactKeyText(fieldName);
  if (name === '__typename') return 'PreviewRecord';
  if (name === 'id' || name.endsWith('id') || name === 'uuid') return 'preview-' + suffix;
  if (name.includes('email')) return 'preview' + suffix + '@example.com';
  if (name.includes('phone') || name.includes('tel')) return '010-0000-000' + itemIndex;
  if (/(date|time|timestamp|createdat|updatedat|deletedat)$/u.test(name)) {
    return createPreviewInspectorSampleDateTime(Math.min(itemIndex, 9));
  }
  if (${PREVIEW_DATE_RANGE_ENDPOINT_PATTERN}.test(String(fieldName))) return previewInspectorSampleDates.day(Math.min(itemIndex, 9));
  if (/^(avatar|image|photo|picture|thumbnail)(url|uri|href|src)$/u.test(name)) return '';
  if (/(url|uri|href|link)$/u.test(name)) return 'https://example.com/preview/' + suffix;
  if (mode === 'lorem') {
    if (/(name|owner|author|assignee)$/u.test(name)) return 'Lorem Ipsum';
    if (/(title|subject|headline)$/u.test(name)) return 'Lorem ipsum preview ' + suffix;
    if (/(description|message|content|summary|text|body)$/u.test(name)) {
      return 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';
    }
    return 'Lorem ipsum dolor sit amet.';
  }
  if (/(status|state)$/u.test(name)) return 'ACTIVE';
  if (/(type|kind|code)$/u.test(name)) return 'PREVIEW';
  return mode === 'corridor-rows-item' && itemIndex > 0 ? keyText + ' ' + suffix : keyText;
}

/** Keeps additive aggregates neutral while retaining useful positive samples for other numbers. */
function createPreviewInspectorNumberValue(fieldName, itemIndex) {
  const name = String(fieldName).replaceAll('_', '').toLowerCase();
  const isSum = name === 'sum' || /Sum$/u.test(String(fieldName)) || /_sum$/iu.test(String(fieldName));
  return isSum ? 0 : itemIndex + 1;
}

/** Materializes one payload from an already-normalized shape without repeating tree validation. */
function materializePreviewInspectorDataValue(shape, fieldName, mode, itemIndex, depth) {
  if (depth > PREVIEW_INSPECTOR_DATA_DEPTH_LIMIT) return null;
  if (shape.kind === 'literal') return rebasePreviewInspectorSampleDate(shape.value);
  if (shape.kind === 'array') {
    // An unknown item has no proven fields, so expose only neutral objects. Corridor Auto remains
    // empty to avoid activating unrelated siblings during the initial page pass; once a request is
    // deliberately selected by Smart/Lorem, a bounded item lets map/render traversal discover the
    // next concrete requirement without inventing truthy flags, enum values, or backend identity.
    // Verified post-reach rows ("corridor-rows") fill only outer typed lists; rows stay corridor.
    const itemMode = mode === 'corridor-rows' ? 'corridor-rows-item' : mode;
    if (shape.items?.kind === 'unknown') {
      return createPreviewInspectorDataItemIndexes(itemMode).map(() => ({}));
    }
    // Initial authored-page traversal keeps lists empty so unrelated dashboard siblings cannot
    // execute enum switches before target reachability is known. The incremental Smart frontier
    // adds one typed item for a selected request; ordinary gallery Auto and Lorem retain samples.
    return createPreviewInspectorDataItemIndexes(mode).map((index) =>
      materializePreviewInspectorDataValue(shape.items, fieldName, itemMode, index, depth + 1),
    );
  }
  if (shape.kind === 'object') {
    const fields = shape.fields !== null && typeof shape.fields === 'object' ? shape.fields : {};
    if (Object.keys(fields).length === 0) {
      const scalarKind = inferPreviewInspectorEmptyObjectScalarKind(fieldName);
      if (scalarKind === 'boolean') return createPreviewInspectorBooleanValue(fieldName);
      if (scalarKind === 'number') return createPreviewInspectorNumberValue(fieldName, itemIndex);
      if (scalarKind === 'string') return createPreviewInspectorStringValue(fieldName, mode, itemIndex);
    }
    return createPreviewInspectorObjectValue(shape.fields, fieldName, mode, itemIndex, depth);
  }
  if (shape.kind === 'boolean') return createPreviewInspectorBooleanValue(fieldName);
  if (shape.kind === 'number') return createPreviewInspectorNumberValue(fieldName, itemIndex);
  if (shape.kind === 'string' && shape.numeric === true) {
    return String(createPreviewInspectorNumberValue(fieldName, itemIndex));
  }
  if (shape.kind === 'null') return null;
  if (shape.kind === 'unknown') {
    if (looksLikePreviewInspectorCollection(fieldName)) return [];
    const scalarKind = inferPreviewInspectorSemanticKind(fieldName);
    if (scalarKind === 'boolean') return createPreviewInspectorBooleanValue(fieldName);
    if (scalarKind === 'number') return createPreviewInspectorNumberValue(fieldName, itemIndex);
  }
  return createPreviewInspectorStringValue(fieldName, mode, itemIndex);
}

/** Keeps corridor traversal empty and Smart minimal while making ordinary samples configurable. */
function createPreviewInspectorDataItemIndexes(mode) {
  if (mode === 'corridor-auto' || mode === 'corridor-rows-item') return [];
  if (mode === 'smart') return [0];
  return Array.from({ length: readPreviewGeneratedListSampleCount() }, (_, index) => index);
}

/** Validates one external shape once before deterministic payload materialization. */
function generatePreviewInspectorDataValue(shape, fieldName = '', mode = 'auto') {
  return materializePreviewInspectorDataValue(
    normalizePreviewInspectorDataShape(shape),
    fieldName,
    mode,
    0,
    0,
  );
}

/** Lets the neural residual expand only collections proven to feed a rendered GraphQL consumer. */
function resolvePreviewInspectorRenderedCollectionAutoPayload(metadata, payload, profile) {
  if (
    profile !== 'corridor-auto' ||
    metadata?.kind !== 'graphql' ||
    typeof resolvePreviewInspectorHookGraphqlRenderedCollectionData !== 'function'
  ) return undefined;
  try {
    return resolvePreviewInspectorHookGraphqlRenderedCollectionData(metadata, payload);
  } catch {
    return undefined;
  }
}

/** Stores only transparent recommendation metadata; model features remain in the causal trace. */
function summarizePreviewInspectorRenderedCollectionRecommendation(recommendation) {
  if (recommendation === undefined) return undefined;
  const neuralResidual = typeof summarizePreviewInspectorNeuralResidualDecision === 'function'
    ? summarizePreviewInspectorNeuralResidualDecision(recommendation.decision)
    : undefined;
  return Object.freeze({
    candidateId: recommendation.candidateId,
    collectionPaths: Object.freeze([...recommendation.collectionPaths]),
    neuralResidual,
    rowCount: recommendation.rowCount,
  });
}

`;
}
