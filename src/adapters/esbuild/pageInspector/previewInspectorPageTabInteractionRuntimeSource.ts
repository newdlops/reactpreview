/** Preserves a trusted page-tab selection after the exact target has already verified output. */

/** Generates ephemeral DOM ownership checks; it never changes selection or reports target output. */
export function createPreviewInspectorPageTabInteractionRuntimeSource(): string {
  return String.raw`
/** Accepts explicit ARIA ownership or the unambiguous adjacent tab-content layout used by Tabs. */
function doesPreviewInspectorPageTabControlTarget(sourceTab, tablist, element) {
  const panelId = sourceTab.getAttribute('aria-controls');
  if (panelId !== null) {
    const panel = typeof panelId === 'string' && panelId.length > 0 && panelId.length <= 2048
      ? document.getElementById(panelId) : undefined;
    return panel?.getAttribute('role') === 'tabpanel' &&
      panel.getAttribute('aria-labelledby') === sourceTab.id && panel.contains(element);
  }
  // Some authored Tabs omit IDs. Do not guess from labels or position among unrelated panels:
  // the exact target must occupy the sole visible direct panel immediately following this tablist.
  const panel = element?.closest?.('[role="tabpanel"]');
  const content = panel?.parentElement;
  if (!content || tablist.nextElementSibling !== content ||
    readPreviewInspectorPageTabEventKey(sourceTab) === undefined || content.children.length > 64)
    return false;
  const visible = [...content.children].filter(child => {
    if (child.getAttribute('role') !== 'tabpanel' ||
      child.closest?.('[hidden], [inert], [aria-hidden="true"]') != null) return false;
    const style = getComputedStyle(child);
    return style.display !== 'none' && style.visibility !== 'hidden';
  });
  return visible.length === 1 && visible[0] === panel;
}

/** Reobserves a real tab transition at most four times; no page state or selection is changed. */
function schedulePreviewInspectorPageTabObservation(state, pass = 0) {
  if (state.pageTabObservationScheduled === true ||
    typeof evaluatePreviewInspectorTargetReachability !== 'function' ||
    typeof globalThis.setTimeout !== 'function') return;
  state.pageTabObservationScheduled = true;
  globalThis.setTimeout(() => {
    state.pageTabObservationScheduled = false;
    if (previewInspectorSession.activeTargetReachabilityKey !== state.key ||
      previewInspectorSession.targetReachabilityByKey?.get?.(state.key) !== state ||
      state.pageTabInteraction?.tablist?.isConnected !== true) return;
    const descriptor = findSelectedPreviewInspectorDescriptor();
    const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
    if (!descriptor || candidate?.id !== state.candidateId) return;
    evaluatePreviewInspectorTargetReachability(descriptor, candidate, state);
    if (state.pageTabInteraction?.changed === true &&
      state.pageTabInteraction.sourceTab.getAttribute('aria-selected') === 'true' &&
      state.targetHasOutput !== true && pass < 3) {
      schedulePreviewInspectorPageTabObservation(state, pass + 1);
    }
  }, 160);
}

/** Latches only a real click/key on the tablist controlling the exact target's current panel. */
function handlePreviewInspectorPageTabInteraction(event) {
  if (
    event?.isTrusted !== true || event.defaultPrevented === true ||
    event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
    previewInspectorSession.pickerEnabled === true ||
    (event.type === 'click' ? event.button !== 0 :
      event.type !== 'keydown' || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
  ) return;
  const state = previewInspectorSession.targetReachabilityByKey?.get?.(
    previewInspectorSession.activeTargetReachabilityKey,
  );
  if (state === undefined) return;
  const tab = event.target?.closest?.('[role="tab"]');
  const tablist = tab?.closest?.('[role="tablist"]');
  if (!tablist || !mountNode?.contains?.(tab) ||
    !isPreviewInspectorVisiblePageTab(tab, tablist)) return;
  if (state.pageTabInteraction?.tablist === tablist) {
    schedulePreviewInspectorPageTabObservation(state);
    return;
  }
  if (state.neuralStableOutputVerified !== true || state.pageRootCommitted !== true ||
    state.targetMounted !== true || state.targetHasOutput !== true) return;
  const tabs = tablist.querySelectorAll('[role="tab"]');
  if (tabs.length > 64) return;
  const selected = [...tabs].filter(candidate =>
    candidate.closest('[role="tablist"]') === tablist &&
    candidate.getAttribute('aria-selected') === 'true');
  if (selected.length !== 1) return;
  const sourceTab = selected[0];
  if (event.type === 'click' && sourceTab === tab) return;
  if (typeof readPreviewInspectorTargetBoundaries !== 'function' ||
    typeof collectPreviewInspectorFiberElements !== 'function') return;
  const boundaries = readPreviewInspectorTargetBoundaries(state);
  let checkedBoundaries = 0;
  for (const boundary of boundaries ?? []) {
    if (++checkedBoundaries > 16) break;
    const elements = collectPreviewInspectorFiberElements(boundary);
    if (!Array.isArray(elements)) continue;
    if (elements.slice(0, 64).some(element =>
      doesPreviewInspectorPageTabControlTarget(sourceTab, tablist, element))) {
      state.pageTabInteraction = { sourceTab, tablist };
      schedulePreviewInspectorPageTabObservation(state);
      return;
    }
  }
}

/** Yields only while that same connected tablist intentionally hides the previously verified panel. */
function isPreviewInspectorTargetHiddenByPageTabInteraction(state) {
  const interaction = state?.pageTabInteraction;
  if (interaction === undefined) return false;
  const { sourceTab, tablist } = interaction;
  if (
    tablist?.isConnected !== true || sourceTab?.isConnected !== true ||
    sourceTab.closest?.('[role="tablist"]') !== tablist
  ) {
    delete state.pageTabInteraction;
    return false;
  }
  if (state.pendingTargetRepairFailure !== undefined ||
    typeof hasPreviewInspectorTargetRenderError === 'function' &&
      hasPreviewInspectorTargetRenderError(state) ||
    typeof readPreviewInspectorRuntimeHealthTargetError === 'function' &&
      readPreviewInspectorRuntimeHealthTargetError(state.targetExportName) !== undefined) return false;
  if (sourceTab.getAttribute?.('aria-selected') !== 'false') {
    // The selected pane can still be entering. Keep ownership until the ordinary verifier sees it.
    if (interaction.changed === true && state.targetHasOutput !== true) return true;
    if (interaction.changed === true) delete state.pageTabInteraction;
    return false;
  }
  const tabs = tablist.querySelectorAll('[role="tab"]');
  if (tabs.length > 64) return false;
  const selected = [...tabs].filter(tab =>
    tab !== sourceTab && tab.closest('[role="tablist"]') === tablist &&
    tab.getAttribute('aria-selected') === 'true' &&
    isPreviewInspectorVisiblePageTab(tab, tablist));
  if (selected.length !== 1) return false;
  interaction.changed = true;
  return true;
}
`;
}
