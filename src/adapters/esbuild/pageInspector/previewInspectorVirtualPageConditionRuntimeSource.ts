/**
 * Generates the browser policy that opens statically proven VirtualPage shell continuations.
 *
 * The general condition registry owns persistence, manual switches, and target DFS. VirtualPage
 * composition has one narrower responsibility: a selected layout must be allowed to place its
 * child before asynchronous blocker search begins. Keeping that policy in this module prevents the
 * general registry from accumulating page-generation concerns and keeps both files below the
 * project's 1,000-line boundary.
 */

/**
 * Creates one lexical browser helper consumed by the Page Inspector condition registry.
 *
 * Expected surrounding bindings are the Inspector session plus the selected descriptor/candidate
 * readers. The generated code has no host APIs and compares only compiler-issued source identities.
 *
 * @returns JavaScript source inserted before condition resolution begins.
 */
export function createPreviewInspectorVirtualPageConditionRuntimeSource(): string {
  return String.raw`
/**
 * Registers one authentic component module reached by the transitive VirtualPage JSX traversal.
 *
 * Sources are grouped by selected candidate rather than retained in one global set. Switching page
 * candidates therefore cannot make an unrelated branch eligible, while hot reload may add any
 * number of deeper components without an authored-hop limit.
 */
function registerPreviewInspectorVirtualPageSource(sourcePath) {
  if (
    typeof sourcePath !== 'string' ||
    sourcePath.length === 0 ||
    sourcePath.length > 4_096
  ) {
    return false;
  }
  if (!(previewInspectorSession.virtualPageSourcePathsByCandidate instanceof Map)) {
    previewInspectorSession.virtualPageSourcePathsByCandidate = new Map();
  }
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const candidateId = typeof candidate?.id === 'string' && candidate.id.length > 0
    ? candidate.id
    : 'default';
  const sourcePaths =
    previewInspectorSession.virtualPageSourcePathsByCandidate.get(candidateId) ?? new Set();
  const previousSize = sourcePaths.size;
  sourcePaths.add(sourcePath);
  previewInspectorSession.virtualPageSourcePathsByCandidate.set(candidateId, sourcePaths);
  return sourcePaths.size !== previousSize;
}

/** Checks compiler-registered transitive JSX sources for only the currently selected candidate. */
function isPreviewInspectorRegisteredVirtualPageSource(candidate, sourcePath) {
  if (
    typeof sourcePath !== 'string' ||
    !(previewInspectorSession.virtualPageSourcePathsByCandidate instanceof Map)
  ) {
    return false;
  }
  const candidateId = typeof candidate?.id === 'string' && candidate.id.length > 0
    ? candidate.id
    : 'default';
  return previewInspectorSession.virtualPageSourcePathsByCandidate
    .get(candidateId)
    ?.has(sourcePath) === true;
}

/**
 * Opens an early-return gate owned by a statically selected VirtualPage shell on its first render.
 *
 * A generated VirtualPage deliberately imports a concrete page body instead of executing the full
 * application root. Its retained layout may still begin with loading, session, or Redux guards
 * whose authored cold state returns null before the shell can place its child. The compiler has
 * already proven both the exact shell module and the branch that continues through the component,
 * so selecting that continuation is deterministic and does not require a user-authored payload.
 *
 * Manual and render-outcome choices retain precedence. A logical/ternary gate additionally needs
 * one exact compiler-marked JSX site on the active path; other branches keep authored behavior.
 */
function readPreviewInspectorVirtualPageShellContinuation(
  metadata,
  manualOrOutcomeOverride,
  autoOverride,
  authoredValue,
) {
  const selectedJsxBranch = metadata?.targetBranchEvidence === 'selected-target' &&
    ['early-return', 'logical-and', 'ternary'].includes(metadata?.kind) && metadata?.requiresAuthoredState !== true;
  if (
    manualOrOutcomeOverride !== undefined ||
    autoOverride !== undefined ||
    previewInspectorSession.fallbackValuesEnabled !== true ||
    metadata?.kind !== 'early-return' && !selectedJsxBranch ||
    !['truthy', 'falsy'].includes(metadata?.targetBranch)
  ) {
    return undefined;
  }
  // Generated REST rows are not part of the bootstrap: a guard first seen while they are served
  // (often a row helper such as "!grade || !(grade in COLORS)") keeps its authored branch.
  if (
    typeof isPreviewInspectorRestCollectionFillServing === 'function' &&
    isPreviewInspectorRestCollectionFillServing()
  ) {
    return undefined;
  }
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const shells = candidate?.virtualPage?.shells;
  if (typeof metadata.sourcePath !== 'string') return undefined;
  if (selectedJsxBranch && (candidate?.selectedJsxOccurrenceIds?.length ?? 0) > 0) {
    const provenOwner = (candidate?.renderPath?.steps ?? []).some((step) =>
      step?.invocation?.mode === 'jsx' && step.invocation.sourcePath === metadata.sourcePath);
    return provenOwner ? metadata.targetBranch === 'truthy' : undefined;
  }
  if (metadata.kind !== 'early-return') return undefined;
  if (metadata.renderValueHelper === true) {
    if (
      typeof authoredValue !== 'boolean' ||
      metadata.targetBranchEvidence !== 'selected-target' ||
      typeof metadata.targetCallName !== 'string' ||
      metadata.targetCallName.length === 0 ||
      !Array.isArray(candidate?.renderPath?.steps)
    ) return undefined;
    const steps = candidate.renderPath.steps;
    const ownsReturn = steps.some((step, index) =>
      index > 0 && step?.sourcePath === metadata.sourcePath &&
      step?.label === metadata.ownerName && steps[index - 1]?.label === metadata.targetCallName,
    );
    return ownsReturn ? metadata.targetBranch === 'truthy' : undefined;
  }
  const ownsGuard =
    (Array.isArray(shells) && shells.some(
      (shell) =>
        shell?.root !== null &&
        typeof shell?.root === 'object' &&
        shell.root.sourcePath === metadata.sourcePath,
    )) ||
    isPreviewInspectorRegisteredVirtualPageSource(candidate, metadata.sourcePath);
  if (!ownsGuard) return undefined;
  return metadata.targetBranch === 'truthy';
}
`;
}
