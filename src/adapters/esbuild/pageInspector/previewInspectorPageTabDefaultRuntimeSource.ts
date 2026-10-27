/** Generates side-effect-free initial tab selection from exact current render-path evidence. */

/** Keeps authored URL and subsequent hook state in charge; only the hook's default input changes. */
export function createPreviewInspectorPageTabDefaultRuntimeSource(): string {
  return String.raw`
/** Resolves only a proven controller default, never a live activeKey or a tab click. */
function resolvePreviewInspectorTargetPageTabDefault(authoredDefault, metadata) {
  if (
    previewInspectorSession.fallbackValuesEnabled !== true ||
    typeof authoredDefault !== 'string' ||
    metadata === null || typeof metadata !== 'object' ||
    typeof metadata.sourcePath !== 'string' ||
    typeof metadata.ownerName !== 'string' ||
    typeof metadata.targetName !== 'string' ||
    typeof metadata.targetKey !== 'string' || metadata.targetKey.length === 0 ||
    metadata.targetKey.length > 128 ||
    !Array.isArray(metadata.keys) || metadata.keys.length > 8 ||
    !metadata.keys.every((key) => typeof key === 'string' && key.length > 0 && key.length <= 128) ||
    new Set(metadata.keys).size !== metadata.keys.length ||
    !metadata.keys.includes(authoredDefault) || !metadata.keys.includes(metadata.targetKey)
  ) return authoredDefault;
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const steps = candidate?.renderPath?.steps;
  if (!Array.isArray(steps)) return authoredDefault;
  const proven = steps.some((owner, index) => index > 0 &&
    owner?.sourcePath === metadata.sourcePath && owner?.label === metadata.ownerName &&
    steps[index - 1]?.label === metadata.targetName);
  return proven ? metadata.targetKey : authoredDefault;
}
`;
}
