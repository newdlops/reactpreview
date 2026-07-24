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
 * Manual and render-outcome choices retain precedence. Ordinary page components, ternaries, modal
 * visibility, and files outside the selected recipe are never changed by this bootstrap decision.
 */
function readPreviewInspectorVirtualPageShellContinuation(
  metadata,
  manualOrOutcomeOverride,
  autoOverride,
) {
  if (
    manualOrOutcomeOverride !== undefined ||
    autoOverride !== undefined ||
    previewInspectorSession.fallbackValuesEnabled !== true ||
    metadata?.kind !== 'early-return' ||
    !['truthy', 'falsy'].includes(metadata?.targetBranch)
  ) {
    return undefined;
  }
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const shells = candidate?.virtualPage?.shells;
  if (typeof metadata.sourcePath !== 'string') return undefined;
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
