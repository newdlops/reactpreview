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
 * Expands a short runtime field such as "value" to a statically proven path like "field.value".
 * Ambiguous suffix matches are all retained because each path was independently observed in the
 * target source; uncorrelated runtime fields remain top-level rather than being guessed deeper.
 */
function resolvePreviewInspectorSmartPropRequiredPaths(exportName, requiredPaths) {
  const evidence = readPreviewInspectorSmartPropEvidence(exportName);
  const inferredPaths = evidence.inferredProps.map((record) => record.path);
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
    const suffixMatches = inferredPaths.filter(
      (path) => path === normalizedPath || path.endsWith('.' + normalizedPath),
    );
    if (suffixMatches.length === 0) {
      append(rawPath);
      continue;
    }
    for (const path of suffixMatches) append(path + (parsed.callable ? '()' : ''));
  }
  return resolved;
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
  const completedValue = createPreviewInspectorRuntimeFallbackAutoValue(
    baseValue,
    resolvedRequiredPaths,
  );
  const copiedValue = copyPreviewInspectorBlockerValueForJson(completedValue, { nodes: 0 });
  const value = copiedValue !== null && typeof copiedValue === 'object' && !Array.isArray(copiedValue)
    ? copiedValue
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
