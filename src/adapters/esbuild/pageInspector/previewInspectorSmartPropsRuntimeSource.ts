/**
 * Generates the Page Inspector's descriptor-aware Smart props runtime.
 *
 * Target renders can fail before React commits the effect that records their live props. In that
 * case the ordinary props editor sees an empty object even though the compiler already proved a
 * local props type, receiver path, parent JSX literal, or missing property from the thrown error.
 * This adapter joins those independent evidence sources into one bounded, JSON-visible draft.
 */

/** Maximum generated/inferred prop paths described by one Inspector draft. */
export const PREVIEW_INSPECTOR_SMART_PROP_PATH_LIMIT = 64;

/** Maximum inferred shape nodes scanned while correlating a short runtime error path. */
export const PREVIEW_INSPECTOR_SMART_PROP_SCAN_LIMIT = 256;

/**
 * Creates browser helpers that discover and apply the minimum descriptor-backed prop record.
 *
 * Expected lexical bindings include the automatic-prop materializer, blocker-value helpers,
 * descriptor/candidate readers, Inspector session, and prop override/remount functions. The
 * generated code reads only extension-authored descriptor data and never evaluates project types.
 *
 * @returns Plain JavaScript source concatenated into the isolated Page Inspector runtime.
 */
export function createPreviewInspectorSmartPropsRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_SMART_PROP_PATH_LIMIT = ${PREVIEW_INSPECTOR_SMART_PROP_PATH_LIMIT};
const PREVIEW_INSPECTOR_SMART_PROP_SCAN_LIMIT = ${PREVIEW_INSPECTOR_SMART_PROP_SCAN_LIMIT};
const previewInspectorSmartPropBlockedNames = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/** Adds bounded, normalized inference provenance without retaining descriptor object identity. */
function appendPreviewInspectorSmartPropProvenance(target, records) {
  for (const record of Array.isArray(records) ? records : []) {
    const path = typeof record?.path === 'string' ? record.path.trim().slice(0, 240) : '';
    if (path.length === 0 || target.some((item) => item.path === path)) continue;
    target.push({
      kind: typeof record?.kind === 'string' ? record.kind : 'unknown',
      path,
      source: record?.source === 'type' ? 'type' : 'usage',
    });
    if (target.length >= PREVIEW_INSPECTOR_SMART_PROP_PATH_LIMIT) break;
  }
}

/**
 * Reads compiler evidence for one editable target/root even when its first React commit failed.
 * Candidate-specific root and target metadata wins over the legacy descriptor-level fallback.
 */
function readPreviewInspectorSmartPropEvidence(exportName) {
  const automaticLayers = [];
  const inferredProps = [];
  let inferredPropShape;
  let matched = false;
  for (const descriptor of previewInspectorSession.descriptors) {
    const inspector = descriptor?.inspector;
    const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
    const selectedRoot = candidate?.root ?? inspector?.root;
    const rootName = selectedRoot === undefined
      ? undefined
      : createPreviewInspectorRootName(selectedRoot);
    const targetName = inspector?.target?.exportName ?? descriptor?.exportName;
    if (rootName === exportName) {
      matched = true;
      automaticLayers.push(candidate?.rootAutomaticProps ?? descriptor?.automaticProps ?? {});
      inferredPropShape ??= candidate?.rootInferredPropShape ?? (
        targetName === exportName
          ? inspector?.targetInferredPropShape ?? descriptor?.inferredPropShape
          : undefined
      );
      appendPreviewInspectorSmartPropProvenance(
        inferredProps,
        candidate?.rootInferredProps ?? (
          targetName === exportName
            ? inspector?.targetInferredProps ?? descriptor?.inferredProps
            : []
        ),
      );
    }
    if (targetName === exportName || descriptor?.exportName === exportName) {
      matched = true;
      automaticLayers.push(
        candidate?.targetAutomaticProps ??
        inspector?.targetAutomaticProps ??
        descriptor?.automaticProps ??
        {},
      );
      inferredPropShape =
        inspector?.targetInferredPropShape ?? descriptor?.inferredPropShape ?? inferredPropShape;
      appendPreviewInspectorSmartPropProvenance(
        inferredProps,
        inspector?.targetInferredProps ?? descriptor?.inferredProps,
      );
    }
  }
  return {
    automaticProps: createPreviewPropsFromLayers(undefined, ...automaticLayers),
    found: matched,
    inferredPropShape,
    inferredProps,
  };
}

/** Reports whether descriptor evidence makes an export safely editable before its first commit. */
function hasPreviewInspectorSmartPropEvidence(exportName) {
  return readPreviewInspectorSmartPropEvidence(exportName).found;
}

/**
 * Flattens the descriptor's full inferred shape so a UI provenance display limit cannot hide the
 * exact field needed for recovery. Shape nodes are extension-authored data and are still read via
 * own descriptors under strict depth/node budgets to avoid invoking a mutated project getter.
 */
function readPreviewInspectorSmartPropPathRecords(evidence) {
  const records = [];
  const append = (record) => {
    const path = typeof record?.path === 'string' ? record.path : '';
    if (
      path.length === 0 || records.some((candidate) => candidate.path === path) ||
      records.length >= PREVIEW_INSPECTOR_SMART_PROP_SCAN_LIMIT
    ) return;
    records.push({
      kind: typeof record?.kind === 'string' ? record.kind : 'unknown',
      path,
      source: record?.source === 'type' ? 'type' : 'usage',
    });
  };
  for (const record of evidence.inferredProps) append(record);
  const visit = (node, path, depth) => {
    if (
      node === null || typeof node !== 'object' || depth > 12 ||
      records.length >= PREVIEW_INSPECTOR_SMART_PROP_SCAN_LIMIT
    ) return;
    if (path.length > 0) append({ kind: node.kind, path: path.join('.'), source: 'usage' });
    if (node.kind !== 'object' || node.properties === null || typeof node.properties !== 'object') {
      return;
    }
    let descriptors;
    try { descriptors = Object.getOwnPropertyDescriptors(node.properties); } catch { return; }
    for (const propertyName of Object.keys(descriptors).sort()) {
      if (
        previewInspectorSmartPropBlockedNames.has(propertyName) ||
        !Object.hasOwn(descriptors[propertyName], 'value')
      ) continue;
      visit(descriptors[propertyName].value, [...path, propertyName], depth + 1);
    }
  };
  visit(evidence.inferredPropShape, [], 0);
  return records;
}

/** Removes JavaScript receiver labels that are not part of a component's external prop contract. */
function readPreviewInspectorSmartPropRuntimePathCandidates(normalizedPath) {
  const candidates = [normalizedPath];
  for (const prefix of ['this.props.', 'props.']) {
    if (normalizedPath.startsWith(prefix)) candidates.push(normalizedPath.slice(prefix.length));
  }
  return [...new Set(candidates.filter((path) => path.length > 0))];
}

/**
 * Returns the deepest statically observed leaves below one runtime-reported container path.
 * A browser error often exposes only the last successful read, for example "field.value", while
 * the compiler already knows that rendering subsequently needs "field.value.addressInput.id".
 * Expanding only to proven leaves recreates the minimum useful container without inventing peers.
 */
function readPreviewInspectorSmartPropLeafPaths(inferredPaths, matchedPath) {
  const descendants = inferredPaths.filter((path) => path.startsWith(matchedPath + '.'));
  if (descendants.length === 0) return [matchedPath];
  return descendants.filter((candidate) => !descendants.some(
    (other) => other !== candidate && other.startsWith(candidate + '.'),
  ));
}

/**
 * Expands a short runtime field such as "value" to a statically proven path like "field.value".
 * When that match is a container, its deepest proven descendants are retained so a nullish
 * observed value cannot erase the shape needed by the next render. Ambiguous suffix matches are
 * all retained; uncorrelated runtime fields remain top-level rather than being guessed deeper.
 */
function resolvePreviewInspectorSmartPropRequiredPaths(exportName, requiredPaths) {
  const evidence = readPreviewInspectorSmartPropEvidence(exportName);
  const inferredRecords = readPreviewInspectorSmartPropPathRecords(evidence);
  const inferredPaths = inferredRecords.map((record) => record.path);
  const resolved = [];
  const append = (path) => {
    if (
      typeof path === 'string' && path.length > 0 && !resolved.includes(path) &&
      resolved.length < PREVIEW_INSPECTOR_SMART_PROP_PATH_LIMIT
    ) {
      resolved.push(path);
    }
  };
  for (const rawPath of normalizePreviewInspectorRequiredPropertyPaths(requiredPaths)) {
    const parsed = parsePreviewInspectorRequiredPath(rawPath);
    if (parsed === undefined) continue;
    const normalizedPath = parsed.path.join('.');
    const runtimeCandidates = readPreviewInspectorSmartPropRuntimePathCandidates(normalizedPath);
    let matchedRecords = inferredRecords.filter((record) => runtimeCandidates.some(
      (candidate) => record.path === candidate || record.path.endsWith('.' + candidate),
    ));
    if (matchedRecords.length === 0) {
      const reverseMatches = inferredRecords.filter((record) => runtimeCandidates.some(
        (candidate) => candidate.endsWith('.' + record.path),
      ));
      const deepestLength = Math.max(0, ...reverseMatches.map((record) => record.path.length));
      matchedRecords = reverseMatches.filter((record) => record.path.length === deepestLength);
    }
    if (matchedRecords.length === 0) {
      const receiverKinds = new Set(['array', 'boolean', 'function', 'number', 'string']);
      const receiverMatches = inferredRecords.filter(
        (record) => receiverKinds.has(record.kind) && runtimeCandidates.some(
          (candidate) => candidate.startsWith(record.path + '.'),
        ),
      );
      const deepestLength = Math.max(0, ...receiverMatches.map((record) => record.path.length));
      matchedRecords = receiverMatches.filter((record) => record.path.length === deepestLength);
      for (const record of matchedRecords) append(record.path);
      if (matchedRecords.length > 0) continue;
    }
    if (matchedRecords.length === 0) {
      append(rawPath);
      continue;
    }
    for (const { path } of matchedRecords) {
      const demandedPaths = parsed.callable
        ? [path + '()']
        : readPreviewInspectorSmartPropLeafPaths(inferredPaths, path);
      for (const demandedPath of demandedPaths) append(demandedPath);
    }
  }
  return resolved;
}

/**
 * Builds a generated overlay from proven paths while reading scalar kinds from inferred props.
 * The overlay is intentionally independent of observed props: a runtime null may describe a
 * missing backend value, but it must not erase compiler evidence that the value is dereferenced.
 */
function createPreviewInspectorSmartPropRequirementValue(inferredValue, requiredPaths) {
  let requirement = {};
  for (const path of normalizePreviewInspectorRequiredPropertyPaths(requiredPaths)) {
    if (path === '<root>') continue;
    requirement = materializePreviewInspectorRequiredPath(requirement, path, inferredValue);
  }
  return materializePreviewInspectorRuntimeFallbackOverride(requirement);
}

/**
 * Builds one JSON-safe Smart draft in ascending evidence priority.
 *
 * Inferred neutral values form the base, parent JSX and last observed React props overlay them,
 * user JSON remains authoritative, and error-proven missing paths are added last only where absent.
 * Function leaves become an explicit sentinel so the editor never collapses a useful draft to {}.
 */
function createPreviewInspectorSmartPropsDraft(exportName, requiredPaths = []) {
  const evidence = readPreviewInspectorSmartPropEvidence(exportName);
  const observedProps = previewInspectorSession.basePropsByExport.get(exportName) ?? {};
  const overrideProps = previewInspectorSession.overridesByExport.get(exportName) ?? {};
  const materializedOverride = materializePreviewInspectorRuntimeFallbackOverride(overrideProps);
  const inferredValue = createPreviewPropsFromLayers(
    evidence.inferredPropShape,
    evidence.automaticProps,
  );
  const baseValue = createPreviewPropsFromLayers(
    evidence.inferredPropShape,
    evidence.automaticProps,
    observedProps,
    materializedOverride,
  );
  const resolvedRequiredPaths = resolvePreviewInspectorSmartPropRequiredPaths(
    exportName,
    requiredPaths,
  );
  const requirementValue = createPreviewInspectorSmartPropRequirementValue(
    inferredValue,
    resolvedRequiredPaths,
  );
  const completion = completePreviewInspectorGeneratedValue(baseValue, requirementValue, {
    /* A path extracted from the actual failure proves that an authored null cannot stay neutral. */
    replaceNullScalars: true,
  });
  const generatedCompletion = completePreviewInspectorGeneratedValue(
    inferredValue,
    requirementValue,
    { replaceNullScalars: true },
  );
  const completedValue = completion.changed ? completion.value : baseValue;
  const copiedValue = copyPreviewInspectorBlockerValueForJson(completedValue, { nodes: 0 });
  const value = copiedValue !== null && typeof copiedValue === 'object' && !Array.isArray(copiedValue)
    ? copiedValue
    : {};
  const copiedGeneratedValue = copyPreviewInspectorBlockerValueForJson(
    generatedCompletion.changed ? generatedCompletion.value : inferredValue,
    { nodes: 0 },
  );
  const generatedValue = copiedGeneratedValue !== null &&
    typeof copiedGeneratedValue === 'object' &&
    !Array.isArray(copiedGeneratedValue)
      ? copiedGeneratedValue
      : {};
  const generatedPaths = [];
  for (const path of [
    ...evidence.inferredProps.map((record) => record.path),
    ...resolvedRequiredPaths,
  ]) {
    if (!generatedPaths.includes(path) && generatedPaths.length < PREVIEW_INSPECTOR_SMART_PROP_PATH_LIMIT) {
      generatedPaths.push(path);
    }
  }
  return {
    evidenceFound: evidence.found,
    generatedValue,
    generatedPaths,
    requiredPaths: resolvedRequiredPaths,
    value,
  };
}

/** Reports whether a Smart draft can improve an empty or incomplete editable prop record. */
function hasPreviewInspectorSmartPropsDraft(draft) {
  return draft?.value !== null && typeof draft?.value === 'object' &&
    (Object.keys(draft.value).length > 0 || draft.generatedPaths?.length > 0);
}

/** Applies the generated JSON record and enables fallback values before remounting the export. */
function applyPreviewInspectorSmartProps(exportName, requiredPaths = []) {
  const draft = createPreviewInspectorSmartPropsDraft(exportName, requiredPaths);
  setPreviewInspectorFallbackValuesEnabled(true);
  setPreviewInspectorPropsOverride(exportName, draft.value);
  return draft;
}
`;
}
