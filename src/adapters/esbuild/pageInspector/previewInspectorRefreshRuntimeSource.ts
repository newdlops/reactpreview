/**
 * Generates the browser-side refresh scheduler for React Page Inspector.
 *
 * Highlight reconciliation is inexpensive and may follow an animation frame, while rebuilding a
 * React Fiber tree is deliberately rate-limited. Keeping those workloads separate prevents an
 * animated application, chatty console, or attribute-only DOM update from monopolizing VS Code's
 * shared webview renderer and starving normal GUI painting.
 */

/** Minimum delay between component-tree subscriber refreshes in one pinned preview tab. */
export const PREVIEW_INSPECTOR_TREE_REFRESH_INTERVAL_MS = 250;

/**
 * Creates the scheduler and structural DOM observer source used by the composed Inspector entry.
 *
 * The generated functions expect the surrounding runtime's session, tree notification, highlight
 * reconciliation, picker handlers, outline restoration, and mount node bindings. Function
 * declarations are used so other generated modules may safely reference them regardless of source
 * concatenation order.
 *
 * @returns Plain JavaScript source evaluated inside the preview webview.
 */
export function createPreviewInspectorRefreshRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_TREE_REFRESH_INTERVAL_MS = ${PREVIEW_INSPECTOR_TREE_REFRESH_INTERVAL_MS};

/** Marks the cached Fiber snapshot stale without rebuilding it on the application's commit stack. */
function markPreviewInspectorTreeDirty() {
  previewInspectorSession.treeDirty = true;
}

/** Reads a monotonic browser clock when available and a wall clock only as a safe fallback. */
function readPreviewInspectorRefreshClock() {
  return typeof globalThis.performance?.now === 'function'
    ? globalThis.performance.now()
    : Date.now();
}

/** Reconciles host outlines at most once per browser frame and never rebuilds the Fiber tree. */
function schedulePreviewInspectorHighlight() {
  if (previewInspectorSession.highlightFrame !== undefined) return;
  const schedule = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 16));
  previewInspectorSession.highlightFrame = schedule(() => {
    previewInspectorSession.highlightFrame = undefined;
    refreshPreviewInspectorHighlight();
  });
}

/**
 * Coalesces Inspector-only UI updates and caps expensive component-tree renders at four per second.
 * Hidden webviews retain a dirty bit but allocate no polling timer; visibility restoration flushes
 * one current snapshot instead of replaying every background mutation.
 */
function schedulePreviewInspectorTreeRefresh() {
  if (previewInspectorSession.treeListeners.size === 0) return;
  if (document.visibilityState === 'hidden') return;
  if (
    previewInspectorSession.treeRefreshTimer !== undefined ||
    previewInspectorSession.treeRefreshIdle !== undefined
  ) return;
  const now = readPreviewInspectorRefreshClock();
  const previous = Number.isFinite(previewInspectorSession.lastTreeRefreshAt)
    ? previewInspectorSession.lastTreeRefreshAt
    : now - PREVIEW_INSPECTOR_TREE_REFRESH_INTERVAL_MS;
  const delay = Math.max(0, PREVIEW_INSPECTOR_TREE_REFRESH_INTERVAL_MS - (now - previous));
  previewInspectorSession.treeRefreshTimer = setTimeout(() => {
    previewInspectorSession.treeRefreshTimer = undefined;
    if (document.visibilityState === 'hidden') return;
    const flush = () => {
      previewInspectorSession.treeRefreshIdle = undefined;
      if (document.visibilityState === 'hidden') return;
      previewInspectorSession.lastTreeRefreshAt = readPreviewInspectorRefreshClock();
      notifyPreviewInspectorTreeSubscribers();
      schedulePreviewInspectorHighlight();
    };
    previewInspectorSession.treeRefreshIdle = typeof globalThis.requestIdleCallback === 'function'
      ? globalThis.requestIdleCallback(flush, {
          timeout: PREVIEW_INSPECTOR_TREE_REFRESH_INTERVAL_MS,
        })
      : undefined;
    if (previewInspectorSession.treeRefreshIdle === undefined) flush();
  }, delay);
}

/** Marks a structural/React commit and schedules independent visual and tree reconciliation lanes. */
function schedulePreviewInspectorCommitRefresh() {
  markPreviewInspectorTreeDirty();
  schedulePreviewInspectorHighlight();
  schedulePreviewInspectorTreeRefresh();
}

/** Resumes exactly one pending refresh when VS Code makes a previously hidden preview visible. */
function handlePreviewInspectorVisibilityChange() {
  if (document.visibilityState !== 'hidden') {
    schedulePreviewInspectorCommitRefresh();
  }
}

/** Treats only child-list mutations as component-tree evidence; attributes and text need no scan. */
function handlePreviewInspectorMutations(records) {
  if (records.some((record) => record.type === 'childList')) {
    schedulePreviewInspectorCommitRefresh();
  }
}

/** Cancels scheduler handles so a replaced hot bundle cannot keep work alive in the pinned tab. */
function cancelPreviewInspectorRefreshScheduling() {
  if (previewInspectorSession.highlightFrame !== undefined) {
    globalThis.cancelAnimationFrame?.(previewInspectorSession.highlightFrame);
    clearTimeout(previewInspectorSession.highlightFrame);
    previewInspectorSession.highlightFrame = undefined;
  }
  if (previewInspectorSession.treeRefreshTimer !== undefined) {
    clearTimeout(previewInspectorSession.treeRefreshTimer);
    previewInspectorSession.treeRefreshTimer = undefined;
  }
  if (previewInspectorSession.treeRefreshIdle !== undefined) {
    globalThis.cancelIdleCallback?.(previewInspectorSession.treeRefreshIdle);
    previewInspectorSession.treeRefreshIdle = undefined;
  }
}

/** Installs picker events and a structural-only observer; CSS outlines follow scroll and resize. */
function installPreviewInspectorDomObservers() {
  window.addEventListener('pointermove', handlePreviewInspectorPointerMove, true);
  window.addEventListener('click', handlePreviewInspectorPick, true);
  document.addEventListener('visibilitychange', handlePreviewInspectorVisibilityChange);
  const mutationObserver = typeof MutationObserver === 'function'
    ? new MutationObserver(handlePreviewInspectorMutations)
    : undefined;
  mutationObserver?.observe(mountNode, { childList: true, subtree: true });
  return () => {
    window.removeEventListener('pointermove', handlePreviewInspectorPointerMove, true);
    window.removeEventListener('click', handlePreviewInspectorPick, true);
    document.removeEventListener('visibilitychange', handlePreviewInspectorVisibilityChange);
    mutationObserver?.disconnect();
    cancelPreviewInspectorRefreshScheduling();
    for (const element of previewInspectorSession.highlightedElements ?? []) {
      restorePreviewInspectorOutline(element);
    }
    previewInspectorSession.highlightedElements = new Set();
    previewInspectorSession.boundariesByExport.clear();
    previewInspectorSession.manualElementsByExport.clear();
    previewInspectorSession.lastTreeSnapshot = undefined;
    previewInspectorSession.treeDirty = true;
    previewInspectorSession.pickerCandidate = undefined;
    previewInspectorSession.pickerEnabled = false;
  };
}
`;
}
