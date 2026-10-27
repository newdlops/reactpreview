/** Generates bounded Next redirect continuation through the existing validated page-selection port. */
export function createPreviewInspectorNextAppNavigationControlRuntimeSource(): string {
  return String.raw`
/** Reads one inert data property; project accessors never run during route admission. */
function readPreviewInspectorNextAppControlData(value, key) {
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; }
}
/** Serializes a finite redirect trail so replacing an import map cannot restart a redirect loop. */
function serializePreviewInspectorNextAppNavigationTrail(value = previewInspectorSession.nextAppNavigationTrail) {
  const owner = readPreviewInspectorNextAppControlData(value, 'owner');
  const items = readPreviewInspectorNextAppControlData(value, 'transitions');
  if (typeof owner !== 'string' || owner.length > 4096 || !Array.isArray(items) ||
    items.length > 4) return undefined;
  const transitions = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = readPreviewInspectorNextAppControlData(items, String(index));
    if (typeof item !== 'string' || item.length > 4097) return undefined;
    transitions.push(item);
  }
  return { owner, transitions };
}
/** Requests one exact, available filesystem route without granting a browser-controlled source path. */
function handlePreviewInspectorNextAppNavigationControl(signal, boundaryOwner) {
  const kind = readPreviewInspectorNextAppControlData(signal, 'kind');
  const destination = readPreviewInspectorNextAppControlData(signal, 'destination');
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const current = readSelectedPreviewInspectorPageCandidate(descriptor);
  if (['redirect', 'permanentRedirect', 'notFound', 'forbidden', 'unauthorized'].includes(kind) && boundaryOwner !== undefined)
    previewInspectorSession.nextAppControl = { owner: boundaryOwner, descriptor, candidateId: current?.id };
  if (!['redirect', 'permanentRedirect'].includes(kind) ||
    typeof destination !== 'string' || destination.length === 0 ||
    destination.length > 2048 || !destination.startsWith('/') ||
    destination.startsWith('//') || /[\\\u0000-\u001f\u007f?#]/u.test(destination) ||
    previewInspectorSession.pendingPageCandidateId !== undefined ||
    previewInspectorSession.queuedPageCandidateId !== undefined) return false;
  const target = descriptor?.inspector?.target;
  if (typeof target?.sourcePath !== 'string' || typeof target.exportName !== 'string') return false;
  const matches = readPreviewInspectorPageCandidates(descriptor).filter((candidate) =>
    candidate?.routeLocation?.evidenceKind === 'next-app-filesystem' &&
    typeof candidate.routeLocation.sourcePath === 'string' &&
    candidate.routeLocation.pathname === destination);
  if (matches.length !== 1 || matches[0].id === current?.id) return false;
  const owner = target.sourcePath + '\0' + target.exportName;
  let trail = previewInspectorSession.nextAppNavigationTrail;
  if (serializePreviewInspectorNextAppNavigationTrail(trail)?.owner !== owner) {
    const retained = typeof readPersistedPreviewInspectorState === 'function'
      ? serializePreviewInspectorNextAppNavigationTrail(readPersistedPreviewInspectorState().nextAppNavigationTrail)
      : undefined;
    trail = retained?.owner === owner ? retained : { owner, transitions: [] };
    previewInspectorSession.nextAppNavigationTrail = trail;
  }
  const transition = String(current?.routeLocation?.pathname ?? '') + '\0' + destination;
  if (trail.queued === true || trail.transitions.length >= 4 || trail.transitions.includes(transition)) return false;
  trail.queued = true;
  const controlRevision = previewInspectorSession.neuralHumanControlRevision;
  Promise.resolve().then(() => {
    trail.queued = false;
    if (previewInspectorSession.neuralHumanControlRevision !== controlRevision ||
      previewInspectorSession.nextAppNavigationTrail !== trail ||
      findSelectedPreviewInspectorDescriptor() !== descriptor ||
      previewInspectorSession.pendingPageCandidateId !== undefined ||
      previewInspectorSession.queuedPageCandidateId !== undefined) return;
    trail.transitions.push(transition);
    const changed = selectPreviewInspectorPageCandidate(matches[0].id, { origin: 'framework-navigation' });
    if (!changed) trail.transitions.pop();
    if (typeof recordPreviewInspectorRuntimeHealth === 'function') {
      recordPreviewInspectorRuntimeHealth({ category: 'page-context',
        event: 'next-app-navigation-continuation',
        detail: { candidateId: matches[0].id, destination, accepted: changed === true } });
    }
  });
  return true;
}
/** Prevents a visible framework guard from becoming a successful page or a learned fallback. */
function hasPreviewInspectorNextAppControlBlocker(state) {
  const control = previewInspectorSession.nextAppControl;
  return control !== undefined && control.descriptor === findSelectedPreviewInspectorDescriptor() &&
    control.candidateId === (state?.candidateId ?? previewInspectorSession.selectedPageCandidateId);
}
/** Releases only the exact mounted boundary's guard after Retry or unmount. */
function clearPreviewInspectorNextAppNavigationControl(owner) {
  if (previewInspectorSession.nextAppControl?.owner !== owner) return false;
  previewInspectorSession.nextAppControl = undefined;
  return true;
}
`;
}
