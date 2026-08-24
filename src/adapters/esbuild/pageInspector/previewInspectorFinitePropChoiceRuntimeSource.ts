/** Generates finite source-authored prop choice discovery, application, and retry helpers. */

/** Creates browser source composed into the descriptor-aware Smart props runtime. */
export function createPreviewInspectorFinitePropChoiceRuntimeSource(): string {
  return String.raw`
/** Finds exact target identity metadata for a finite prop decision without reading project values. */
function readPreviewInspectorSmartPropChoiceContext(exportName, metadata = {}) {
  const descriptor = previewInspectorSession.descriptors.find((candidate) =>
    candidate?.inspector?.target?.exportName === exportName || candidate?.exportName === exportName,
  );
  const ownerNames = previewInspectorSession.directTargetRuntimeOwnerNamesByExport?.get?.(exportName);
  const requestedOwnerName = typeof metadata.ownerName === 'string' ? metadata.ownerName : '';
  const requestedOwnerAdmitted = requestedOwnerName.length > 0 &&
    typeof isPreviewInspectorSelectedTargetOwnerName === 'function' &&
    isPreviewInspectorSelectedTargetOwnerName(exportName, requestedOwnerName);
  const soleOwnerName = ownerNames instanceof Set && ownerNames.size === 1
    ? [...ownerNames][0]
    : undefined;
  return {
    origin: metadata.origin === 'user-choice' ? 'user-choice' : 'automatic-repair',
    ownerName: requestedOwnerAdmitted
      ? requestedOwnerName
      : typeof exportName === 'string' && exportName !== 'default'
        ? exportName
        : typeof soleOwnerName === 'string' ? soleOwnerName : '',
    sourcePath: typeof metadata.sourcePath === 'string'
      ? metadata.sourcePath
      : descriptor?.inspector?.target?.sourcePath ?? descriptor?.sourcePath ?? '',
  };
}

/** Retains finite-choice provenance and releases only conflicting automatic JSX decisions. */
function rememberPreviewInspectorSmartPropChoice(exportName, path, value, metadata = {}) {
  const context = readPreviewInspectorSmartPropChoiceContext(exportName, metadata);
  if (typeof registerPreviewInspectorSourceProvenPropChoice === 'function') {
    return registerPreviewInspectorSourceProvenPropChoice(exportName, path, value, context);
  }
  previewInspectorSession.sourceProvenPropChoicesByExport ??= new Map();
  let choices = previewInspectorSession.sourceProvenPropChoicesByExport.get(exportName);
  if (!(choices instanceof Map)) {
    choices = new Map();
    previewInspectorSession.sourceProvenPropChoicesByExport.set(exportName, choices);
  }
  choices.set(path, Object.freeze({
    ...context,
    path,
    revision: typeof previewEntryRevision === 'number' ? previewEntryRevision : 0,
    value,
  }));
  return true;
}

/** Reads current finite-choice provenance only when it still selects the same primitive value. */
function readPreviewInspectorSmartPropChoiceResolution(exportName, path, currentValue) {
  const resolution = previewInspectorSession.sourceProvenPropChoicesByExport
    ?.get?.(exportName)?.get?.(path);
  const revision = typeof previewEntryRevision === 'number' ? previewEntryRevision : 0;
  return resolution?.revision === revision &&
    typeof resolution.value === typeof currentValue && Object.is(resolution.value, currentValue)
    ? resolution
    : undefined;
}

/** Reads bounded source-authored scalar domains that can be presented as real user choices. */
function readPreviewInspectorSmartPropChoiceRecords(exportName, value) {
  const evidence = readPreviewInspectorSmartPropEvidence(exportName);
  const choices = [];
  let visited = 0;
  const visit = (node, path, depth) => {
    if (
      node === null || typeof node !== 'object' || depth > 12 ||
      visited >= PREVIEW_INSPECTOR_SMART_PROP_SCAN_LIMIT || choices.length >= 16
    ) return;
    visited += 1;
    const expectedType = node.kind === 'boolean'
      ? 'boolean'
      : node.kind === 'number' ? 'number' : node.kind === 'string' ? 'string' : '';
    let candidates = [];
    try {
      if (expectedType.length > 0 && Array.isArray(node.candidateValues)) {
        candidates = [...new Set(node.candidateValues.filter((candidate) =>
          typeof candidate === expectedType &&
          (expectedType !== 'number' || Number.isFinite(candidate)),
        ))].slice(0, 8);
      }
    } catch {
      candidates = [];
    }
    if (path.length > 0 && candidates.length > 1) {
      const pathText = path.join('.');
      const userProps = previewInspectorSession.overridesByExport.get(exportName) ?? {};
      const currentValue = readPreviewInspectorSmartPropPathValue(value, pathText);
      const resolution = readPreviewInspectorSmartPropChoiceResolution(
        exportName,
        pathText,
        currentValue,
      );
      choices.push(Object.freeze({
        candidates: Object.freeze(candidates),
        currentValue,
        kind: node.kind,
        path: pathText,
        selectionOrigin: resolution?.origin,
        userControlled: hasPreviewInspectorSmartPropPath(userProps, pathText),
      }));
    }
    if (node.kind !== 'object' || node.properties === null || typeof node.properties !== 'object') {
      return;
    }
    let descriptors;
    try { descriptors = Object.getOwnPropertyDescriptors(node.properties); } catch { return; }
    for (const propertyName of Object.keys(descriptors).sort()) {
      const descriptor = descriptors[propertyName];
      if (
        previewInspectorSmartPropBlockedNames.has(propertyName) ||
        !Object.hasOwn(descriptor, 'value')
      ) continue;
      visit(descriptor.value, [...path, propertyName], depth + 1);
    }
  };
  visit(evidence.inferredPropShape, [], 0);
  return choices;
}

/** Builds the effective target props without invoking an authored accessor. */
function readPreviewInspectorSmartPropChoiceValue(exportName) {
  const evidence = readPreviewInspectorSmartPropEvidence(exportName);
  const observedProps = previewInspectorSession.basePropsByExport.get(exportName) ?? {};
  const resolverProps = previewInspectorSession.resolverPropsByExport?.get?.(exportName) ?? {};
  const userProps = previewInspectorSession.overridesByExport.get(exportName) ?? {};
  return createPreviewPropsFromLayers(
    evidence.inferredPropShape,
    evidence.automaticProps,
    observedProps,
    materializePreviewInspectorRuntimeFallbackOverride(resolverProps),
    materializePreviewInspectorRuntimeFallbackOverride(userProps),
  );
}

/** Applies an explicit finite choice while preserving unrelated manual JSON and authored branches. */
function applyPreviewInspectorSmartPropChoice(exportName, choice, selectedValue, commit = true) {
  if (
    typeof exportName !== 'string' || exportName.length === 0 ||
    !Array.isArray(choice?.candidates) ||
    !choice.candidates.some((candidate) =>
      typeof candidate === typeof selectedValue && Object.is(candidate, selectedValue)
    )
  ) return undefined;
  const userProps = previewInspectorSession.overridesByExport.get(exportName) ?? {};
  const nextOverride = setPreviewInspectorSmartPropPathValue(
    userProps,
    choice.path,
    selectedValue,
  );
  if (nextOverride === undefined) return undefined;
  rememberPreviewInspectorSmartPropChoice(exportName, choice.path, selectedValue, {
    origin: 'user-choice',
  });
  setPreviewInspectorFallbackValuesEnabled(true, false);
  return setPreviewInspectorPropsOverride(exportName, nextOverride, commit, true)
    ? nextOverride
    : undefined;
}

/** Admits only conventional exhaustive-branch failures; unrelated runtime errors stay untouched. */
function isPreviewInspectorExhaustivePropChoiceFailure(failure) {
  const headline = String(
    failure?.headline ?? createRuntimeErrorHeadline(failure?.error) ?? '',
  );
  return /(?:^|\b)(?:Unreachable|Unexpected value)(?::|\b)/iu.test(headline);
}

/** Reads every finite source-authored domain implicated by one exhaustive target failure. */
function readPreviewInspectorTargetFailurePropChoiceDomains(failure) {
  if (
    !isPreviewInspectorExhaustivePropChoiceFailure(failure) ||
    typeof failure?.exportName !== 'string'
  ) return [];
  const value = readPreviewInspectorSmartPropChoiceValue(failure.exportName);
  return readPreviewInspectorSmartPropChoiceRecords(failure.exportName, value);
}

/** Identifies one authored domain independently from the exception produced by each candidate. */
function createPreviewInspectorTargetFailurePropChoiceSignature(failure, choice) {
  if (typeof failure?.exportName !== 'string' || !Array.isArray(choice?.candidates)) {
    return undefined;
  }
  return JSON.stringify({
    candidates: choice.candidates,
    exportName: failure.exportName,
    path: choice.path,
  });
}

/** Finds invalid finite domains that can either auto-recover or become a user selection. */
function readPreviewInspectorTargetFailurePropChoices(failure) {
  const invalid = readPreviewInspectorTargetFailurePropChoiceDomains(failure)
    .filter((choice) => !choice.candidates.some((candidate) =>
      typeof candidate === typeof choice.currentValue && Object.is(candidate, choice.currentValue),
    ));
  if (invalid.length <= 1) return invalid;
  const headline = String(failure?.headline ?? '');
  const matching = invalid.filter((choice) =>
    choice.currentValue !== undefined && headline.includes(String(choice.currentValue)),
  );
  return matching.length === 1 ? matching : invalid;
}

/** Repairs or advances one finite domain without replaying a previously tested option. */
function createPreviewInspectorFinitePropChoiceMutation(failure, options = {}) {
  const invalidChoices = readPreviewInspectorTargetFailurePropChoices(failure);
  if (invalidChoices.length > 1) return undefined;
  const finiteChoiceOrdinal = Number.isSafeInteger(options?.finiteChoiceOrdinal) &&
    options.finiteChoiceOrdinal > 0
      ? options.finiteChoiceOrdinal
      : undefined;
  const finiteChoiceSignature = typeof options?.finiteChoiceSignature === 'string'
    ? options.finiteChoiceSignature
    : undefined;
  const choiceDomains = finiteChoiceOrdinal === undefined
    ? []
    : readPreviewInspectorTargetFailurePropChoiceDomains(failure).filter(
        (candidate) =>
          candidate.selectionOrigin !== 'user-choice' &&
          (finiteChoiceSignature === undefined ||
            createPreviewInspectorTargetFailurePropChoiceSignature(failure, candidate) ===
              finiteChoiceSignature),
      );
  if (finiteChoiceOrdinal !== undefined && choiceDomains.length !== 1) return undefined;
  let choice = finiteChoiceOrdinal === undefined ? invalidChoices[0] : choiceDomains[0];
  let conditionReconciliation = false;
  if (
    finiteChoiceOrdinal === undefined && choice === undefined &&
    isPreviewInspectorExhaustivePropChoiceFailure(failure)
  ) {
    const effectiveValue = readPreviewInspectorSmartPropChoiceValue(failure.exportName);
    const validChoices = readPreviewInspectorSmartPropChoiceRecords(
      failure.exportName,
      effectiveValue,
    ).filter((candidate) => candidate.candidates.some((value) =>
      typeof value === typeof candidate.currentValue && Object.is(value, candidate.currentValue),
    ));
    if (validChoices.length !== 1) return undefined;
    choice = validChoices[0];
    conditionReconciliation = true;
  }
  if (choice === undefined) return undefined;
  if (finiteChoiceOrdinal !== undefined && finiteChoiceOrdinal > choice.candidates.length) {
    return undefined;
  }
  const selectedValue = conditionReconciliation
    ? choice.currentValue
    : choice.candidates[(finiteChoiceOrdinal ?? 1) - 1];
  const repairUserOverride = choice.userControlled === true;
  const destinationProps = repairUserOverride
    ? previewInspectorSession.overridesByExport.get(failure.exportName) ?? {}
    : previewInspectorSession.resolverPropsByExport?.get?.(failure.exportName) ?? {};
  const value = setPreviewInspectorSmartPropPathValue(
    materializePreviewInspectorRuntimeFallbackOverride(destinationProps),
    choice.path,
    selectedValue,
  );
  if (value === undefined) return undefined;
  const beforeValue = copyPreviewInspectorBlockerValueForJson(destinationProps, { nodes: 0 });
  const before = beforeValue !== null && typeof beforeValue === 'object' && !Array.isArray(beforeValue)
    ? beforeValue
    : {};
  if (!conditionReconciliation &&
    JSON.stringify(fingerprintPreviewInspectorSmartPropValue(before)) ===
    JSON.stringify(fingerprintPreviewInspectorSmartPropValue(value))
  ) return undefined;
  const errorIdentity = createPreviewInspectorTargetFailureErrorIdentity(failure);
  return {
    automatic: true,
    changed: true,
    changedPaths: conditionReconciliation ? [] : [choice.path],
    choice,
    conditionReconciliation,
    draft: {
      beforeValue: before,
      evidenceFound: true,
      generatedPaths: conditionReconciliation ? [] : [choice.path],
      generatedValue: setPreviewInspectorSmartPropPathValue({}, choice.path, selectedValue) ?? {},
      requiredPaths: [choice.path],
      value,
    },
    errorIdentity,
    failure,
    fingerprint: JSON.stringify({
      candidates: choice.candidates,
      errorIdentity,
      path: choice.path,
      selectedValue,
    }),
    finiteChoiceOrdinal,
    repairUserOverride,
    requirementRecords: [{ kind: choice.kind, path: choice.path }],
    selectedValue,
  };
}
`;
}
