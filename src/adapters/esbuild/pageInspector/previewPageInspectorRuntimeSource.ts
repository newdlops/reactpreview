/**
 * Generates the browser-owned React Page Inspector runtime.
 *
 * The emitted source deliberately keeps inspector chrome outside the rendered application and
 * locates inspected host nodes without inserting marker elements into the application DOM. This
 * preserves table/list/SVG semantics as well as structural selectors such as `:first-child`.
 * A global Symbol protocol lets target facades register before or below an actual ancestor root.
 */
import { createPreviewInspectorFiberRuntimeSource } from './previewInspectorFiberRuntimeSource';
import { createPreviewInspectorTargetBoundaryRuntimeSource } from './previewInspectorTargetBoundaryRuntimeSource';

/** Global symbol description shared with the separately bundled target-facade runtime. */
export const PREVIEW_PAGE_INSPECTOR_API_SYMBOL = 'newdlops.react-file-preview.page-inspector';

/** Attribute placed only on Inspector-owned UI hosts so picker events ignore extension chrome. */
export const PREVIEW_PAGE_INSPECTOR_UI_ATTRIBUTE = 'data-react-preview-inspector-ui';

/**
 * Creates runtime source inserted into the generated browser entry in Page Inspector mode.
 *
 * Expected bindings in the generated entry are `React`, `ReactDOMNamespace`, `mountNode`, and
 * `previewHotRuntime`. Keeping those imports in the entry guarantees one project-owned React
 * instance and lets the session survive cache-busted hot-module replacements.
 *
 * @returns Plain JavaScript source safe to concatenate into the esbuild stdin entry.
 */
export function createPreviewPageInspectorRuntimeSource(): string {
  const fiberRuntimeSource = createPreviewInspectorFiberRuntimeSource();
  const targetBoundaryRuntimeSource = createPreviewInspectorTargetBoundaryRuntimeSource();
  return String.raw`
const PREVIEW_INSPECTOR_API_KEY = Symbol.for('newdlops.react-file-preview.page-inspector');
const PREVIEW_INSPECTOR_UI_ATTRIBUTE = 'data-react-preview-inspector-ui';
const PREVIEW_INSPECTOR_STATE_KEY = 'reactFilePreviewPageInspector';
const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);

${fiberRuntimeSource}

/** Reads the serializable inspector subset retained by VS Code across full webview reloads. */
function readPersistedPreviewInspectorState() {
  try {
    const webviewState = previewHotRuntime.vscodeApi?.getState?.();
    const inspectorState = webviewState?.[PREVIEW_INSPECTOR_STATE_KEY];
    return inspectorState !== null && typeof inspectorState === 'object'
      ? inspectorState
      : {};
  } catch {
    return {};
  }
}

/** Creates mutable session data once per pinned webview, not once per emitted bundle revision. */
function createPreviewInspectorSession() {
  const persisted = readPersistedPreviewInspectorState();
  const persistedOverrides =
    persisted.overrides !== null && typeof persisted.overrides === 'object'
      ? Object.entries(persisted.overrides)
      : [];
  return {
    basePropsByExport: new Map(),
    basePropsFingerprintByExport: new Map(),
    boundariesByExport: new Map(),
    descriptors: [],
    descriptorNames: [],
    highlightEnabled: persisted.highlightEnabled !== false,
    highlightStatus: 'Waiting for the inspected component to render.',
    listeners: new Set(),
    manualElementsByExport: new Map(),
    overridesByExport: new Map(
      persistedOverrides.filter(([, value]) => value !== null && typeof value === 'object'),
    ),
    pickerCandidate: undefined,
    pickerEnabled: false,
    propsRevisionByExport: new Map(),
    selectedExportName:
      typeof persisted.selectedExportName === 'string' ? persisted.selectedExportName : '',
    version: 0,
  };
}

const previewInspectorSession =
  previewHotRuntime.inspectorSession ?? createPreviewInspectorSession();
previewHotRuntime.inspectorSession = previewInspectorSession;

/** Returns a stable numeric snapshot for React.useSyncExternalStore. */
function getPreviewInspectorVersion() {
  return previewInspectorSession.version;
}

/** Subscribes a mounted inspector component and returns its exact cleanup operation. */
function subscribePreviewInspector(listener) {
  previewInspectorSession.listeners.add(listener);
  return () => previewInspectorSession.listeners.delete(listener);
}

/** Subscribes with public hooks available in React 16.8+ without requiring React 18 APIs. */
function usePreviewInspectorStore() {
  const [, setVersion] = React.useState(getPreviewInspectorVersion);
  React.useEffect(
    () => subscribePreviewInspector(() => setVersion(getPreviewInspectorVersion())),
    [],
  );
}

/** Notifies controls and inspected targets after one semantic session change. */
function notifyPreviewInspector() {
  previewInspectorSession.version += 1;
  for (const listener of [...previewInspectorSession.listeners]) {
    listener();
  }
}

/** Copies only safe own properties so JSON input cannot mutate an object's prototype. */
function normalizePreviewInspectorProps(value) {
  const normalized = Object.create(null);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return normalized;
  }
  for (const [name, propertyValue] of Object.entries(value)) {
    if (!blockedInspectorPropNames.has(name)) {
      normalized[name] = propertyValue;
    }
  }
  return normalized;
}

/** Produces bounded JSON for the editor while skipping functions, symbols, cycles, and prototypes. */
function stringifyPreviewInspectorProps(value) {
  const seen = new WeakSet();
  try {
    return JSON.stringify(
      value,
      (name, propertyValue) => {
        if (blockedInspectorPropNames.has(name)) {
          return undefined;
        }
        if (typeof propertyValue === 'bigint') {
          return propertyValue.toString();
        }
        if (
          propertyValue === undefined ||
          typeof propertyValue === 'function' ||
          typeof propertyValue === 'symbol'
        ) {
          return undefined;
        }
        if (propertyValue !== null && typeof propertyValue === 'object') {
          if (seen.has(propertyValue)) {
            return '[Circular]';
          }
          seen.add(propertyValue);
        }
        return propertyValue;
      },
      2,
    ) ?? '{}';
  } catch {
    return '{}';
  }
}

/** Persists user-authored controls without retaining DOM nodes or project function values. */
function persistPreviewInspectorState() {
  const vscodeApi = previewHotRuntime.vscodeApi;
  if (typeof vscodeApi?.setState !== 'function') {
    return;
  }
  const overrides = Object.fromEntries(
    [...previewInspectorSession.overridesByExport].map(([name, value]) => [
      name,
      JSON.parse(stringifyPreviewInspectorProps(value)),
    ]),
  );
  try {
    const currentState = vscodeApi.getState?.();
    vscodeApi.setState({
      ...(currentState !== null && typeof currentState === 'object' ? currentState : {}),
      [PREVIEW_INSPECTOR_STATE_KEY]: {
        highlightEnabled: previewInspectorSession.highlightEnabled,
        overrides,
        selectedExportName: previewInspectorSession.selectedExportName,
      },
    });
  } catch {
    // A host may reject values that became non-cloneable between normalization and persistence.
  }
}

/** Updates the export inventory while retaining a valid user selection across hot reloads. */
function setPreviewInspectorDescriptors(descriptors) {
  previewInspectorSession.descriptors = Array.isArray(descriptors) ? descriptors : [];
  const names = Array.isArray(descriptors)
    ? descriptors
        .map(
          (descriptor) =>
            descriptor?.inspector?.target?.exportName ??
            descriptor?.inspectedExportName ??
            descriptor?.exportName,
        )
        .filter((name) => typeof name === 'string' && name.length > 0)
    : [];
  const rootNames = previewInspectorSession.descriptors.flatMap((descriptor) => {
    const root = descriptor?.inspector?.root;
    if (root === undefined) return [];
    const rootName = createPreviewInspectorRootName(root);
    const rootProps = normalizePreviewInspectorProps(descriptor.automaticProps ?? {});
    previewInspectorSession.basePropsByExport.set(rootName, rootProps);
    previewInspectorSession.basePropsFingerprintByExport.set(
      rootName,
      stringifyPreviewInspectorProps(rootProps),
    );
    return [rootName];
  });
  const uniqueNames = [
    ...new Set([...names, ...rootNames, ...previewInspectorSession.boundariesByExport.keys()]),
  ];
  const activeNames = new Set(uniqueNames);
  for (const registry of [
    previewInspectorSession.basePropsByExport,
    previewInspectorSession.basePropsFingerprintByExport,
    previewInspectorSession.propsRevisionByExport,
  ]) {
    for (const name of registry.keys()) if (!activeNames.has(name)) registry.delete(name);
  }
  const namesChanged =
    uniqueNames.length !== previewInspectorSession.descriptorNames.length ||
    uniqueNames.some((name, index) => name !== previewInspectorSession.descriptorNames[index]);
  previewInspectorSession.descriptorNames = uniqueNames;
  if (
    previewInspectorSession.selectedExportName.length === 0 ||
    !uniqueNames.includes(previewInspectorSession.selectedExportName)
  ) {
    previewInspectorSession.selectedExportName = uniqueNames[0] ?? '';
  }
  if (namesChanged) {
    persistPreviewInspectorState();
    notifyPreviewInspector();
  }
  schedulePreviewInspectorHighlight();
}

/** Creates a collision-resistant toolbar identity for editable actual-parent root props. */
function createPreviewInspectorRootName(root) {
  return '@root:' + String(root?.sourcePath ?? '') + ':' + String(root?.exportName ?? 'default');
}

/** Keeps filesystem identity private while labeling target and actual-parent choices clearly. */
function formatPreviewInspectorEntryName(name) {
  return name.startsWith('@root:') ? 'Root · ' + (name.split(':').at(-1) || 'default') : 'Target · ' + name;
}

/** Registers the latest real props observed at one wrapped target invocation. */
function registerPreviewInspectorBaseProps(exportName, props) {
  if (typeof exportName !== 'string' || exportName.length === 0) {
    return;
  }
  const normalized = normalizePreviewInspectorProps(props);
  const fingerprint = stringifyPreviewInspectorProps(normalized);
  const previousFingerprint = previewInspectorSession.basePropsFingerprintByExport.get(exportName);
  previewInspectorSession.basePropsByExport.set(exportName, normalized);
  if (previousFingerprint === fingerprint) {
    return;
  }
  previewInspectorSession.basePropsFingerprintByExport.set(exportName, fingerprint);
  if (!previewInspectorSession.descriptorNames.includes(exportName)) {
    previewInspectorSession.descriptorNames = [
      ...previewInspectorSession.descriptorNames,
      exportName,
    ];
  }
  if (previewInspectorSession.selectedExportName.length === 0) {
    previewInspectorSession.selectedExportName = exportName;
  }
  notifyPreviewInspector();
}

/** Selects which wrapped target the toolbar edits and highlights. */
function selectPreviewInspectorExport(exportName) {
  if (
    typeof exportName !== 'string' ||
    exportName.length === 0 ||
    exportName === previewInspectorSession.selectedExportName
  ) {
    return;
  }
  previewInspectorSession.selectedExportName = exportName;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorHighlight();
}

/** Replaces an export's prop override and remounts its wrapped target instances. */
function setPreviewInspectorPropsOverride(exportName, value) {
  if (typeof exportName !== 'string' || exportName.length === 0) {
    return;
  }
  previewInspectorSession.overridesByExport.set(
    exportName,
    normalizePreviewInspectorProps(value),
  );
  remountPreviewInspectorExport(exportName, false);
  persistPreviewInspectorState();
}

/** Removes every user override from one export and remounts it from observed page props. */
function resetPreviewInspectorPropsOverride(exportName) {
  previewInspectorSession.overridesByExport.delete(exportName);
  remountPreviewInspectorExport(exportName, false);
  persistPreviewInspectorState();
}

/** Advances the key used below the app owner without replacing the entire page root. */
function remountPreviewInspectorExport(exportName, persist = true) {
  const currentRevision = previewInspectorSession.propsRevisionByExport.get(exportName) ?? 0;
  previewInspectorSession.propsRevisionByExport.set(exportName, currentRevision + 1);
  if (persist) {
    persistPreviewInspectorState();
  }
  notifyPreviewInspector();
  schedulePreviewInspectorHighlight();
}

/** Enables or disables target highlighting and restores every prior inline outline when disabled. */
function setPreviewInspectorHighlightEnabled(enabled) {
  previewInspectorSession.highlightEnabled = enabled === true;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorHighlight();
}

/** Adds a boundary instance without exposing React's private Fiber fields. */
function registerPreviewInspectorBoundary(exportName, boundary) {
  const boundaries = previewInspectorSession.boundariesByExport.get(exportName) ?? new Set();
  boundaries.add(boundary);
  previewInspectorSession.boundariesByExport.set(exportName, boundaries);
  schedulePreviewInspectorHighlight();
  return () => {
    boundaries.delete(boundary);
    if (boundaries.size === 0) {
      previewInspectorSession.boundariesByExport.delete(exportName);
    }
    schedulePreviewInspectorHighlight();
  };
}

/** Accepts an explicit host element from future source instrumentation or the manual picker. */
function registerPreviewInspectorTargetElement(exportName, element) {
  const normalized = normalizePreviewInspectorHostElement(element);
  if (normalized === undefined) {
    return () => undefined;
  }
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
  ) {
    return value;
  }
  const parentElement = value?.parentElement;
  return parentElement?.nodeType === 1 && typeof parentElement.getBoundingClientRect === 'function'
    ? parentElement
    : undefined;
}

/** Uses read-only tree lookup first and admits legacy findDOMNode as a public-version fallback. */
function collectPreviewInspectorBoundaryElements(boundary) {
  const fiberElements = collectPreviewInspectorFiberElements(boundary);
  if (fiberElements.length > 0) {
    return fiberElements;
  }
  const findDOMNode = ReactDOMNamespace.findDOMNode;
  if (typeof findDOMNode !== 'function') {
    return [];
  }
  try {
    const element = normalizePreviewInspectorHostElement(findDOMNode(boundary));
    return element === undefined ? [] : [element];
  } catch {
    return [];
  }
}

/** Collects connected target elements for the selected export without traversing React internals. */
function collectSelectedPreviewInspectorElements() {
  const exportName = previewInspectorSession.selectedExportName;
  if (previewInspectorSession.pickerCandidate !== undefined) {
    return [previewInspectorSession.pickerCandidate];
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

/** Detects toolbar, marker, and highlight nodes so the picker never selects its own chrome. */
function isPreviewInspectorUiElement(element) {
  return typeof element?.closest === 'function' &&
    element.closest('[' + PREVIEW_INSPECTOR_UI_ATTRIBUTE + ']') !== null;
}

/** Saves and applies an important outline without changing the target's box dimensions. */
function applyPreviewInspectorOutline(element) {
  if (element.__reactPreviewInspectorOutline !== undefined) {
    return;
  }
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
  if (previous === undefined) {
    return;
  }
  if (previous.outline.length === 0) {
    element.style.removeProperty('outline');
  } else {
    element.style.setProperty('outline', previous.outline, previous.outlinePriority);
  }
  if (previous.offset.length === 0) {
    element.style.removeProperty('outline-offset');
  } else {
    element.style.setProperty('outline-offset', previous.offset, previous.offsetPriority);
  }
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
    if (!nextElementSet.has(element)) {
      restorePreviewInspectorOutline(element);
    }
  }
  for (const element of nextElementSet) {
    applyPreviewInspectorOutline(element);
  }
  previewInspectorSession.highlightedElements = nextElementSet;
  const nextStatus = !previewInspectorSession.highlightEnabled
    ? 'Target highlight is off.'
    : nextElementSet.size > 0
      ? 'Highlighting ' + String(nextElementSet.size) + ' top-level target node(s).'
      : 'No host node yet. Render the target or use Pick element.';
  if (nextStatus !== previewInspectorSession.highlightStatus) {
    previewInspectorSession.highlightStatus = nextStatus;
    notifyPreviewInspector();
  }
}

/** Coalesces React commits, scroll events, and mutation batches into one highlight reconciliation. */
function schedulePreviewInspectorHighlight() {
  if (previewInspectorSession.highlightFrame !== undefined) {
    return;
  }
  const schedule = globalThis.requestAnimationFrame ?? ((callback) => setTimeout(callback, 0));
  previewInspectorSession.highlightFrame = schedule(() => {
    previewInspectorSession.highlightFrame = undefined;
    refreshPreviewInspectorHighlight();
  });
}

/** Enables one-shot DOM selection while leaving normal application interaction untouched otherwise. */
function setPreviewInspectorPickerEnabled(enabled) {
  previewInspectorSession.pickerEnabled = enabled === true;
  previewInspectorSession.pickerCandidate = undefined;
  notifyPreviewInspector();
  schedulePreviewInspectorHighlight();
}

/** Tracks a picker candidate without changing component props or application state. */
function handlePreviewInspectorPointerMove(event) {
  if (!previewInspectorSession.pickerEnabled) {
    return;
  }
  const candidate = normalizePreviewInspectorHostElement(event.target);
  if (candidate === undefined || isPreviewInspectorUiElement(candidate)) {
    return;
  }
  previewInspectorSession.pickerCandidate = candidate;
  schedulePreviewInspectorHighlight();
}

/** Commits the current picker candidate to the selected export and consumes only that click. */
function handlePreviewInspectorPick(event) {
  if (!previewInspectorSession.pickerEnabled) {
    return;
  }
  const candidate = normalizePreviewInspectorHostElement(event.target);
  if (candidate === undefined || isPreviewInspectorUiElement(candidate)) {
    return;
  }
  event.preventDefault();
  event.stopImmediatePropagation();
  previewInspectorSession.pickerCandidate = undefined;
  previewInspectorSession.pickerEnabled = false;
  registerPreviewInspectorTargetElement(
    previewInspectorSession.selectedExportName,
    candidate,
  );
  notifyPreviewInspector();
}

/** Installs transient DOM observers that are removed before the next hot-module revision mounts. */
function installPreviewInspectorDomObservers() {
  window.addEventListener('pointermove', handlePreviewInspectorPointerMove, true);
  window.addEventListener('click', handlePreviewInspectorPick, true);
  window.addEventListener('resize', schedulePreviewInspectorHighlight);
  window.addEventListener('scroll', schedulePreviewInspectorHighlight, true);
  const mutationObserver = typeof MutationObserver === 'function'
    ? new MutationObserver(schedulePreviewInspectorHighlight)
    : undefined;
  mutationObserver?.observe(mountNode, { childList: true, subtree: true });
  return () => {
    window.removeEventListener('pointermove', handlePreviewInspectorPointerMove, true);
    window.removeEventListener('click', handlePreviewInspectorPick, true);
    window.removeEventListener('resize', schedulePreviewInspectorHighlight);
    window.removeEventListener('scroll', schedulePreviewInspectorHighlight, true);
    mutationObserver?.disconnect();
    for (const element of previewInspectorSession.highlightedElements ?? []) {
      restorePreviewInspectorOutline(element);
    }
    previewInspectorSession.highlightedElements = new Set();
    previewInspectorSession.boundariesByExport.clear();
    previewInspectorSession.manualElementsByExport.clear();
    previewInspectorSession.pickerCandidate = undefined;
    previewInspectorSession.pickerEnabled = false;
  };
}

/** Creates an isolated portal host whose fixed toolbar never wraps or sizes the application page. */
function createPreviewInspectorPortalHost() {
  const portalHost = document.createElement('react-preview-inspector-host');
  portalHost.setAttribute(PREVIEW_INSPECTOR_UI_ATTRIBUTE, 'toolbar');
  portalHost.style.setProperty('all', 'initial', 'important');
  portalHost.style.setProperty('display', 'block', 'important');
  portalHost.style.setProperty('position', 'fixed', 'important');
  portalHost.style.setProperty('z-index', '2147483647', 'important');
  portalHost.__reactPreviewInspectorPortalRoot =
    typeof portalHost.attachShadow === 'function'
      ? portalHost.attachShadow({ mode: 'open' })
      : portalHost;
  document.body?.append(portalHost);
  return portalHost;
}

${targetBoundaryRuntimeSource}

/** Creates an inspected element while allowing modules to export an element instance directly. */
function createPreviewInspectorElement(Component, props) {
  return React.isValidElement(Component)
    ? React.cloneElement(Component, props)
    : React.createElement(Component, props);
}

/** Renders a facade target with live override props and a key scoped to that target only. */
function PreviewInspectorTargetRenderer({ Component, forwardedRef, metadata, targetProps }) {
  usePreviewInspectorStore();
  const exportName = metadata?.exportName ?? Component?.displayName ?? Component?.name ?? 'default';
  const automaticTargetProps = React.useMemo(
    () => createPreviewPropsFromLayers(metadata?.inferredPropShape, targetProps),
    [metadata?.inferredPropShape, targetProps],
  );
  React.useEffect(() => {
    registerPreviewInspectorBaseProps(exportName, automaticTargetProps);
  }, [exportName, automaticTargetProps]);
  const overrideProps = previewInspectorSession.overridesByExport.get(exportName) ?? {};
  const effectiveProps = createPreviewPropsFromLayers(
    undefined,
    automaticTargetProps,
    overrideProps,
  );
  if (forwardedRef !== undefined && forwardedRef !== null) {
    effectiveProps.ref = forwardedRef;
  }
  const revision = previewInspectorSession.propsRevisionByExport.get(exportName) ?? 0;
  return React.createElement(
    PreviewInspectorTargetBoundary,
    { exportName, key: exportName + ':' + String(revision) },
    createPreviewInspectorElement(Component, effectiveProps),
  );
}

/** Applies editable props to the real authored ancestor while retaining its complete page tree. */
function PreviewPageInspectorRootRenderer({ descriptor, previewConfig, storyContext, targetProps, useStorybook }) {
  usePreviewInspectorStore();
  if (descriptor?.inspector === undefined) {
    const metadata = {
      exportName: descriptor?.exportName ?? 'default',
      inferredPropShape: descriptor?.inferredPropShape,
      inferredProps: descriptor?.inferredProps,
    };
    const DirectPreviewTarget = (props) => React.createElement(PreviewInspectorTargetRenderer, {
      Component: descriptor?.value,
      forwardedRef: undefined,
      metadata,
      targetProps: props,
    });
    return useStorybook
      ? React.createElement(StorybookPreviewRoot, {
          PreviewTarget: DirectPreviewTarget,
          previewConfig,
          storyContext,
          targetProps,
        })
      : React.createElement(DirectPreviewTarget, targetProps);
  }
  const rootName = createPreviewInspectorRootName(descriptor?.inspector?.root);
  React.useEffect(() => {
    registerPreviewInspectorBaseProps(rootName, targetProps);
  }, [rootName, targetProps]);
  const overrideProps = previewInspectorSession.overridesByExport.get(rootName) ?? {};
  const effectiveProps = { ...targetProps, ...overrideProps };
  const revision = previewInspectorSession.propsRevisionByExport.get(rootName) ?? 0;
  return useStorybook
    ? React.createElement(StorybookPreviewRoot, {
        PreviewTarget: descriptor.value,
        key: revision,
        previewConfig,
        storyContext: { ...storyContext, args: effectiveProps },
        targetProps: effectiveProps,
      })
    : createPreviewInspectorElement(descriptor.value, {
        ...effectiveProps,
        key: revision,
      });
}

/** Resets an ancestor-root error boundary when edited target props request a scoped remount. */
function PreviewPageInspectorExportBoundary({ descriptor, children }) {
  usePreviewInspectorStore();
  const inspectedExportName =
    descriptor?.inspector?.target?.exportName ?? descriptor?.exportName ?? 'default';
  const targetRevision =
    previewInspectorSession.propsRevisionByExport.get(inspectedExportName) ?? 0;
  const rootName = createPreviewInspectorRootName(descriptor?.inspector?.root);
  const rootRevision = previewInspectorSession.propsRevisionByExport.get(rootName) ?? 0;
  return React.createElement(
    PreviewExportErrorBoundary,
    {
      exportName: descriptor?.exportName ?? inspectedExportName,
      key: inspectedExportName + ':' + String(targetRevision) + ':' + rootName + ':' + String(rootRevision),
      parentSlice: descriptor?.parentSlice,
    },
    children,
  );
}

/** Exposes only stable, documented inspector operations to generated target facade modules. */
const previewInspectorApi = {
  TargetRenderer: PreviewInspectorTargetRenderer,
  getSnapshot() {
    return {
      highlightEnabled: previewInspectorSession.highlightEnabled,
      selectedExportName: previewInspectorSession.selectedExportName,
      version: previewInspectorSession.version,
    };
  },
  registerTargetElement: registerPreviewInspectorTargetElement,
  remount: remountPreviewInspectorExport,
  resetPropsOverride: resetPreviewInspectorPropsOverride,
  selectExport: selectPreviewInspectorExport,
  setHighlightEnabled: setPreviewInspectorHighlightEnabled,
  setPropsOverride: setPreviewInspectorPropsOverride,
};
globalThis[PREVIEW_INSPECTOR_API_KEY] = previewInspectorApi;

const inspectorControlStyle = {
  all: 'initial',
  boxSizing: 'border-box',
  color: 'var(--vscode-editor-foreground)',
  font: '12px/1.4 var(--vscode-font-family)',
};

/** Creates one consistently isolated toolbar button. */
function PreviewInspectorButton({ children, onClick }) {
  return React.createElement(
    'button',
    {
      onClick,
      style: {
        ...inspectorControlStyle,
        background: 'var(--vscode-button-secondaryBackground)',
        border: '1px solid var(--vscode-panel-border)',
        borderRadius: 3,
        color: 'var(--vscode-button-secondaryForeground)',
        cursor: 'pointer',
        padding: '4px 8px',
      },
      type: 'button',
    },
    children,
  );
}

/** Formats the statically proven root-to-target owner path without reading React Fiber internals. */
function describePreviewInspectorAncestry() {
  const inspector = previewInspectorSession.descriptors[0]?.inspector;
  if (inspector === undefined) return 'No static component ancestry was discovered.';
  const names = [];
  for (const edge of [...(inspector.ancestry ?? [])].reverse()) {
    const ownerName = edge?.owner?.exportName;
    if (typeof ownerName === 'string' && names.at(-1) !== ownerName) names.push(ownerName);
    for (const localName of [...(edge?.localOwnerNames ?? [])].reverse()) {
      if (typeof localName === 'string' && names.at(-1) !== localName) names.push(localName);
    }
  }
  const targetName = inspector.target?.exportName ?? 'default';
  if (names.at(-1) !== targetName) names.push(targetName);
  return names.join('  ›  ') +
    (inspector.complete === true ? '' : '  ·  partial: ' + String(inspector.stopReason));
}

/** Reads generated-value provenance for the selected target without exposing source paths. */
function readSelectedPreviewInspectorInferredProps(exportName) {
  for (const descriptor of previewInspectorSession.descriptors) {
    const targetName = descriptor?.inspector?.target?.exportName ?? descriptor?.exportName;
    if (targetName !== exportName) continue;
    const inferredProps = descriptor?.inspector?.targetInferredProps ?? descriptor?.inferredProps;
    return Array.isArray(inferredProps) ? inferredProps : [];
  }
  return [];
}

/** Renders the export picker, highlight toggle, JSON props editor, and explicit state boundary. */
function PreviewInspectorToolbar() {
  usePreviewInspectorStore();
  const selectedExportName = previewInspectorSession.selectedExportName;
  const baseProps = previewInspectorSession.basePropsByExport.get(selectedExportName) ?? {};
  const overrideProps = previewInspectorSession.overridesByExport.get(selectedExportName) ?? {};
  const effectiveProps = { ...baseProps, ...overrideProps };
  const inferredProps = readSelectedPreviewInspectorInferredProps(selectedExportName);
  const draftKey =
    selectedExportName + ':' +
    (previewInspectorSession.basePropsFingerprintByExport.get(selectedExportName) ?? '') + ':' +
    stringifyPreviewInspectorProps(overrideProps);
  const [draftText, setDraftText] = React.useState(() =>
    stringifyPreviewInspectorProps(effectiveProps),
  );
  const [draftError, setDraftError] = React.useState('');
  React.useEffect(() => {
    setDraftText(stringifyPreviewInspectorProps(effectiveProps));
    setDraftError('');
  }, [draftKey]);

  /** Parses one plain JSON object and commits it as the selected target's override layer. */
  const applyDraft = () => {
    try {
      const value = JSON.parse(draftText);
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Props JSON must be an object.');
      }
      setPreviewInspectorPropsOverride(selectedExportName, value);
      setDraftError('');
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : String(error));
    }
  };

  const labelStyle = {
    ...inspectorControlStyle,
    color: 'var(--vscode-descriptionForeground)',
    display: 'grid',
    gap: 3,
  };
  return React.createElement(
    'details',
    {
      open: true,
      style: {
        ...inspectorControlStyle,
        background: 'var(--vscode-editor-background)',
        border: '1px solid var(--vscode-panel-border)',
        borderRadius: 5,
        boxShadow: '0 4px 18px rgba(0, 0, 0, 0.28)',
        display: 'block',
        maxHeight: 'calc(100vh - 24px)',
        overflow: 'auto',
        position: 'fixed',
        right: 12,
        top: 12,
        width: 360,
        zIndex: 2147483647,
      },
    },
    React.createElement(
      'summary',
      {
        style: {
          ...inspectorControlStyle,
          cursor: 'pointer',
          fontWeight: 600,
          padding: 10,
        },
      },
      'React Page Inspector',
    ),
    React.createElement(
      'div',
      {
        style: {
          ...inspectorControlStyle,
          display: 'grid',
          gap: 9,
          padding: '0 10px 10px',
        },
      },
      React.createElement(
        'code',
        {
          style: {
            ...labelStyle,
            background: 'var(--vscode-textCodeBlock-background)',
            display: 'block',
            overflow: 'auto',
            padding: 6,
            whiteSpace: 'nowrap',
          },
        },
        describePreviewInspectorAncestry(),
      ),
      React.createElement(
        'label',
        { style: labelStyle },
        'Inspected export',
        React.createElement(
          'select',
          {
            onChange: (event) => selectPreviewInspectorExport(event.target.value),
            style: {
              ...inspectorControlStyle,
              background: 'var(--vscode-dropdown-background)',
              border: '1px solid var(--vscode-dropdown-border)',
              color: 'var(--vscode-dropdown-foreground)',
              padding: 4,
            },
            value: selectedExportName,
          },
          previewInspectorSession.descriptorNames.map((name) =>
            React.createElement('option', { key: name, value: name }, formatPreviewInspectorEntryName(name)),
          ),
        ),
      ),
      React.createElement(
        'label',
        { style: { ...labelStyle, alignItems: 'center', display: 'flex', gap: 6 } },
        React.createElement('input', {
          checked: previewInspectorSession.highlightEnabled,
          onChange: (event) => setPreviewInspectorHighlightEnabled(event.target.checked),
          type: 'checkbox',
        }),
        'Highlight target',
      ),
      React.createElement(
        'div',
        { style: { ...inspectorControlStyle, display: 'flex', flexWrap: 'wrap', gap: 6 } },
        React.createElement(
          PreviewInspectorButton,
          { onClick: () => setPreviewInspectorPickerEnabled(!previewInspectorSession.pickerEnabled) },
          previewInspectorSession.pickerEnabled ? 'Cancel picker' : 'Pick element',
        ),
        React.createElement(
          PreviewInspectorButton,
          { onClick: () => remountPreviewInspectorExport(selectedExportName) },
          'Remount',
        ),
      ),
      React.createElement(
        'small',
        { style: { ...labelStyle, display: 'block' } },
        previewInspectorSession.highlightStatus,
      ),
      inferredProps.length > 0
        ? React.createElement(
            'small',
            { style: { ...labelStyle, display: 'block' } },
            'Auto-generated preview values: ' + inferredProps
              .map((item) => String(item.path) + ' (' + String(item.kind) + ')')
              .join(', '),
          )
        : null,
      React.createElement(
        'label',
        { style: labelStyle },
        'Serializable props (JSON)',
        React.createElement('textarea', {
          onChange: (event) => setDraftText(event.target.value),
          spellCheck: false,
          style: {
            ...inspectorControlStyle,
            background: 'var(--vscode-input-background)',
            border: '1px solid var(--vscode-input-border)',
            color: 'var(--vscode-input-foreground)',
            font: '11px/1.45 var(--vscode-editor-font-family)',
            minHeight: 150,
            padding: 7,
            resize: 'vertical',
            width: '100%',
          },
          value: draftText,
        }),
      ),
      draftError.length > 0
        ? React.createElement(
            'div',
            { style: { ...inspectorControlStyle, color: 'var(--vscode-errorForeground)' } },
            draftError,
          )
        : null,
      React.createElement(
        'div',
        { style: { ...inspectorControlStyle, display: 'flex', gap: 6 } },
        React.createElement(PreviewInspectorButton, { onClick: applyDraft }, 'Apply props'),
        React.createElement(
          PreviewInspectorButton,
          {
            onClick: () => resetPreviewInspectorPropsOverride(selectedExportName),
          },
          'Reset props',
        ),
      ),
      React.createElement(
        'small',
        { style: { ...labelStyle, display: 'block' } },
        'Component props are editable here. Internal hook state uses the page UI or a source edit; ' +
          'React has no stable public API for rewriting arbitrary hook slots.',
      ),
    ),
  );
}

/** Mounts inspector chrome through a portal and keeps transient observers aligned with hot reload. */
function PreviewPageInspectorShell({ descriptors, children }) {
  const [portalHost] = React.useState(createPreviewInspectorPortalHost);
  React.useEffect(() => {
    setPreviewInspectorDescriptors(descriptors);
    const removeObservers = installPreviewInspectorDomObservers();
    return () => {
      removeObservers();
      portalHost.remove();
    };
  }, [descriptors, portalHost]);
  const toolbar = React.createElement(PreviewInspectorToolbar);
  const portal = typeof ReactDOMNamespace.createPortal === 'function'
    ? ReactDOMNamespace.createPortal(
        toolbar,
        portalHost.__reactPreviewInspectorPortalRoot ?? portalHost,
      )
    : null;
  return React.createElement(React.Fragment, undefined, children, portal);
}
`;
}
