/** Generates exact, bounded activation for a selected target hidden behind authored page tabs. */

/**
 * Creates browser source that activates only a standard tab whose event key was read from an exact
 * compiler-proven JSX ancestor. Arbitrary tabs, buttons, links, labels, and dynamic keys are never
 * used as traversal guesses.
 */
export function createPreviewInspectorPageTabActivationRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_TARGET_PAGE_TAB_ACTIVATION_LIMIT = 16;
const PREVIEW_INSPECTOR_TARGET_PAGE_TAB_KEY_ATTEMPT_LIMIT = 4;

/** Reads the bounded compiler-owned outer-to-inner tab sequence from target state. */
function readPreviewInspectorTargetPageTabKeys(state) {
  return Array.isArray(state?.targetPageTabKeys)
    ? [...new Set(state.targetPageTabKeys.filter((value) =>
        typeof value === 'string' && value.length > 0 && value.length <= 128,
      ))].slice(0, 8)
    : [];
}

/** Reads only event-key attributes emitted by standard React tab implementations. */
function readPreviewInspectorPageTabEventKey(tab) {
  for (const attributeName of [
    'data-rb-event-key',
    'data-rr-ui-event-key',
    'data-event-key',
  ]) {
    const value = tab?.getAttribute?.(attributeName);
    if (typeof value === 'string' && value.length > 0 && value.length <= 128) return value;
  }
  return undefined;
}

/** Accepts only a visible, enabled WAI-ARIA tab belonging to its nearest tablist. */
function isPreviewInspectorVisiblePageTab(tab, tablist) {
  if (
    tab?.isConnected === false ||
    tab?.getAttribute?.('role') !== 'tab' ||
    tab?.getAttribute?.('aria-disabled') === 'true' ||
    tab?.disabled === true ||
    tab?.closest?.('[role="tablist"]') !== tablist ||
    tab?.closest?.('[hidden], [inert], [aria-hidden="true"]') !== null
  ) return false;
  const style = typeof globalThis.getComputedStyle === 'function'
    ? globalThis.getComputedStyle(tab)
    : undefined;
  return style?.display !== 'none' && style?.visibility !== 'hidden';
}

/** Collects visible standard tabs without crossing their owning tablist boundary. */
function readPreviewInspectorVisiblePageTabs() {
  if (typeof globalThis.document?.querySelectorAll !== 'function') return [];
  try {
    return [...globalThis.document.querySelectorAll('[role="tablist"]')].flatMap((tablist) =>
      [...(tablist?.querySelectorAll?.('[role="tab"]') ?? [])]
        .filter((tab) => isPreviewInspectorVisiblePageTab(tab, tablist)),
    );
  } catch {
    return [];
  }
}

/**
 * Activates at most one exact authored tab for one settled page pass.
 *
 * An outer selected tab is skipped so a later pass may reach its nested key. Duplicate DOM keys
 * fail closed because static JSX evidence does not identify which duplicated control is correct.
 */
function autoActivatePreviewInspectorTargetPageTab(state) {
  const targetPageTabKeys = readPreviewInspectorTargetPageTabKeys(state);
  if (
    state === undefined ||
    state.pageRootCommitted !== true ||
    state.targetMounted === true ||
    state.targetWasMounted === true ||
    state.directTarget === true ||
    targetPageTabKeys.length === 0 ||
    (state.pageTabActivationCount ?? 0) >= PREVIEW_INSPECTOR_TARGET_PAGE_TAB_ACTIVATION_LIMIT
  ) return undefined;
  const tabs = readPreviewInspectorVisiblePageTabs();
  const attempts = state.pageTabActivationCountsByKey instanceof Map
    ? state.pageTabActivationCountsByKey
    : new Map();
  state.pageTabActivationCountsByKey = attempts;
  for (const eventKey of targetPageTabKeys) {
    const matches = tabs.filter((tab) => readPreviewInspectorPageTabEventKey(tab) === eventKey);
    if (matches.length !== 1) return undefined;
    const tab = matches[0];
    if (tab?.getAttribute?.('aria-selected') === 'true') continue;
    if (
      tab?.getAttribute?.('aria-selected') !== 'false' ||
      typeof tab?.click !== 'function' ||
      (attempts.get(eventKey) ?? 0) >= PREVIEW_INSPECTOR_TARGET_PAGE_TAB_KEY_ATTEMPT_LIMIT
    ) return undefined;
    try {
      tab.click();
    } catch {
      return undefined;
    }
    attempts.set(eventKey, (attempts.get(eventKey) ?? 0) + 1);
    state.pageTabActivationCount = (state.pageTabActivationCount ?? 0) + 1;
    const label = String(tab.textContent ?? '').replace(/\s+/gu, ' ').trim().slice(0, 120);
    if (typeof recordPreviewInspectorBlockerAutoDecision === 'function') {
      recordPreviewInspectorBlockerAutoDecision({
        action: 'Activate exact selected target page tab',
        blockerId: 'target-page-tab:' + state.key,
        blockerKind: 'target-reachability',
        blockerName: 'Target hidden by inactive page tab · ' + state.targetExportName,
        generatedPaths: ['eventKey:' + eventKey],
        mode: 'target-guided-auto',
        ownerName: state.rootName,
        reason: 'The exact compiler-proven JSX ancestor supplies this static tab event key',
        selectedValue: { eventKey, label },
        startsRenderAttempt: true,
        targetReachabilityKey: state.key,
      });
    }
    return { eventKey, label };
  }
  return undefined;
}
`;
}
