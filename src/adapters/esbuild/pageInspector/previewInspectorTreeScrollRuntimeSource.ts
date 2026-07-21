/**
 * Generates scroll-preservation helpers for Inspector interactions and the component tree.
 *
 * Selecting an instrumented export can remount the preview shell, so React component-local refs are
 * not sufficient to retain the tree viewport. These helpers keep only finite coordinates in the
 * hot-session object and never retain DOM nodes beyond one synchronous operation.
 */

/**
 * Creates browser source that captures a UI interaction and restores it after React commits.
 *
 * Expected lexical bindings include `previewInspectorDevtoolsSessionState`, animation-frame APIs,
 * and the webview document supplied by the composed Inspector runtime.
 *
 * @returns Plain JavaScript source concatenated before the Components pane is declared.
 */
export function createPreviewInspectorTreeScrollRuntimeSource(): string {
  return String.raw`
/** Converts a browser scroll coordinate into a finite non-negative value. */
function normalizePreviewInspectorTreeScrollCoordinate(value) {
  return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
}

/** Retains normal user-driven tree scrolling unless a click snapshot is awaiting restoration. */
function rememberPreviewInspectorTreeScrollPosition(treeViewport) {
  if (treeViewport === null || treeViewport === undefined) return;
  if (previewInspectorDevtoolsSessionState.pendingTreeScrollSnapshot !== undefined) return;
  previewInspectorDevtoolsSessionState.treeScrollLeft =
    normalizePreviewInspectorTreeScrollCoordinate(treeViewport.scrollLeft);
  previewInspectorDevtoolsSessionState.treeScrollTop =
    normalizePreviewInspectorTreeScrollCoordinate(treeViewport.scrollTop);
}

/** Captures preview-document coordinates plus the tree when that named viewport is mounted. */
function capturePreviewInspectorTreeSelectionScroll(treeViewport) {
  const scrollingElement = globalThis.document?.scrollingElement;
  const revision = (previewInspectorDevtoolsSessionState.treeScrollSnapshotRevision ?? 0) + 1;
  const snapshot = {
    documentLeft: normalizePreviewInspectorTreeScrollCoordinate(scrollingElement?.scrollLeft),
    documentTop: normalizePreviewInspectorTreeScrollCoordinate(scrollingElement?.scrollTop),
    revision,
    treeLeft: normalizePreviewInspectorTreeScrollCoordinate(
      treeViewport?.scrollLeft ?? previewInspectorDevtoolsSessionState.treeScrollLeft,
    ),
    treeTop: normalizePreviewInspectorTreeScrollCoordinate(
      treeViewport?.scrollTop ?? previewInspectorDevtoolsSessionState.treeScrollTop,
    ),
  };
  previewInspectorDevtoolsSessionState.treeScrollLeft = snapshot.treeLeft;
  previewInspectorDevtoolsSessionState.treeScrollTop = snapshot.treeTop;
  previewInspectorDevtoolsSessionState.treeScrollSnapshotRevision = revision;
  previewInspectorDevtoolsSessionState.pendingTreeScrollSnapshot = snapshot;
  return snapshot;
}

/** Restores a finite snapshot without invoking focus, smooth scrolling, or application callbacks. */
function restorePreviewInspectorTreeScrollSnapshot(treeViewport, snapshot, restoreDocument) {
  if (snapshot === undefined) return;
  if (treeViewport !== null && treeViewport !== undefined) {
    treeViewport.scrollLeft = normalizePreviewInspectorTreeScrollCoordinate(snapshot.treeLeft);
    treeViewport.scrollTop = normalizePreviewInspectorTreeScrollCoordinate(snapshot.treeTop);
  }
  if (restoreDocument !== true) return;
  const scrollingElement = globalThis.document?.scrollingElement;
  if (scrollingElement === null || scrollingElement === undefined) return;
  scrollingElement.scrollLeft = normalizePreviewInspectorTreeScrollCoordinate(snapshot.documentLeft);
  scrollingElement.scrollTop = normalizePreviewInspectorTreeScrollCoordinate(snapshot.documentTop);
}

/** Restores persisted coordinates now and once more after browser focus/layout scrolling settles. */
function schedulePreviewInspectorTreeScrollRestoration(treeViewport) {
  const pending = previewInspectorDevtoolsSessionState.pendingTreeScrollSnapshot;
  const snapshot = pending ?? {
    treeLeft: previewInspectorDevtoolsSessionState.treeScrollLeft,
    treeTop: previewInspectorDevtoolsSessionState.treeScrollTop,
  };
  restorePreviewInspectorTreeScrollSnapshot(treeViewport, snapshot, pending !== undefined);
  return requestAnimationFrame(() => {
    restorePreviewInspectorTreeScrollSnapshot(treeViewport, snapshot, pending !== undefined);
    if (
      pending !== undefined &&
      previewInspectorDevtoolsSessionState.pendingTreeScrollSnapshot?.revision === pending.revision
    ) {
      previewInspectorDevtoolsSessionState.pendingTreeScrollSnapshot = undefined;
    }
    rememberPreviewInspectorTreeScrollPosition(treeViewport);
  });
}
`;
}
