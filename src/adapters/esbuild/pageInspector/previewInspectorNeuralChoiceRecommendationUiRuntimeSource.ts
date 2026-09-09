/** Generates read-only recommendation markers without changing choices, model work, or page state. */
export function createPreviewInspectorNeuralChoiceRecommendationUiRuntimeSource(): string {
  return String.raw`
/** Uses the ranker's admitted path, never list position, manual selection, or a matching label. */
function readPreviewInspectorNeuralRecommendedChoicePath(derivation) {
  if (derivation?.truncated === true || typeof derivation?.recommendedPath?.id !== 'string') return undefined;
  const path = Array.isArray(derivation.paths)
    ? derivation.paths.find((candidate) => candidate?.id === derivation.recommendedPath.id) : undefined;
  if (path === undefined || path.blocked === true || path.cyclic === true || path.bounded === true ||
      Number(path.failureCount ?? 0) > 0) return undefined;
  if (derivation.contextual === true && (path.contextual !== true ||
      typeof derivation.currentStateId !== 'string' || path.contextStateId !== derivation.currentStateId)) return undefined;
  return path;
}

/** Maps the recommendation to exact current candidates; partial or stale mappings get no badges. */
function readPreviewInspectorNeuralRecommendedChoiceSelections(derivation, choices) {
  const path = readPreviewInspectorNeuralRecommendedChoicePath(derivation);
  if (path === undefined) return {};
  const steps = Array.isArray(path.steps) ? path.steps.filter((step) => step?.current === true) : [];
  const selections = readPreviewInspectorNeuralChoicePathSelections({ ...path, contextual: true }, choices);
  return steps.length > 0 && Object.keys(selections).length === steps.length ? selections : {};
}

/** Keeps recommendation visually and semantically separate from option origin and applied state. */
function createPreviewInspectorNeuralChoiceBadge() {
  return React.createElement('span', {
    className: 'rpi-neural-choice-badge',
    title: 'Recommended from local outcome evidence. This badge does not mean selected, applied, or verified; check the path status.',
  }, 'Neural choice');
}
`;
}
