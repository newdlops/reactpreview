/**
 * Generates Page Inspector host-element selection, highlighting, and reversible visual hiding.
 *
 * React Fiber remains read-only. The runtime remembers a bounded locator for an explicitly picked
 * DOM element and marks that exact host with an extension-owned attribute. A document stylesheet
 * removes marked hosts from layout while React keeps owning and updating the original node.
 */

/** Maximum number of user-hidden hosts retained by one pinned preview tab. */
export const PREVIEW_INSPECTOR_HIDDEN_ELEMENT_LIMIT = 128;

/**
 * Creates browser source for picker/highlight behavior and per-element visibility overrides.
 *
 * Expected lexical bindings include the Inspector session, Fiber snapshot helpers, refresh
 * schedulers, ReactDOM namespace, page-candidate helpers, and persistence functions declared by the
 * composed Page Inspector runtime. Hidden records live only in `previewHotRuntime.inspectorSession`:
 * they survive hot replacement, but never modify source files or leak into another preview tab.
 *
 * @returns Plain JavaScript source evaluated inside the preview webview.
 */
export function createPreviewInspectorElementVisibilityRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_HIDDEN_ELEMENT_LIMIT = ${PREVIEW_INSPECTOR_HIDDEN_ELEMENT_LIMIT};
const PREVIEW_INSPECTOR_HIDDEN_ATTRIBUTE = 'data-newdlops-react-preview-hidden';
const PREVIEW_INSPECTOR_HIDDEN_ID_PREFIX = 'rpi-hidden-';
const PREVIEW_INSPECTOR_HIDDEN_PATH_LIMIT = 64;
const PREVIEW_INSPECTOR_HIDDEN_IDENTITY_ATTRIBUTES = ['id', 'data-testid', 'name', 'aria-label'];

/** Returns the hot-session visibility registry without serializing live DOM references. */
function readPreviewInspectorHiddenElementRecords() {
  if (!(previewInspectorSession.hiddenElementRecords instanceof Map)) {
    previewInspectorSession.hiddenElementRecords = new Map();
  }
  return previewInspectorSession.hiddenElementRecords;
}

/** Invalidates only the DOM-free summary index after a user adds or removes a hidden record. */
function markPreviewInspectorHiddenElementRecordsChanged() {
  previewInspectorSession.hiddenElementRevision =
    (previewInspectorSession.hiddenElementRevision ?? 0) + 1;
  previewInspectorSession.hiddenElementSummaryCache = undefined;
  synchronizePreviewInspectorHiddenElementStyle();
}

/** Retains the once-per-refresh page identity so thousands of tree rows use an O(1) count lookup. */
function retainPreviewInspectorHiddenElementContextKey(contextKey) {
  if (previewInspectorSession.hiddenElementContextKey === contextKey) return;
  previewInspectorSession.hiddenElementContextKey = contextKey;
  previewInspectorSession.hiddenElementSummaryCache = undefined;
}

/** Produces one fail-closed rule containing only opaque IDs currently owned by this session. */
function createPreviewInspectorHiddenElementCss(records) {
  if (records.size === 0) return '';
  return [...records.keys()].map(
    (id) => '[' + PREVIEW_INSPECTOR_HIDDEN_ATTRIBUTE + '="' + id + '"]',
  ).join(',') + '{display:none!important}';
}

/** Creates the one document-level rule used to remove marked project hosts from layout. */
function ensurePreviewInspectorHiddenElementStyle() {
  const retained = previewHotRuntime.inspectorHiddenElementStyle;
  if (retained?.isConnected !== false && retained?.parentNode !== null && retained !== undefined) {
    return retained;
  }
  const style = document.createElement('style');
  style.setAttribute(PREVIEW_INSPECTOR_UI_ATTRIBUTE, 'hidden-element-style');
  style.textContent = createPreviewInspectorHiddenElementCss(
    readPreviewInspectorHiddenElementRecords(),
  );
  (document.head ?? document.documentElement ?? document.body)?.append?.(style);
  previewHotRuntime.inspectorHiddenElementStyle = style;
  return style;
}

/** Limits the active CSS selector to opaque IDs that still exist, removing it at zero records. */
function synchronizePreviewInspectorHiddenElementStyle() {
  const records = readPreviewInspectorHiddenElementRecords();
  if (records.size === 0) {
    const retained = previewHotRuntime.inspectorHiddenElementStyle;
    try { retained?.remove?.(); } catch { /* Detached style cleanup is best effort. */ }
    previewHotRuntime.inspectorHiddenElementStyle = undefined;
    return;
  }
  const style = ensurePreviewInspectorHiddenElementStyle();
  const css = createPreviewInspectorHiddenElementCss(records);
  if (style.textContent !== css) style.textContent = css;
}

/** Reads one bounded host attribute without trusting project-defined wrapper objects. */
function readPreviewInspectorHiddenElementAttribute(element, name) {
  try {
    const value = element?.getAttribute?.(name);
    return typeof value === 'string' && value.length <= 240 ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Produces a lowercase host tag token shared by locator creation and validation. */
function readPreviewInspectorHiddenElementTag(element) {
  const tag = element?.localName ?? element?.tagName;
  return typeof tag === 'string' && tag.length > 0 ? tag.toLocaleLowerCase() : 'element';
}

/** Retains only strong authored attributes; volatile class/style strings are deliberately omitted. */
function readPreviewInspectorHiddenElementIdentity(element) {
  const identity = {};
  for (const name of PREVIEW_INSPECTOR_HIDDEN_IDENTITY_ATTRIBUTES) {
    const value = readPreviewInspectorHiddenElementAttribute(element, name);
    if (value !== undefined && value.length > 0) identity[name] = value;
  }
  return identity;
}

/** Verifies tag and strong authored attributes before reapplying a hide after a React remount. */
function matchesPreviewInspectorHiddenElementIdentity(element, locator) {
  if (readPreviewInspectorHiddenElementTag(element) !== locator?.tagName) return false;
  const identity = locator?.identity;
  if (identity === null || typeof identity !== 'object') return true;
  return Object.entries(identity).every(
    ([name, value]) => readPreviewInspectorHiddenElementAttribute(element, name) === value,
  );
}

/** Returns an element-only child array without retaining a live collection in session state. */
function readPreviewInspectorHiddenElementChildren(element) {
  try {
    return Array.from(element?.children ?? []).filter((child) => child?.nodeType === 1);
  } catch {
    return [];
  }
}

/** Builds a bounded child-index path from one component host root to the exact picked host. */
function createPreviewInspectorHiddenElementPath(root, element) {
  if (root === element) return [];
  const reversed = [];
  const visited = new Set();
  let current = element;
  while (
    current !== undefined &&
    current !== null &&
    current !== root &&
    reversed.length < PREVIEW_INSPECTOR_HIDDEN_PATH_LIMIT &&
    !visited.has(current)
  ) {
    visited.add(current);
    const parent = current.parentElement;
    if (parent === undefined || parent === null) return undefined;
    const index = readPreviewInspectorHiddenElementChildren(parent).indexOf(current);
    if (index < 0) return undefined;
    reversed.push({ index, tagName: readPreviewInspectorHiddenElementTag(current) });
    current = parent;
  }
  if (current !== root) return undefined;
  return reversed.reverse();
}

/** Confines a hidden record to one authored page candidate while allowing export-row selection. */
function createPreviewInspectorHiddenElementContextKey() {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const root = candidate?.root ?? descriptor?.inspector?.root;
  return [
    readPreviewInspectorRenderScenario(),
    candidate?.id ?? '',
    root?.sourcePath ?? '',
    root?.exportName ?? '',
  ].map((value) => String(value)).join('\u0000');
}

/** Creates a remount-safe locator from Fiber ownership plus an exact host-relative DOM path. */
function createPreviewInspectorHiddenElementLocator(element, selection) {
  const hostRoots = Array.isArray(selection?.hostNodes) ? selection.hostNodes : [];
  for (let hostRootIndex = 0; hostRootIndex < hostRoots.length; hostRootIndex += 1) {
    const root = normalizePreviewInspectorHostElement(hostRoots[hostRootIndex]);
    if (root === undefined) continue;
    let contains = root === element;
    if (!contains) {
      try { contains = root.contains?.(element) === true; } catch { contains = false; }
    }
    if (!contains) continue;
    const elementPath = createPreviewInspectorHiddenElementPath(root, element);
    if (elementPath === undefined) continue;
    const identity = readPreviewInspectorHiddenElementIdentity(element);
    return {
      contextKey: createPreviewInspectorHiddenElementContextKey(),
      elementPath,
      hostRootIndex,
      identity,
      remountSafe: elementPath.length === 0 || Object.keys(identity).length > 0,
      rootTagName: readPreviewInspectorHiddenElementTag(root),
      tagName: readPreviewInspectorHiddenElementTag(element),
      treeNodeId: selection.node.id,
    };
  }
  return {
    contextKey: createPreviewInspectorHiddenElementContextKey(),
    identity: readPreviewInspectorHiddenElementIdentity(element),
    tagName: readPreviewInspectorHiddenElementTag(element),
  };
}

/** Resolves one retained locator against the newest connected Fiber host-root index. */
function resolvePreviewInspectorHiddenElementLocator(locator, snapshot) {
  if (
    locator?.remountSafe !== true ||
    typeof locator?.treeNodeId !== 'string' ||
    !Number.isSafeInteger(locator?.hostRootIndex) ||
    !Array.isArray(locator?.elementPath)
  ) return undefined;
  const selection = selectPreviewInspectorFiberTreeNode(snapshot, locator.treeNodeId);
  const root = normalizePreviewInspectorHostElement(
    selection?.hostNodes?.[locator.hostRootIndex],
  );
  if (
    root === undefined ||
    readPreviewInspectorHiddenElementTag(root) !== locator.rootTagName
  ) return undefined;
  let current = root;
  for (const step of locator.elementPath) {
    if (!Number.isSafeInteger(step?.index) || step.index < 0) return undefined;
    current = readPreviewInspectorHiddenElementChildren(current)[step.index];
    if (current === undefined || readPreviewInspectorHiddenElementTag(current) !== step.tagName) {
      return undefined;
    }
  }
  return matchesPreviewInspectorHiddenElementIdentity(current, locator) ? current : undefined;
}

/** Creates a concise label without copying project text content or user data into Inspector state. */
function describePreviewInspectorHiddenElement(element, selection) {
  const tagName = readPreviewInspectorHiddenElementTag(element);
  const id = readPreviewInspectorHiddenElementAttribute(element, 'id');
  const testId = readPreviewInspectorHiddenElementAttribute(element, 'data-testid');
  const suffix = id !== undefined ? '#' + id : testId !== undefined ? '[data-testid="' + testId + '"]' : '';
  return (selection?.node?.name ? selection.node.name + ' · ' : '') + tagName + suffix;
}

/** Remembers the exact host clicked by Pick on page before component-level selection replaces it. */
function rememberPreviewInspectorPickedElement(element, snapshot, selection) {
  const normalized = normalizePreviewInspectorHostElement(element);
  if (normalized === undefined || isPreviewInspectorUiElement(normalized)) return;
  const locator = createPreviewInspectorHiddenElementLocator(normalized, selection);
  retainPreviewInspectorHiddenElementContextKey(locator.contextKey);
  previewInspectorSession.lastPickedElement = {
    element: normalized,
    label: describePreviewInspectorHiddenElement(normalized, selection),
    locator,
  };
}

/** Returns whether the latest exact pick can create a distinct visual-hide record. */
function canHidePreviewInspectorPickedElement() {
  const picked = previewInspectorSession.lastPickedElement;
  if (
    typeof picked?.locator?.contextKey === 'string' &&
    picked.locator.contextKey !== createPreviewInspectorHiddenElementContextKey()
  ) return false;
  const element = normalizePreviewInspectorHostElement(picked?.element);
  if (element === undefined || element?.isConnected === false || isPreviewInspectorUiElement(element)) {
    return false;
  }
  return ![...readPreviewInspectorHiddenElementRecords().values()].some(
    (record) => record.element === element,
  );
}

/** Applies one reversible marker while leaving React props, Fiber, children, and listeners intact. */
function applyPreviewInspectorHiddenElementRecord(record, element) {
  if (record.element !== undefined && record.element !== element) {
    releasePreviewInspectorHiddenElementRecord(record);
  }
  ensurePreviewInspectorHiddenElementStyle();
  if (record.element !== element) {
    record.element = element;
    record.previousAttribute = readPreviewInspectorHiddenElementAttribute(
      element,
      PREVIEW_INSPECTOR_HIDDEN_ATTRIBUTE,
    );
  }
  try { element.setAttribute(PREVIEW_INSPECTOR_HIDDEN_ATTRIBUTE, record.id); } catch { return false; }
  return true;
}

/** Removes only this extension's marker and restores a pre-existing colliding attribute exactly. */
function releasePreviewInspectorHiddenElementRecord(record) {
  const element = record?.element;
  if (element !== undefined) {
    try {
      if (element.getAttribute?.(PREVIEW_INSPECTOR_HIDDEN_ATTRIBUTE) === record.id) {
        if (record.previousAttribute === undefined) {
          element.removeAttribute?.(PREVIEW_INSPECTOR_HIDDEN_ATTRIBUTE);
        } else {
          element.setAttribute?.(PREVIEW_INSPECTOR_HIDDEN_ATTRIBUTE, record.previousAttribute);
        }
      }
    } catch {
      // A project may remove or replace the host before the Inspector releases its marker.
    }
  }
  record.element = undefined;
  record.previousAttribute = undefined;
}

/** Hides the latest picked host and consumes that pick so repeated clicks cannot add duplicates. */
function hidePreviewInspectorPickedElement() {
  const picked = previewInspectorSession.lastPickedElement;
  if (
    typeof picked?.locator?.contextKey === 'string' &&
    picked.locator.contextKey !== createPreviewInspectorHiddenElementContextKey()
  ) return false;
  let element = normalizePreviewInspectorHostElement(picked?.element);
  if (element?.isConnected === false && picked?.locator !== undefined) {
    element = resolvePreviewInspectorHiddenElementLocator(
      picked.locator,
      collectPreviewInspectorTreeSnapshot(),
    );
  }
  if (element === undefined || isPreviewInspectorUiElement(element)) return false;
  const records = readPreviewInspectorHiddenElementRecords();
  if ([...records.values()].some((record) => record.element === element)) return false;
  const sequence = (previewInspectorSession.hiddenElementSequence ?? 0) + 1;
  previewInspectorSession.hiddenElementSequence = sequence;
  const id = PREVIEW_INSPECTOR_HIDDEN_ID_PREFIX + String(sequence);
  const record = {
    contextKey: picked?.locator?.contextKey ?? createPreviewInspectorHiddenElementContextKey(),
    element: undefined,
    id,
    label: picked?.label ?? describePreviewInspectorHiddenElement(element),
    locator: picked?.locator ?? createPreviewInspectorHiddenElementLocator(element),
    previousAttribute: undefined,
  };
  if (!applyPreviewInspectorHiddenElementRecord(record, element)) return false;
  records.set(id, record);
  markPreviewInspectorHiddenElementRecordsChanged();
  while (records.size > PREVIEW_INSPECTOR_HIDDEN_ELEMENT_LIMIT) {
    const oldestId = records.keys().next().value;
    if (typeof oldestId !== 'string') break;
    restorePreviewInspectorHiddenElement(oldestId);
  }
  previewInspectorSession.lastPickedElement = undefined;
  previewInspectorSession.pickerCandidate = undefined;
  previewInspectorSession.pickerEnabled = true;
  schedulePreviewInspectorTreeRefresh();
  schedulePreviewInspectorHighlight();
  return true;
}

/** Restores one hidden host by opaque Inspector ID without accepting a CSS selector from the page. */
function restorePreviewInspectorHiddenElement(id) {
  const records = readPreviewInspectorHiddenElementRecords();
  const record = records.get(id);
  if (record === undefined) return false;
  releasePreviewInspectorHiddenElementRecord(record);
  records.delete(id);
  markPreviewInspectorHiddenElementRecordsChanged();
  schedulePreviewInspectorTreeRefresh();
  schedulePreviewInspectorHighlight();
  return true;
}

/** Restores the most recently hidden host in the current page context. */
function restoreLastPreviewInspectorHiddenElement() {
  const records = [...readPreviewInspectorHiddenElementRecords().values()];
  const contextKey = createPreviewInspectorHiddenElementContextKey();
  const record = [...records].reverse().find((candidate) => candidate.contextKey === contextKey) ?? records.at(-1);
  return record === undefined ? false : restorePreviewInspectorHiddenElement(record.id);
}

/** Restores every host hidden in this pinned preview session. */
function restoreAllPreviewInspectorHiddenElements() {
  const ids = [...readPreviewInspectorHiddenElementRecords().keys()];
  for (const id of ids) restorePreviewInspectorHiddenElement(id);
  return ids.length;
}

/** Builds one revision/context index shared by the toolbar and every component-tree row. */
function readPreviewInspectorHiddenElementSummaryCache() {
  const records = readPreviewInspectorHiddenElementRecords();
  const revision = previewInspectorSession.hiddenElementRevision ?? 0;
  const retained = previewInspectorSession.hiddenElementSummaryCache;
  const retainedContextKey = previewInspectorSession.hiddenElementContextKey;
  if (retained?.contextKey === retainedContextKey && retained?.revision === revision) return retained;
  const contextKey = retainedContextKey ?? createPreviewInspectorHiddenElementContextKey();
  retainPreviewInspectorHiddenElementContextKey(contextKey);
  const countByTreeNodeId = new Map();
  const summaries = [...records.values()].filter((record) => record.contextKey === contextKey).map((record) => {
    const treeNodeId = record.locator?.treeNodeId;
    if (typeof treeNodeId === 'string') {
      countByTreeNodeId.set(treeNodeId, (countByTreeNodeId.get(treeNodeId) ?? 0) + 1);
    }
    return {
      id: record.id,
      label: record.label,
      treeNodeId,
    };
  });
  const cache = { contextKey, countByTreeNodeId, revision, summaries };
  previewInspectorSession.hiddenElementSummaryCache = cache;
  return cache;
}

/** Returns bounded, DOM-free records for toolbar controls. */
function readPreviewInspectorHiddenElementSummaries() {
  if (readPreviewInspectorHiddenElementRecords().size === 0) return [];
  return readPreviewInspectorHiddenElementSummaryCache().summaries;
}

/** Counts exact hidden hosts owned by one current component-tree row. */
function countPreviewInspectorHiddenElementsForTreeNode(treeNodeId) {
  if (readPreviewInspectorHiddenElementRecords().size === 0) return 0;
  return readPreviewInspectorHiddenElementSummaryCache().countByTreeNodeId.get(treeNodeId) ?? 0;
}

/** Rebinds retained locators after HMR/remount and fails closed when structure no longer matches. */
function reconcilePreviewInspectorHiddenElements() {
  const records = readPreviewInspectorHiddenElementRecords();
  if (records.size === 0 && previewInspectorSession.lastPickedElement === undefined) return;
  if (records.size > 0) synchronizePreviewInspectorHiddenElementStyle();
  const contextKey = createPreviewInspectorHiddenElementContextKey();
  retainPreviewInspectorHiddenElementContextKey(contextKey);
  let snapshot;
  for (const record of records.values()) {
    if (record.contextKey !== contextKey) {
      releasePreviewInspectorHiddenElementRecord(record);
      continue;
    }
    if (record.element?.isConnected !== false && record.element !== undefined) {
      applyPreviewInspectorHiddenElementRecord(record, record.element);
      continue;
    }
    snapshot ??= collectPreviewInspectorTreeSnapshot();
    const replacement = resolvePreviewInspectorHiddenElementLocator(record.locator, snapshot);
    if (replacement !== undefined) applyPreviewInspectorHiddenElementRecord(record, replacement);
  }
  const picked = previewInspectorSession.lastPickedElement;
  if (picked?.element?.isConnected === false && picked.locator?.contextKey === contextKey) {
    snapshot ??= collectPreviewInspectorTreeSnapshot();
    const replacement = resolvePreviewInspectorHiddenElementLocator(picked.locator, snapshot);
    if (replacement !== undefined) picked.element = replacement;
  }
}

/** Enables or disables target highlighting and restores every prior inline outline when disabled. */
function setPreviewInspectorHighlightEnabled(enabled) {
  previewInspectorSession.highlightEnabled = enabled === true;
  persistPreviewInspectorState();
  schedulePreviewInspectorTreeRefresh();
  schedulePreviewInspectorHighlight();
}

/** Accepts an explicit host element from future source instrumentation or the manual picker. */
function registerPreviewInspectorTargetElement(exportName, element) {
  const normalized = normalizePreviewInspectorHostElement(element);
  if (normalized === undefined) return () => undefined;
  const elements = previewInspectorSession.manualElementsByExport.get(exportName) ?? new Set();
  elements.add(normalized);
  previewInspectorSession.manualElementsByExport.set(exportName, elements);
  schedulePreviewInspectorHighlight();
  return () => {
    elements.delete(normalized);
    schedulePreviewInspectorHighlight();
  };
}

/** Converts an element or text node into a measurable connected host element. */
function normalizePreviewInspectorHostElement(value) {
  if (
    value !== null &&
    typeof value === 'object' &&
    value.nodeType === 1 &&
    typeof value.getBoundingClientRect === 'function'
  ) return value;
  const parentElement = value?.parentElement;
  return parentElement?.nodeType === 1 && typeof parentElement.getBoundingClientRect === 'function'
    ? parentElement
    : undefined;
}

/** Uses read-only tree lookup first and admits legacy findDOMNode as a public-version fallback. */
function collectPreviewInspectorBoundaryElements(boundary) {
  const fiberElements = collectPreviewInspectorFiberElements(boundary);
  if (fiberElements.length > 0) return fiberElements;
  const findDOMNode = ReactDOMNamespace.findDOMNode;
  if (typeof findDOMNode !== 'function') return [];
  try {
    const element = normalizePreviewInspectorHostElement(findDOMNode(boundary));
    return element === undefined ? [] : [element];
  } catch {
    return [];
  }
}

/**
 * Resolves a DevTools row selection back to its connected top-level host roots.
 *
 * The tuple's second value permits legacy export fallback only for a non-explicit static selection.
 * An explicit pseudo/static row instead returns an authoritative empty host set, which clears the
 * previous outline rather than highlighting the active export as if it owned that source row.
 */
function collectSelectedPreviewInspectorTreeElements() {
  const nodeId = previewInspectorSession.selectedTreeNodeId;
  if (typeof nodeId !== 'string') return undefined;
  const snapshot = previewInspectorSession.lastTreeSnapshot ?? collectPreviewInspectorTreeSnapshot();
  const selection = selectPreviewInspectorFiberTreeNode(snapshot, nodeId);
  const explicit = previewInspectorSession.explicitTreeSelectionId === nodeId;
  if (selection === undefined) return explicit ? [[], false] : undefined;
  return [selection.hostNodes, snapshot.status === 'static' && !explicit];
}

/** Collects connected target elements for highlighting without traversing React internals. */
function collectSelectedPreviewInspectorElements() {
  const exportName = previewInspectorSession.selectedExportName;
  if (previewInspectorSession.pickerCandidate !== undefined) {
    return [previewInspectorSession.pickerCandidate];
  }
  const treeSelection = collectSelectedPreviewInspectorTreeElements();
  if (treeSelection !== undefined && (treeSelection[0].length > 0 || !treeSelection[1])) {
    return treeSelection[0];
  }
  const collected = [];
  for (const boundary of previewInspectorSession.boundariesByExport.get(exportName) ?? []) {
    collected.push(...collectPreviewInspectorBoundaryElements(boundary));
  }
  for (const element of previewInspectorSession.manualElementsByExport.get(exportName) ?? []) {
    collected.push(element);
  }
  return [...new Set(collected)].filter(
    (element) => element?.isConnected !== false && !isPreviewInspectorUiElement(element),
  );
}

/** Detects toolbar, marker, and highlight nodes so picker actions ignore extension chrome. */
function isPreviewInspectorUiElement(element) {
  return typeof element?.closest === 'function' &&
    element.closest('[' + PREVIEW_INSPECTOR_UI_ATTRIBUTE + ']') !== null;
}

/** Saves and applies an important outline without changing the target's box dimensions. */
function applyPreviewInspectorOutline(element) {
  if (element.__reactPreviewInspectorOutline !== undefined) return;
  element.__reactPreviewInspectorOutline = {
    offset: element.style.getPropertyValue('outline-offset'),
    offsetPriority: element.style.getPropertyPriority('outline-offset'),
    outline: element.style.getPropertyValue('outline'),
    outlinePriority: element.style.getPropertyPriority('outline'),
  };
  element.style.setProperty('outline', '2px solid #f2c94c', 'important');
  element.style.setProperty('outline-offset', '2px', 'important');
}

/** Restores the exact inline outline values and priorities that existed before highlighting. */
function restorePreviewInspectorOutline(element) {
  const previous = element.__reactPreviewInspectorOutline;
  if (previous === undefined) return;
  if (previous.outline.length === 0) element.style.removeProperty('outline');
  else element.style.setProperty('outline', previous.outline, previous.outlinePriority);
  if (previous.offset.length === 0) element.style.removeProperty('outline-offset');
  else element.style.setProperty('outline-offset', previous.offset, previous.offsetPriority);
  delete element.__reactPreviewInspectorOutline;
}

/** Reconciles the highlighted host set and exposes a concise capability status to the toolbar. */
function refreshPreviewInspectorHighlight() {
  const nextElements = previewInspectorSession.highlightEnabled
    ? collectSelectedPreviewInspectorElements()
    : [];
  const previousElements = previewInspectorSession.highlightedElements ?? new Set();
  const nextElementSet = new Set(nextElements);
  for (const element of previousElements) {
    if (!nextElementSet.has(element)) restorePreviewInspectorOutline(element);
  }
  for (const element of nextElementSet) applyPreviewInspectorOutline(element);
  previewInspectorSession.highlightedElements = nextElementSet;
  const nextStatus = !previewInspectorSession.highlightEnabled
    ? 'Component highlight is off.'
    : nextElementSet.size > 0
      ? 'Highlighting ' + String(nextElementSet.size) + ' selected component host node(s).'
      : 'No selected component host node yet. Render it or use Pick element.';
  if (nextStatus !== previewInspectorSession.highlightStatus) {
    previewInspectorSession.highlightStatus = nextStatus;
    schedulePreviewInspectorTreeRefresh();
  }
}

/** Enables one-shot DOM selection while leaving normal application interaction untouched otherwise. */
function setPreviewInspectorPickerEnabled(enabled) {
  previewInspectorSession.pickerEnabled = enabled === true;
  previewInspectorSession.pickerCandidate = undefined;
  schedulePreviewInspectorTreeRefresh();
  schedulePreviewInspectorHighlight();
}

/** Tracks a picker candidate without changing component props or application state. */
function handlePreviewInspectorPointerMove(event) {
  if (!previewInspectorSession.pickerEnabled) return;
  const candidate = normalizePreviewInspectorHostElement(event.target);
  if (candidate === undefined || isPreviewInspectorUiElement(candidate)) return;
  previewInspectorSession.pickerCandidate = candidate;
  schedulePreviewInspectorHighlight();
}

/** Maps a picked DOM host to its nearest component while retaining the exact host for hiding. */
function handlePreviewInspectorPick(event) {
  if (!previewInspectorSession.pickerEnabled) return;
  const candidate = normalizePreviewInspectorHostElement(event.target);
  if (candidate === undefined || isPreviewInspectorUiElement(candidate)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  previewInspectorSession.pickerCandidate = undefined;
  previewInspectorSession.pickerEnabled = false;
  const snapshot = collectPreviewInspectorTreeSnapshot();
  const selection = findPreviewInspectorFiberTreeNodeByHost(snapshot, candidate);
  rememberPreviewInspectorPickedElement(candidate, snapshot, selection);
  if (selection === undefined) {
    previewInspectorSession.selectedTreeNodeId = undefined;
    registerPreviewInspectorTargetElement(previewInspectorSession.selectedExportName, candidate);
  } else {
    previewInspectorSession.selectedTreeNodeId = selection.node.id;
    requestPreviewInspectorTreeReveal(selection.node.id);
    const exportName = selection.node.exportName;
    if (
      typeof exportName === 'string' &&
      previewInspectorSession.descriptorNames.includes(exportName)
    ) previewInspectorSession.selectedExportName = exportName;
    previewInspectorSession.lastTreeSnapshot = snapshot;
    persistPreviewInspectorState();
  }
  schedulePreviewInspectorTreeRefresh();
  schedulePreviewInspectorHighlight();
}
`;
}
