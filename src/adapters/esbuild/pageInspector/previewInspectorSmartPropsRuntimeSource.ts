import { createPreviewInspectorFinitePropChoiceRuntimeSource } from './previewInspectorFinitePropChoiceRuntimeSource';

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
  const finitePropChoiceRuntimeSource = createPreviewInspectorFinitePropChoiceRuntimeSource();
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
 * Proves that one React stack name belongs to the exact selected export facade.
 *
 * Default exports are reported by React with their authored function name rather than the literal
 * string "default". The target renderer already retains that function/display name before invoking
 * it. Common HOC display names such as "Connect(AccountPage)" are tokenized, while arbitrary
 * descendant stack names are never admitted merely because they occur below the target boundary.
 */
function isPreviewInspectorSelectedTargetOwnerName(exportName, blockedComponentName) {
  if (
    typeof exportName !== 'string' || typeof blockedComponentName !== 'string' ||
    blockedComponentName.length === 0
  ) return false;
  if (blockedComponentName === exportName) return true;
  const retained = previewInspectorSession.directTargetRuntimeOwnerNamesByExport?.get(exportName);
  if (!(retained instanceof Set)) return false;
  for (const ownerName of retained) {
    if (ownerName === blockedComponentName) return true;
    const componentTokens = typeof ownerName === 'string'
      ? ownerName.match(/[$_\p{Lu}][$_\u200C\u200D\p{ID_Continue}]*/gu) ?? []
      : [];
    if (componentTokens.includes(blockedComponentName)) return true;
  }
  return false;
}

/** Removes call syntax and an explicit React props receiver for static path comparison. */
function normalizePreviewInspectorTargetPropDiagnosticPath(path) {
  if (typeof path !== 'string') return { explicitProps: false, path: '' };
  let normalized = path.replaceAll('?.', '.').replace(/\?$/u, '').replace(/\(\)$/u, '');
  let explicitProps = false;
  for (const prefix of ['this.props.', 'props.']) {
    if (!normalized.startsWith(prefix)) continue;
    normalized = normalized.slice(prefix.length);
    explicitProps = true;
    break;
  }
  return { explicitProps, path: normalized };
}

/** Reports whether a runtime path overlaps one compiler-proven selected-export prop path. */
function matchesPreviewInspectorTargetPropRecord(path, sourcePathRecords) {
  if (path.length === 0 || !path.includes('.')) return false;
  return sourcePathRecords.some((record) => {
    const recordPath = normalizePreviewInspectorTargetPropDiagnosticPath(record?.path).path;
    return recordPath.length > 0 && (
      path === recordPath || path.startsWith(recordPath + '.') || recordPath.startsWith(path + '.')
    );
  });
}

/**
 * Correlates a selected-target failure to external props without projecting hook/local receivers.
 *
 * A unique compiler correlation changes a short runtime diagnostic such as "map" into a full prop
 * path such as "items.map()" and is therefore safe. Unchanged paths are accepted only when the
 * engine named "props"/"this.props", or a multi-segment path overlaps compiler prop evidence. Bare
 * "value" and project-local paths such as "queryResult.count" stay visible without mutating props.
 */
function readPreviewInspectorTargetPropFailurePaths(exportName, blockedComponentName, error) {
  if (!isPreviewInspectorSelectedTargetOwnerName(exportName, blockedComponentName)) return [];
  const evidence = readPreviewInspectorSmartPropEvidence(exportName);
  const sourcePathRecords = readPreviewInspectorSmartPropPathRecords(evidence);
  const directPaths = readPreviewInspectorErrorPropertyPaths(error);
  const directPathSet = new Set(directPaths);
  return readPreviewInspectorErrorPropertyPaths(error, sourcePathRecords).filter((candidate) => {
    const normalized = normalizePreviewInspectorTargetPropDiagnosticPath(candidate);
    if (normalized.explicitProps) return normalized.path.length > 0;
    if (!directPathSet.has(candidate)) return true;
    return matchesPreviewInspectorTargetPropRecord(normalized.path, sourcePathRecords);
  });
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
  const resolverProps = previewInspectorSession.resolverPropsByExport?.get?.(exportName) ?? {};
  const overrideProps = previewInspectorSession.overridesByExport.get(exportName) ?? {};
  const materializedResolver = materializePreviewInspectorRuntimeFallbackOverride(resolverProps);
  const materializedOverride = materializePreviewInspectorRuntimeFallbackOverride(overrideProps);
  const inferredValue = createPreviewPropsFromLayers(
    evidence.inferredPropShape,
    evidence.automaticProps,
  );
  const baseValue = createPreviewPropsFromLayers(
    evidence.inferredPropShape,
    evidence.automaticProps,
    observedProps,
    materializedResolver,
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

/** Applies generated props and optionally participates in one surrounding render transaction. */
function applyPreviewInspectorSmartProps(exportName, requiredPaths = [], commit = true) {
  const draft = createPreviewInspectorSmartPropsDraft(exportName, requiredPaths);
  setPreviewInspectorFallbackValuesEnabled(true, commit);
  setPreviewInspectorPropsOverride(exportName, draft.value, commit);
  return draft;
}

/** Reads one own compiler-proven path without invoking project accessors. */
function readPreviewInspectorSmartPropPathValue(value, rawPath) {
  const parsed = parsePreviewInspectorRequiredPath(rawPath);
  if (parsed === undefined || parsed.path.length === 0) return undefined;
  let current = value;
  for (const propertyName of parsed.path) {
    if (
      (typeof current !== 'object' && typeof current !== 'function') || current === null ||
      previewInspectorSmartPropBlockedNames.has(propertyName)
    ) return undefined;
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(current, propertyName); } catch { return undefined; }
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return undefined;
    current = descriptor.value;
  }
  return current;
}

/** Reports whether a preview-owned record explicitly contains one safe property path. */
function hasPreviewInspectorSmartPropPath(value, rawPath) {
  const parsed = parsePreviewInspectorRequiredPath(rawPath);
  if (
    parsed === undefined || parsed.callable || parsed.collection || parsed.path.length === 0
  ) return false;
  let current = value;
  for (const propertyName of parsed.path) {
    if (
      current === null || typeof current !== 'object' || Array.isArray(current) ||
      previewInspectorSmartPropBlockedNames.has(propertyName)
    ) return false;
    let descriptor;
    try { descriptor = Object.getOwnPropertyDescriptor(current, propertyName); } catch { return false; }
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value')) return false;
    current = descriptor.value;
  }
  return true;
}

/** Copies a JSON-visible prop record and replaces exactly one prototype-safe object path. */
function setPreviewInspectorSmartPropPathValue(value, rawPath, nextValue) {
  const parsed = parsePreviewInspectorRequiredPath(rawPath);
  if (parsed === undefined || parsed.path.length === 0) return undefined;
  const copied = copyPreviewInspectorBlockerValueForJson(value, { nodes: 0 });
  const root = copied !== null && typeof copied === 'object' && !Array.isArray(copied)
    ? copied
    : {};
  let current = root;
  for (let index = 0; index < parsed.path.length; index += 1) {
    const propertyName = parsed.path[index];
    if (previewInspectorSmartPropBlockedNames.has(propertyName)) return undefined;
    if (index === parsed.path.length - 1) {
      current[propertyName] = nextValue;
      return root;
    }
    const child = current[propertyName];
    const next = child !== null && typeof child === 'object' && !Array.isArray(child)
      ? { ...child }
      : {};
    current[propertyName] = next;
    current = next;
  }
  return root;
}

${finitePropChoiceRuntimeSource}

/** Produces a deterministic, getter-free value token for prop-repair convergence. */
function fingerprintPreviewInspectorSmartPropValue(value) {
  if (typeof fingerprintPreviewInspectorRequirementValue === 'function') {
    return fingerprintPreviewInspectorRequirementValue(value, { nodes: 0, seen: new WeakSet() });
  }
  return copyPreviewInspectorBlockerValueForJson(value, { nodes: 0 });
}

/**
 * Resolves every runtime path to one compiler-proven target prop and inferred kind.
 * Automatic recovery fails closed when a short diagnostic could name multiple prop branches.
 */
function readPreviewInspectorTargetFailureRequirementRecords(exportName, requiredPaths) {
  const normalizedPaths = normalizePreviewInspectorRequiredPropertyPaths(requiredPaths)
    .filter((path) => path !== '<root>' && path !== '<root>()');
  if (normalizedPaths.length === 0) return undefined;
  const evidence = readPreviewInspectorSmartPropEvidence(exportName);
  if (!evidence.found) return undefined;
  const inferredRecords = readPreviewInspectorSmartPropPathRecords(evidence);
  const admittedKinds = new Set(['array', 'boolean', 'function', 'number', 'object', 'string']);
  for (const rawPath of normalizedPaths) {
    const parsed = parsePreviewInspectorRequiredPath(rawPath);
    if (parsed === undefined || parsed.path.length === 0) return undefined;
    const diagnosticPath = parsed.path.join('.');
    const exactMatches = inferredRecords.filter((record) =>
      record.path === diagnosticPath || record.path.endsWith('.' + diagnosticPath),
    );
    if (new Set(exactMatches.map((record) => record.path)).size !== 1) return undefined;
  }
  const resolvedPaths = resolvePreviewInspectorSmartPropRequiredPaths(exportName, normalizedPaths);
  if (resolvedPaths.length === 0) return undefined;
  const records = [];
  for (const path of resolvedPaths) {
    const parsed = parsePreviewInspectorRequiredPath(path);
    if (parsed === undefined || parsed.path.length === 0) return undefined;
    const inferredPath = parsed.path.join('.');
    const matched = inferredRecords.filter((record) => record.path === inferredPath);
    if (matched.length !== 1 || !admittedKinds.has(matched[0].kind)) return undefined;
    records.push({ kind: matched[0].kind, path });
  }
  return records.sort((left, right) => left.path.localeCompare(right.path));
}

/** Creates a stable identity for one contained selected-target failure. */
function createPreviewInspectorTargetFailureErrorIdentity(failure) {
  return JSON.stringify({
    exportName: failure?.exportName,
    headline: String(failure?.headline ?? createRuntimeErrorHeadline(failure?.error)).slice(0, 1_000),
    ownerName: failure?.blockedComponentName,
    sourcePath: normalizePreviewInspectorReachabilityPath(failure?.sourcePath),
  });
}

/** Normalizes one live or late runtime error into the strict target-repair record shape. */
function createPreviewInspectorTargetFailureRepairRecord(state, error, context = {}) {
  if (
    state === undefined || error === undefined ||
    readPreviewInspectorMissingRuntimeGlobalName(error) !== undefined
  ) return undefined;
  const componentStack = typeof context.componentStack === 'string'
    ? context.componentStack
    : typeof error?.componentStack === 'string' ? error.componentStack : '';
  const blockedComponentName = typeof context.ownerName === 'string' &&
    context.ownerName.length > 0
      ? context.ownerName
      : readPreviewInspectorBlockedComponentName(componentStack, state.targetExportName);
  const targetPropRequiredPaths = readPreviewInspectorTargetPropFailurePaths(
    state.targetExportName,
    blockedComponentName,
    error,
  );
  const headline = createRuntimeErrorHeadline(error).slice(0, 1_000);
  const failure = {
    blockedComponentName,
    componentNames: readPreviewInspectorComponentStackNames(
      componentStack,
      state.targetExportName,
    ),
    componentStack,
    error,
    exportName: state.targetExportName,
    failureKind: 'component-error',
    headline,
    id: 'target-error:' + state.targetExportName + ':automatic-repair',
    requiredPaths: readPreviewInspectorErrorPropertyPaths(error),
    sourcePath: state.targetSourcePath,
    targetPropRequiredPaths,
  };
  failure.errorIdentity = createPreviewInspectorTargetFailureErrorIdentity(failure);
  return failure;
}

/** Returns one unambiguous exact-boundary failure, including a coalesced late health error. */
function readPreviewInspectorTargetFailureRepairRecord(state) {
  const failures = [];
  const append = (failure) => {
    if (
      failure === undefined ||
      failures.some((candidate) => candidate.errorIdentity === failure.errorIdentity)
    ) return;
    failures.push(failure);
  };
  const boundaries = readPreviewInspectorTargetBoundaries(state);
  if (boundaries instanceof Set) {
    for (const boundary of boundaries) {
      append(createPreviewInspectorTargetFailureRepairRecord(
        state,
        boundary?.state?.error,
        { componentStack: boundary?.state?.componentStack },
      ));
    }
  }
  append(state?.pendingTargetRepairFailure);
  return failures.length === 1 ? failures[0] : undefined;
}

/**
 * Creates the smallest source-correlated prop mutation without changing session state.
 * Automatic mode requires exact active-target ownership, one inferred kind for every path, and a
 * semantic delta. Manual mode retains the existing broad Smart draft and explicit retry behavior.
 */
function createPreviewInspectorTargetFailurePropMutation(failure, options = {}) {
  const automatic = options.automatic === true;
  if (
    failure?.failureKind !== 'component-error' ||
    typeof failure?.exportName !== 'string' ||
    typeof failure?.blockedComponentName !== 'string'
  ) return undefined;
  const exactTargetOwner = isPreviewInspectorSelectedTargetOwnerName(
      failure.exportName,
      failure.blockedComponentName,
    );
  if (automatic && !exactTargetOwner) return undefined;
  const state = options.state;
  const stateSourcePath = normalizePreviewInspectorReachabilityPath(state?.targetSourcePath);
  const failureSourcePath = normalizePreviewInspectorReachabilityPath(failure.sourcePath);
  if (automatic && (
    state?.targetExportName !== failure.exportName ||
    stateSourcePath.length === 0 ||
    stateSourcePath !== failureSourcePath
  )) return undefined;
  const finiteChoiceMutation = createPreviewInspectorFinitePropChoiceMutation(failure, options);
  if (finiteChoiceMutation !== undefined) return finiteChoiceMutation;
  if (
    Number.isSafeInteger(options?.finiteChoiceOrdinal) &&
    readPreviewInspectorTargetFailurePropChoiceDomains(failure).length > 0
  ) return undefined;
  if (readPreviewInspectorTargetFailurePropChoices(failure).length > 0) {
    // Multiple invalid finite domains stay visible rather than letting a broad Smart draft guess
    // which independent choice caused the exhaustive-branch failure.
    return undefined;
  }
  const correlatedPaths = readPreviewInspectorTargetPropFailurePaths(
    failure.exportName,
    failure.blockedComponentName,
    failure.error,
  );
  const expectedPaths = normalizePreviewInspectorRequiredPropertyPaths(
    failure.targetPropRequiredPaths,
  );
  if (automatic && (
    correlatedPaths.length === 0 ||
    JSON.stringify([...correlatedPaths].sort()) !== JSON.stringify([...expectedPaths].sort())
  )) return undefined;
  const requirementRecords = readPreviewInspectorTargetFailureRequirementRecords(
    failure.exportName,
    automatic ? correlatedPaths : expectedPaths,
  );
  if (automatic && requirementRecords === undefined) return undefined;
  const userProps = previewInspectorSession.overridesByExport.get(failure.exportName) ?? {};
  if (automatic && requirementRecords.some((record) => {
    const topLevelName = parsePreviewInspectorRequiredPath(record.path)?.path?.[0];
    return typeof topLevelName === 'string' &&
      Object.prototype.hasOwnProperty.call(userProps, topLevelName);
  })) return undefined;
  const draft = automatic
    ? (() => {
        const evidence = readPreviewInspectorSmartPropEvidence(failure.exportName);
        const resolverProps = previewInspectorSession.resolverPropsByExport?.get?.(
          failure.exportName,
        ) ?? {};
        const inferredValue = createPreviewPropsFromLayers(
          evidence.inferredPropShape,
          evidence.automaticProps,
        );
        const baseValue = createPreviewPropsFromLayers(
          undefined,
          materializePreviewInspectorRuntimeFallbackOverride(resolverProps),
        );
        const required = requirementRecords.map((record) => record.path);
        const requirementValue = createPreviewInspectorSmartPropRequirementValue(
          inferredValue,
          required,
        );
        const completion = completePreviewInspectorGeneratedValue(baseValue, requirementValue, {
          replaceNullScalars: true,
        });
        const copiedBase = copyPreviewInspectorBlockerValueForJson(baseValue, { nodes: 0 });
        const copiedValue = copyPreviewInspectorBlockerValueForJson(
          completion.changed ? completion.value : baseValue,
          { nodes: 0 },
        );
        return {
          beforeValue: copiedBase !== null && typeof copiedBase === 'object' &&
            !Array.isArray(copiedBase) ? copiedBase : {},
          evidenceFound: evidence.found,
          generatedPaths: required,
          generatedValue: copyPreviewInspectorBlockerValueForJson(requirementValue, { nodes: 0 }),
          requiredPaths: required,
          value: copiedValue !== null && typeof copiedValue === 'object' &&
            !Array.isArray(copiedValue) ? copiedValue : {},
        };
      })()
    : createPreviewInspectorSmartPropsDraft(failure.exportName, expectedPaths);
  if (!automatic && !hasPreviewInspectorSmartPropsDraft(draft)) {
    return {
      automatic: false,
      changed: previewInspectorSession.fallbackValuesEnabled !== true,
      changedPaths: [],
      draft,
      errorIdentity: createPreviewInspectorTargetFailureErrorIdentity(failure),
      failure,
      fingerprint: 'manual-fallback:' + createPreviewInspectorTargetFailureErrorIdentity(failure),
      fallbackOnly: true,
    };
  }
  const beforeFingerprint = fingerprintPreviewInspectorSmartPropValue(
    automatic ? draft.beforeValue : previewInspectorSession.overridesByExport.get(failure.exportName) ?? {},
  );
  const afterFingerprint = fingerprintPreviewInspectorSmartPropValue(draft.value);
  const changed = JSON.stringify(beforeFingerprint) !== JSON.stringify(afterFingerprint);
  if (automatic && !changed) return undefined;
  const changedPaths = (requirementRecords ?? draft.requiredPaths.map((path) => ({
    kind: 'unknown',
    path,
  }))).filter((record) => {
    if (!automatic) return true;
    return JSON.stringify(fingerprintPreviewInspectorSmartPropValue(
      readPreviewInspectorSmartPropPathValue(draft.beforeValue, record.path),
    )) !== JSON.stringify(fingerprintPreviewInspectorSmartPropValue(
      readPreviewInspectorSmartPropPathValue(draft.value, record.path),
    ));
  }).map((record) => record.path);
  if (automatic && changedPaths.length === 0) return undefined;
  const errorIdentity = createPreviewInspectorTargetFailureErrorIdentity(failure);
  const fingerprint = JSON.stringify({
    errorIdentity,
    requirements: requirementRecords ?? [],
    resultingValues: changedPaths.map((path) => [
      path,
      fingerprintPreviewInspectorSmartPropValue(
        readPreviewInspectorSmartPropPathValue(draft.value, path),
      ),
    ]),
  });
  return {
    automatic,
    changed: automatic ? changed : true,
    changedPaths,
    draft,
    errorIdentity,
    failure,
    fingerprint,
    requirementRecords: requirementRecords ?? [],
  };
}

/** Applies one prepared target-failure mutation; callers own batching and commit timing. */
function applyPreviewInspectorTargetFailurePropMutation(mutation, options = {}) {
  if (mutation === undefined) return { changed: false, changedPaths: [], fingerprint: undefined };
  const commit = options.commit !== false;
  if (mutation.fallbackOnly === true) {
    const changed = setPreviewInspectorFallbackValuesEnabled(true, commit);
    return { ...mutation, changed };
  }
  setPreviewInspectorFallbackValuesEnabled(true, false);
  if (mutation.choice !== undefined) {
    rememberPreviewInspectorSmartPropChoice(
      mutation.failure.exportName,
      mutation.choice.path,
      mutation.selectedValue ?? mutation.choice.candidates[0],
      {
        origin: 'automatic-repair',
        ownerName: mutation.failure.blockedComponentName,
        sourcePath: mutation.failure.sourcePath,
      },
    );
  }
  const applied = mutation.automatic === true && mutation.repairUserOverride !== true
    ? setPreviewInspectorResolverPropsOverride(
        mutation.failure.exportName,
        mutation.draft.value,
        commit,
      )
    : setPreviewInspectorPropsOverride(
        mutation.failure.exportName,
        mutation.draft.value,
        commit,
        mutation.choice !== undefined,
      );
  if (!applied) return { ...mutation, changed: false };
  return mutation;
}

/** Shared Smart Fill action retained by the blocker UI and neural exception sweep. */
function smartFillPreviewInspectorTargetFailure(
  failure,
  commit = true,
  neuralResidualDecision,
  options = {},
) {
  const mutation = createPreviewInspectorTargetFailurePropMutation(failure, {
    finiteChoiceOrdinal: options?.finiteChoiceOrdinal,
    finiteChoiceSignature: options?.finiteChoiceSignature,
  });
  const result = applyPreviewInspectorTargetFailurePropMutation(mutation, { commit });
  if (result.changed !== true) return false;
  if (typeof recordPreviewInspectorBlockerAutoDecision === 'function') {
    recordPreviewInspectorBlockerAutoDecision({
      action: result.fallbackOnly === true
        ? 'Enable generated preview values and retry'
        : 'Smart fill target props and retry',
      blockerId: failure.id,
      blockerKind: 'target-error',
      blockerName: 'Component error · ' + failure.blockedComponentName,
      generatedPaths: result.changedPaths,
      mode: result.fallbackOnly === true ? 'automatic-values' : 'smart-props',
      ...(neuralResidualDecision === undefined ? {} : { neuralResidualDecision }),
      occurrenceStart: failure.occurrenceStart,
      ownerName: failure.exportName,
      reason: failure.headline,
      selectedValue: result.fallbackOnly === true ? {} : result.draft.generatedValue,
      sourcePath: failure.sourcePath,
      startsRenderAttempt: true,
      summary: {
        ...(neuralResidualDecision === undefined
          ? {}
          : {
              neuralResidual:
                typeof summarizePreviewInspectorNeuralResidualDecision === 'function'
                  ? summarizePreviewInspectorNeuralResidualDecision(neuralResidualDecision)
                  : undefined,
            }),
        preservedObservedOrUserProps: true,
        requiredPaths: failure.targetPropRequiredPaths,
      },
    });
  }
  return true;
}

/** Visibility prop spellings that can reveal an otherwise mounted-but-empty overlay export. */
const previewInspectorOverlayVisibilityPropNames = new Set([
  'active',
  'expanded',
  'isopen',
  'isvisible',
  'open',
  'present',
  'show',
  'shown',
  'visible',
]);

/** Loading is positive visibility only for exports whose public role is the loading surface itself. */
function isPreviewInspectorTargetVisibilityProp(exportName, normalizedPropName) {
  return previewInspectorOverlayVisibilityPropNames.has(normalizedPropName) ||
    (normalizedPropName === 'loading' &&
      /(?:Loader|Loading|Progress|Spinner)$/u.test(String(exportName)));
}

/** Normalizes one top-level prop name without reading the corresponding project value. */
function normalizePreviewInspectorOverlayVisibilityPropName(value) {
  return typeof value === 'string'
    ? value.replaceAll('_', '').toLowerCase()
    : '';
}

/**
 * Reads a single false visibility prop already observed at the exact mounted target facade.
 *
 * registerPreviewInspectorBaseProps stores a normalized, extension-owned prop record rather than
 * the live React props object. Descriptors are still used here so an accessor accidentally placed
 * in the session map is never invoked. A malformed/hostile record fails closed, and two possible
 * visibility fields remain a user choice instead of opening an arbitrary overlay.
 */
function readPreviewInspectorObservedOverlayVisibilityPaths(exportName) {
  const observedProps = previewInspectorSession.basePropsByExport.get(exportName);
  if (
    observedProps === null || typeof observedProps !== 'object' || Array.isArray(observedProps)
  ) return [];
  let descriptors;
  try { descriptors = Object.getOwnPropertyDescriptors(observedProps); } catch { return []; }
  return Object.keys(descriptors)
    .filter((propertyName) => {
      const descriptor = descriptors[propertyName];
      return (
        !previewInspectorSmartPropBlockedNames.has(propertyName) &&
        descriptor?.enumerable === true &&
        Object.hasOwn(descriptor, 'value') &&
        descriptor.value === false &&
        isPreviewInspectorTargetVisibilityProp(
          exportName,
          normalizePreviewInspectorOverlayVisibilityPropName(propertyName),
        )
      );
    })
    .sort((left, right) => left.localeCompare(right));
}

/** Writes one compiler-proven plain prop path without accepting calls, arrays, or prototype keys. */
function setPreviewInspectorSmartBooleanProp(value, rawPath) {
  const parsed = parsePreviewInspectorRequiredPath(rawPath);
  if (
    parsed === undefined || parsed.callable || parsed.collection || parsed.path.length === 0 ||
    value === null || typeof value !== 'object' || Array.isArray(value)
  ) return false;
  let current = value;
  for (const [index, propertyName] of parsed.path.entries()) {
    if (previewInspectorSmartPropBlockedNames.has(propertyName) || /^\d+$/u.test(propertyName)) {
      return false;
    }
    if (index === parsed.path.length - 1) {
      current[propertyName] = true;
      return true;
    }
    if (
      current[propertyName] === null || typeof current[propertyName] !== 'object' ||
      Array.isArray(current[propertyName])
    ) {
      current[propertyName] = {};
    }
    current = current[propertyName];
  }
  return false;
}

/**
 * Reveals a selected modal/drawer only when its declared boolean prop gives one deterministic answer.
 * Existing user JSON remains authoritative; this automatic path is used solely for a cold target
 * that mounted in its real page corridor but produced no host node.
 */
function autoRevealPreviewInspectorOverlayTarget(exportName, targetReachabilityKey) {
  const evidence = readPreviewInspectorSmartPropEvidence(exportName);
  if (!evidence.found) return undefined;
  const inferredVisibilityPaths = readPreviewInspectorSmartPropPathRecords(evidence)
    .filter((record) => {
      const leaf = normalizePreviewInspectorOverlayVisibilityPropName(
        record.path.split('.').at(-1),
      );
      return record.kind === 'boolean' && isPreviewInspectorTargetVisibilityProp(exportName, leaf);
    })
    .map((record) => record.path)
    .sort((left, right) => left.split('.').length - right.split('.').length || left.localeCompare(right));
  const visibilityPaths = inferredVisibilityPaths.length > 0
    ? inferredVisibilityPaths
    : readPreviewInspectorObservedOverlayVisibilityPaths(exportName);
  // Two independent visibility flags do not admit one safe answer. Leave that semantic choice in
  // the Inspector instead of opening an arbitrary flag merely because it sorts first.
  if (visibilityPaths.length !== 1) return undefined;
  const visibilityPath = visibilityPaths[0];
  if (visibilityPath === undefined) return undefined;
  const attemptRevision = typeof previewEntryRevision === 'undefined' ? 0 : previewEntryRevision;
  if (previewInspectorSession.overlayAutoAttemptRevision !== attemptRevision) {
    previewInspectorSession.overlayAutoAttemptRevision = attemptRevision;
    previewInspectorSession.overlayAutoAttemptKeys = new Set();
  }
  previewInspectorSession.overlayAutoAttemptKeys ??= new Set();
  const attemptKey = String(targetReachabilityKey) + '\u0000' + exportName + '\u0000' + visibilityPath;
  if (previewInspectorSession.overlayAutoAttemptKeys.has(attemptKey)) return undefined;
  const userProps = previewInspectorSession.overridesByExport.get(exportName) ?? {};
  const resolverProps = previewInspectorSession.resolverPropsByExport?.get?.(exportName) ?? {};
  if (
    hasPreviewInspectorSmartPropPath(userProps, visibilityPath) ||
    hasPreviewInspectorSmartPropPath(resolverProps, visibilityPath)
  ) return undefined;
  const materializedResolver = materializePreviewInspectorRuntimeFallbackOverride(resolverProps);
  const nextResolverProps =
    materializedResolver !== null && typeof materializedResolver === 'object' &&
    !Array.isArray(materializedResolver)
      ? materializedResolver
      : {};
  if (!setPreviewInspectorSmartBooleanProp(nextResolverProps, visibilityPath)) return undefined;
  if (
    typeof setPreviewInspectorResolverPropsOverride !== 'function' ||
    !setPreviewInspectorResolverPropsOverride(exportName, nextResolverProps, true)
  ) return undefined;
  previewInspectorSession.overlayAutoAttemptKeys.add(attemptKey);
  if (typeof recordPreviewInspectorBlockerAutoDecision === 'function') {
    recordPreviewInspectorBlockerAutoDecision({
      action: 'Reveal selected overlay target',
      blockerId: 'target-overlay:' + exportName,
      blockerKind: 'target-reachability',
      blockerName: 'Hidden overlay · ' + exportName,
      generatedPaths: [visibilityPath],
      mode: 'target-overlay-auto',
      ownerName: exportName,
      reason: 'The selected overlay mounted without host output and has one declared visibility prop',
      selectedValue: true,
      startsRenderAttempt: true,
      targetReachabilityKey,
    });
  }
  return visibilityPath;
}
`;
}
