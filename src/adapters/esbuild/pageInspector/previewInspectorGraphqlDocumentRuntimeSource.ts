/**
 * Generates the Page Inspector boundary for statically recoverable GraphQL fragment interpolation.
 * Compiler wrappers preserve real DocumentNodes and call this resolver only at module evaluation;
 * nullish circular imports receive the exact authored fragment source instead of corrupting `gql`.
 */

/** Maximum distinct circular GraphQL interpolation repairs retained by one pinned session. */
export const PREVIEW_INSPECTOR_GRAPHQL_REPAIR_LIMIT = 128;

/**
 * Creates browser source for GraphQL document recovery, chronological Auto logging, and health data.
 * Expected lexical bindings include the Inspector session, fallback policy, console recorder,
 * blocker trace recorder, runtime health recorder, and tree refresh scheduler.
 */
export function createPreviewInspectorGraphqlDocumentRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_GRAPHQL_REPAIR_LIMIT = ${PREVIEW_INSPECTOR_GRAPHQL_REPAIR_LIMIT};
const PREVIEW_INSPECTOR_GRAPHQL_REPAIR_TEXT_LIMIT = 4_000;
const PREVIEW_INSPECTOR_GRAPHQL_SOURCE_LIMIT = 64 * 1024;

/** Lazily allocates repair records only when a reached query actually observes a missing fragment. */
function initializePreviewInspectorGraphqlDocumentState() {
  if (!(previewInspectorSession.graphqlDocumentRepairs instanceof Map)) {
    previewInspectorSession.graphqlDocumentRepairs = new Map();
  }
}

/** Bounds compiler-owned source coordinates and semantic fragment names. */
function normalizePreviewInspectorGraphqlInterpolationMetadata(metadata) {
  const source = metadata !== null && typeof metadata === 'object' ? metadata : {};
  const text = (name, limit = PREVIEW_INSPECTOR_GRAPHQL_REPAIR_TEXT_LIMIT) =>
    typeof source[name] === 'string' ? source[name].slice(0, limit) : '';
  const fragmentNames = Array.isArray(source.fragmentNames)
    ? source.fragmentNames
        .filter((name) => typeof name === 'string' && /^[_A-Za-z][_0-9A-Za-z]*$/u.test(name))
        .slice(0, 32)
    : [];
  return {
    bindingName: text('bindingName', 512),
    column: Number.isSafeInteger(source.column) && source.column > 0 ? source.column : undefined,
    fragmentNames,
    fragmentSourcePath: text('fragmentSourcePath', 16_384),
    id: text('id', 160),
    line: Number.isSafeInteger(source.line) && source.line > 0 ? source.line : undefined,
    sourcePath: text('sourcePath', 16_384),
  };
}

/** Admits only bounded fragment definitions statically copied from trusted workspace source. */
function isPreviewInspectorGraphqlFallbackSource(source, metadata) {
  if (
    typeof source !== 'string' ||
    source.length === 0 ||
    source.length > PREVIEW_INSPECTOR_GRAPHQL_SOURCE_LIMIT ||
    metadata.fragmentNames.length === 0
  ) return false;
  return metadata.fragmentNames.every((name) =>
    source.includes('fragment ' + name + ' on '),
  );
}

/** Returns a stable, small description without retaining a project DocumentNode. */
function describePreviewInspectorGraphqlInterpolationValue(value) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  try {
    if (typeof value === 'object' && value?.kind === 'Document') return 'GraphQL DocumentNode';
  } catch {
    return 'uninspectable value';
  }
  return typeof value;
}

/** Records one exact static fragment substitution and makes it the active causal Auto decision. */
function recordPreviewInspectorGraphqlDocumentRepair(metadata, fallbackSource, reason, error) {
  initializePreviewInspectorGraphqlDocumentState();
  if (
    metadata.id.length === 0 ||
    (!previewInspectorSession.graphqlDocumentRepairs.has(metadata.id) &&
      previewInspectorSession.graphqlDocumentRepairs.size >=
        PREVIEW_INSPECTOR_GRAPHQL_REPAIR_LIMIT)
  ) return;
  let errorHeadline = '';
  if (error !== undefined) {
    try { errorHeadline = createRuntimeErrorHeadline(error); } catch { errorHeadline = String(error); }
  }
  const previous = previewInspectorSession.graphqlDocumentRepairs.get(metadata.id);
  const next = {
    ...metadata,
    count: (previous?.count ?? 0) + 1,
    error: errorHeadline,
    reason,
  };
  previewInspectorSession.graphqlDocumentRepairs.set(metadata.id, next);
  if (previous !== undefined && previous.reason === reason && previous.error === errorHeadline) return;

  if (typeof recordPreviewInspectorBlockerAutoDecision === 'function') {
    recordPreviewInspectorBlockerAutoDecision({
      action: 'Use statically resolved GraphQL fragment source',
      blockerId: metadata.id,
      blockerKind: 'graphql-document',
      blockerName: 'Circular GraphQL fragment · ' +
        (metadata.fragmentNames.join(', ') || metadata.bindingName || 'unknown fragment'),
      column: metadata.column,
      generatedPaths: metadata.fragmentNames.map((name) => 'fragment.' + name),
      line: metadata.line,
      mode: 'auto',
      reason: errorHeadline || reason,
      selectedValue: {
        fragmentNames: metadata.fragmentNames,
        fragmentSourcePath: metadata.fragmentSourcePath,
        sourceCharacters: fallbackSource.length,
      },
      sourcePath: metadata.sourcePath,
      summary: {
        bindingName: metadata.bindingName,
        fragmentSourcePath: metadata.fragmentSourcePath,
        initializationState: reason,
      },
    });
  }
  if (typeof recordPreviewInspectorRuntimeHealth === 'function') {
    recordPreviewInspectorRuntimeHealth({
      category: 'module-initialization',
      detail: {
        bindingName: metadata.bindingName,
        evidence: {
          column: metadata.column,
          line: metadata.line,
          sourcePath: metadata.sourcePath,
        },
        fragmentNames: metadata.fragmentNames,
        fragmentSourcePath: metadata.fragmentSourcePath,
        reason,
      },
      event: 'graphql-interpolation-repaired',
    });
  }
  const message = '[Render-only GraphQL repair] ' +
    (metadata.bindingName || metadata.fragmentNames.join(', ')) +
    ' was ' + reason + '; using its statically resolved fragment source.';
  const details = [
    message,
    errorHeadline.length > 0 ? 'Original: ' + errorHeadline : '',
    'Query: ' + metadata.sourcePath +
      (metadata.line ? ':' + String(metadata.line) + ':' + String(metadata.column ?? 1) : ''),
    'Fragment source: ' + metadata.fragmentSourcePath,
    'Fragments: ' + metadata.fragmentNames.join(', '),
  ].filter(Boolean).join('\n');
  recordPreviewInspectorConsoleEntry({
    details,
    error,
    level: 'warn',
    location: metadata.sourcePath + (metadata.line ? ':' + String(metadata.line) : ''),
    message,
    phase: 'load and compose GraphQL document',
    source: 'graphql-document',
  });
  readPreviewInspectorConsolePrimitives().warn('[React Preview] ' + details);
}

/**
 * Reads the authored interpolation once and substitutes static source only for a missing binding.
 * Auto values off restores the exact failure: thrown TDZ errors are rethrown and nullish values are
 * passed to the original tag implementation, allowing users to compare compatibility behavior.
 */
function resolvePreviewInspectorGraphqlInterpolation(readValue, fallbackSource, rawMetadata) {
  const metadata = normalizePreviewInspectorGraphqlInterpolationMetadata(rawMetadata);
  if (
    typeof readValue !== 'function' ||
    metadata.id.length === 0 ||
    !isPreviewInspectorGraphqlFallbackSource(fallbackSource, metadata)
  ) return readValue();
  let value;
  let failure;
  try {
    value = readValue();
  } catch (error) {
    failure = error;
  }
  if (failure === undefined && value !== null && value !== undefined) return value;
  if (!readPreviewInspectorFallbackValuesEnabled()) {
    if (failure !== undefined) throw failure;
    return value;
  }
  const reason = failure === undefined
    ? describePreviewInspectorGraphqlInterpolationValue(value)
    : 'uninitialized or throwing';
  recordPreviewInspectorGraphqlDocumentRepair(metadata, fallbackSource, reason, failure);
  return fallbackSource;
}

/** Describes recovered circular fragments in the runtime-boundary diagnostics list. */
function readPreviewInspectorGraphqlDocumentStatus() {
  initializePreviewInspectorGraphqlDocumentState();
  const count = previewInspectorSession.graphqlDocumentRepairs.size;
  return count === 0
    ? 'available: no reached GraphQL interpolation required static recovery'
    : 'active: ' + String(count) +
        ' circular or uninitialized GraphQL fragment interpolation(s) use authored static source';
}
`;
}
