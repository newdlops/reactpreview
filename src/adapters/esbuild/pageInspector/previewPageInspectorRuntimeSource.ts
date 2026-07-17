/**
 * Generates the browser-owned React Page Inspector runtime.
 *
 * The emitted source deliberately keeps inspector chrome outside the rendered application and
 * locates inspected host nodes without inserting marker elements into the application DOM. This
 * preserves table/list/SVG semantics as well as structural selectors such as `:first-child`.
 * A global Symbol protocol lets target facades register before or below an actual ancestor root.
 */
import { createPreviewInspectorFiberRuntimeSource } from './previewInspectorFiberRuntimeSource';
import { createPreviewInspectorChainRuntimeSource } from './previewInspectorChainRuntimeSource';
import { createPreviewInspectorConditionRuntimeSource } from './previewInspectorConditionRuntimeSource';
import { createPreviewInspectorConsoleRuntimeSource } from './previewInspectorConsoleRuntimeSource';
import { createPreviewInspectorDataRuntimeSource } from './previewInspectorDataRuntimeSource';
import { createPreviewInspectorDevtoolsUiRuntimeSource } from './previewInspectorDevtoolsUiRuntimeSource';
import { createPreviewInspectorPageCandidateRuntimeSource } from './previewInspectorPageCandidateRuntimeSource';
import { createPreviewInspectorStateRuntimeSource } from './previewInspectorStateRuntimeSource';
import { createPreviewInspectorTargetBoundaryRuntimeSource } from './previewInspectorTargetBoundaryRuntimeSource';
import { createPreviewInspectorRuntimeFallbackRuntimeSource } from './previewInspectorRuntimeFallbackRuntimeSource';

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
export function createPreviewPageInspectorRuntimeSource(sourceGestureSecret?: string): string {
  const chainRuntimeSource = createPreviewInspectorChainRuntimeSource();
  const conditionRuntimeSource = createPreviewInspectorConditionRuntimeSource();
  const consoleRuntimeSource = createPreviewInspectorConsoleRuntimeSource();
  const dataRuntimeSource = createPreviewInspectorDataRuntimeSource();
  const devtoolsUiRuntimeSource = createPreviewInspectorDevtoolsUiRuntimeSource();
  const fiberRuntimeSource = createPreviewInspectorFiberRuntimeSource();
  const pageCandidateRuntimeSource = createPreviewInspectorPageCandidateRuntimeSource();
  const stateRuntimeSource = createPreviewInspectorStateRuntimeSource();
  const targetBoundaryRuntimeSource = createPreviewInspectorTargetBoundaryRuntimeSource();
  const runtimeFallbackRuntimeSource = createPreviewInspectorRuntimeFallbackRuntimeSource();
  const encodedSourceGestureSecret = JSON.stringify(sourceGestureSecret ?? '');
  return String.raw`
const PREVIEW_INSPECTOR_API_KEY = Symbol.for('newdlops.react-file-preview.page-inspector');
const PREVIEW_INSPECTOR_UI_ATTRIBUTE = 'data-react-preview-inspector-ui';
const PREVIEW_INSPECTOR_STATE_KEY = 'reactFilePreviewPageInspector';
const PREVIEW_INSPECTOR_SOURCE_GESTURE_SECRET = ${encodedSourceGestureSecret};
const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);

/** Captures browser primitives before dynamically imported project modules can replace them. */
const previewInspectorSourceCrypto = (() => {
  const cryptoObject = globalThis.crypto;
  const subtle = cryptoObject?.subtle;
  const importKey = subtle?.importKey?.bind(subtle);
  const sign = subtle?.sign?.bind(subtle);
  const getRandomValues = cryptoObject?.getRandomValues?.bind(cryptoObject);
  const decodeBase64 = globalThis.atob?.bind(globalThis);
  const encodeBase64 = globalThis.btoa?.bind(globalThis);
  if (
    PREVIEW_INSPECTOR_SOURCE_GESTURE_SECRET.length === 0 ||
    typeof importKey !== 'function' ||
    typeof sign !== 'function' ||
    typeof getRandomValues !== 'function' ||
    typeof decodeBase64 !== 'function' ||
    typeof encodeBase64 !== 'function' ||
    typeof TextEncoder !== 'function'
  ) {
    return undefined;
  }
  try {
    const paddedSecret = PREVIEW_INSPECTOR_SOURCE_GESTURE_SECRET
      .replaceAll('-', '+')
      .replaceAll('_', '/') + '='.repeat((4 - PREVIEW_INSPECTOR_SOURCE_GESTURE_SECRET.length % 4) % 4);
    const binarySecret = decodeBase64(paddedSecret);
    const secretBytes = Uint8Array.from(binarySecret, (character) => character.charCodeAt(0));
    const keyPromise = importKey(
      'raw',
      secretBytes,
      { hash: 'SHA-256', name: 'HMAC' },
      false,
      ['sign'],
    ).catch(() => undefined);
    return {
      encodeBase64,
      getRandomValues,
      keyPromise,
      sign,
      textEncoder: new TextEncoder(),
    };
  } catch {
    return undefined;
  }
})();
const previewInspectorSourceEventConstructor = globalThis.Event;
const previewInspectorConsumedSourceEvents = new WeakSet();
const previewInspectorPostHostMessage =
  previewHotRuntime.vscodeApi?.postMessage?.bind(previewHotRuntime.vscodeApi);

${fiberRuntimeSource}

${chainRuntimeSource}

${pageCandidateRuntimeSource}

${stateRuntimeSource}

${dataRuntimeSource}

${conditionRuntimeSource}

${consoleRuntimeSource}

${runtimeFallbackRuntimeSource}

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
    devtoolsState:
      persisted.devtoolsState !== null &&
      typeof persisted.devtoolsState === 'object' &&
      !Array.isArray(persisted.devtoolsState)
        ? { ...persisted.devtoolsState }
        : {},
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
    selectedPageCandidateId:
      typeof persisted.selectedPageCandidateId === 'string' ? persisted.selectedPageCandidateId : '',
    selectedTreeNodeId:
      typeof persisted.selectedTreeNodeId === 'string' ? persisted.selectedTreeNodeId : undefined,
    treeListeners: new Set(),
    version: 0,
  };
}

const previewInspectorSession =
  previewHotRuntime.inspectorSession ?? createPreviewInspectorSession();
previewHotRuntime.inspectorSession = previewInspectorSession;
previewInspectorSession.treeListeners ??= new Set();

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
  const renderChainNames = previewInspectorSession.descriptors.flatMap((descriptor) =>
    Object.keys(descriptor?.inspector?.renderChainsByExport ?? {}),
  );
  const rootNames = previewInspectorSession.descriptors.flatMap((descriptor) =>
    readPreviewInspectorPageCandidates(descriptor).map((candidate) => {
      const rootName = createPreviewInspectorRootName(candidate.root);
      const rootProps = normalizePreviewInspectorProps(candidate.rootAutomaticProps ?? {});
      previewInspectorSession.basePropsByExport.set(rootName, rootProps);
      previewInspectorSession.basePropsFingerprintByExport.set(
        rootName,
        stringifyPreviewInspectorProps(rootProps),
      );
      return rootName;
    }),
  );
  const candidateIds = previewInspectorSession.descriptors.flatMap((descriptor) =>
    readPreviewInspectorPageCandidates(descriptor).map((candidate) => candidate.id),
  );
  const candidateChanged = !candidateIds.includes(previewInspectorSession.selectedPageCandidateId);
  if (candidateChanged) previewInspectorSession.selectedPageCandidateId = candidateIds[0] ?? '';
  const uniqueNames = [
    ...new Set([
      ...names,
      ...renderChainNames,
      ...rootNames,
      ...previewInspectorSession.boundariesByExport.keys(),
    ]),
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
  if (namesChanged || candidateChanged) {
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

/** Finds descriptor metadata for a selected target, actual root, or render-chain export identity. */
function findSelectedPreviewInspectorDescriptor() {
  const selectedName = previewInspectorSession.selectedExportName;
  return previewInspectorSession.descriptors.find((descriptor) => {
    const inspector = descriptor?.inspector;
    const targetName = inspector?.target?.exportName ?? descriptor?.exportName;
    const rootNames = readPreviewInspectorPageCandidates(descriptor)
      .map((candidate) => createPreviewInspectorRootName(candidate.root));
    return selectedName === targetName || rootNames.includes(selectedName) ||
      Object.hasOwn(inspector?.renderChainsByExport ?? {}, selectedName);
  }) ?? previewInspectorSession.descriptors[0];
}

/** Collects the current bounded live tree while retaining host indexes only inside the webview. */
function collectPreviewInspectorTreeSnapshot() {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const selectedName = previewInspectorSession.selectedExportName;
  const instrumentedTargetName =
    descriptor?.inspector?.target?.exportName ?? descriptor?.exportName ?? selectedName;
  const selectedCandidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const selectedRoot = selectedCandidate?.root ?? descriptor?.inspector?.root;
  const rootName = selectedRoot === undefined
    ? undefined
    : createPreviewInspectorRootName(selectedRoot);
  const selectedIsStaticSibling =
    selectedName !== instrumentedTargetName &&
    selectedName !== rootName &&
    Object.hasOwn(descriptor?.inspector?.renderChainsByExport ?? {}, selectedName);
  const targetName = selectedIsStaticSibling ? selectedName : instrumentedTargetName;
  const boundaries = selectedIsStaticSibling
    ? []
    : previewInspectorSession.boundariesByExport.get(instrumentedTargetName) ?? [];
  const snapshot = collectPreviewInspectorFiberTree(
    boundaries,
    previewInspectorSession.selectedTreeNodeId,
    {
      descriptor,
      pageCandidate: selectedCandidate,
      rootExportName: rootName,
      selectedExportName: previewInspectorSession.selectedExportName,
      targetExportName: targetName,
    },
  );
  previewInspectorSession.lastTreeSnapshot = snapshot;
  return snapshot;
}

/** Notifies tree subscribers after the shared animation-frame reconciliation has committed. */
function notifyPreviewInspectorTreeSubscribers() {
  for (const listener of [...previewInspectorSession.treeListeners]) {
    try {
      listener();
    } catch (error) {
      console.warn('[React Preview] Component tree subscriber failed.', error);
    }
  }
}

/** Subscribes the DevTools tree to coalesced React commit and DOM mutation refreshes. */
function subscribePreviewInspectorTree(listener) {
  if (typeof listener !== 'function') return () => undefined;
  previewInspectorSession.treeListeners.add(listener);
  const pollTimer = setInterval(schedulePreviewInspectorHighlight, 1000);
  return () => {
    clearInterval(pollTimer);
    previewInspectorSession.treeListeners.delete(listener);
  };
}

/** Selects a collected node without granting edit access to an arbitrary Fiber component. */
function selectPreviewInspectorTreeNode(nodeId) {
  if (typeof nodeId !== 'string' || nodeId.length === 0) return;
  const snapshot = collectPreviewInspectorTreeSnapshot();
  const selection = selectPreviewInspectorFiberTreeNode(snapshot, nodeId);
  if (selection === undefined) return;
  previewInspectorSession.selectedTreeNodeId = nodeId;
  previewInspectorSession.lastTreeSnapshot = snapshot;
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorHighlight();
}

/** Encodes bytes as unpadded base64url without exposing the private HMAC key. */
function encodePreviewInspectorSourceToken(bytes) {
  const cryptoBridge = previewInspectorSourceCrypto;
  if (cryptoBridge === undefined) return undefined;
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return cryptoBridge.encodeBase64(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

/** Signs the exact path, coordinates, and one-shot nonce selected by a trusted source-button click. */
async function signPreviewInspectorSourceMessage(message, gestureNonce) {
  const cryptoBridge = previewInspectorSourceCrypto;
  if (cryptoBridge === undefined) return undefined;
  const key = await cryptoBridge.keyPromise;
  if (key === undefined) return undefined;
  const payload = JSON.stringify([
    message.type,
    message.sourcePath,
    message.line ?? null,
    message.column ?? null,
    message.occurrenceStart ?? null,
    gestureNonce,
  ]);
  try {
    const signature = await cryptoBridge.sign(
      'HMAC',
      key,
      cryptoBridge.textEncoder.encode(payload),
    );
    return encodePreviewInspectorSourceToken(signature);
  } catch {
    return undefined;
  }
}

/** Creates one cryptographically random nonce that the host will consume only once. */
function createPreviewInspectorSourceNonce() {
  const cryptoBridge = previewInspectorSourceCrypto;
  if (cryptoBridge === undefined) return undefined;
  const bytes = new Uint8Array(16);
  cryptoBridge.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Sends source coordinates only after consuming an actual click on the bound Inspector UI button. */
async function openPreviewInspectorTreeSource(source, nativeEvent, sourceButton) {
  if (
    typeof previewInspectorSourceEventConstructor !== 'function' ||
    !(nativeEvent instanceof previewInspectorSourceEventConstructor) ||
    nativeEvent.isTrusted !== true ||
    nativeEvent.type !== 'click' ||
    typeof nativeEvent.composedPath !== 'function' ||
    !nativeEvent.composedPath().includes(sourceButton) ||
    sourceButton?.getAttribute?.('data-react-preview-source-open') !== 'true' ||
    previewInspectorConsumedSourceEvents.has(nativeEvent)
  ) return;
  previewInspectorConsumedSourceEvents.add(nativeEvent);
  if (source === null || typeof source !== 'object') return;
  const sourcePath = typeof source.sourcePath === 'string' ? source.sourcePath : source.path;
  if (typeof sourcePath !== 'string' || sourcePath.length === 0) return;
  const message = { sourcePath, type: 'react-preview-inspector-open-source' };
  if (Number.isSafeInteger(source.line) && source.line > 0) message.line = source.line;
  if (Number.isSafeInteger(source.column) && source.column > 0) message.column = source.column;
  if (Number.isSafeInteger(source.occurrenceStart) && source.occurrenceStart >= 0) {
    message.occurrenceStart = source.occurrenceStart;
  }
  const gestureNonce = createPreviewInspectorSourceNonce();
  if (gestureNonce === undefined) return;
  const gestureToken = await signPreviewInspectorSourceMessage(message, gestureNonce);
  if (gestureToken === undefined) return;
  previewInspectorPostHostMessage?.({ ...message, gestureNonce, gestureToken });
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
  previewInspectorSession.selectedTreeNodeId = undefined;
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

/** Resolves a DevTools row selection back to its connected top-level host roots. */
function collectSelectedPreviewInspectorTreeElements() {
  const nodeId = previewInspectorSession.selectedTreeNodeId;
  if (typeof nodeId !== 'string') return undefined;
  const snapshot = collectPreviewInspectorTreeSnapshot();
  const selection = selectPreviewInspectorFiberTreeNode(snapshot, nodeId);
  return selection === undefined ? undefined : [selection.hostNodes, snapshot.status === 'static'];
}

/** Collects connected target elements for the selected export without traversing React internals. */
function collectSelectedPreviewInspectorElements() {
  const exportName = previewInspectorSession.selectedExportName;
  if (previewInspectorSession.pickerCandidate !== undefined) {
    return [previewInspectorSession.pickerCandidate];
  }
  const treeSelection = collectSelectedPreviewInspectorTreeElements();
  if (treeSelection !== undefined && (treeSelection[0].length > 0 || !treeSelection[1])) return treeSelection[0];
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
    ? 'Component highlight is off.'
    : nextElementSet.size > 0
      ? 'Highlighting ' + String(nextElementSet.size) + ' selected component host node(s).'
      : 'No selected component host node yet. Render it or use Pick element.';
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
    notifyPreviewInspectorTreeSubscribers();
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

/** Maps a picked DOM host to its nearest component, with legacy manual-host fallback. */
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
  const snapshot = collectPreviewInspectorTreeSnapshot();
  const selection = findPreviewInspectorFiberTreeNodeByHost(snapshot, candidate);
  if (selection === undefined) {
    previewInspectorSession.selectedTreeNodeId = undefined;
    registerPreviewInspectorTargetElement(
      previewInspectorSession.selectedExportName,
      candidate,
    );
  } else {
    previewInspectorSession.selectedTreeNodeId = selection.node.id;
    const exportName = selection.node.exportName;
    if (
      typeof exportName === 'string' &&
      previewInspectorSession.descriptorNames.includes(exportName)
    ) {
      previewInspectorSession.selectedExportName = exportName;
    }
    previewInspectorSession.lastTreeSnapshot = snapshot;
    persistPreviewInspectorState();
  }
  notifyPreviewInspector();
  schedulePreviewInspectorHighlight();
}

/** Coalesces authored DOM commits while ignoring style records caused by the yellow outline itself. */
function handlePreviewInspectorMutations(records) {
  const hasAuthoredMutation = records.some(
    (record) =>
      record.type !== 'attributes' ||
      record.attributeName !== 'style' ||
      record.target?.__reactPreviewInspectorOutline === undefined,
  );
  if (hasAuthoredMutation) schedulePreviewInspectorHighlight();
}

/** Installs transient DOM observers that are removed before the next hot-module revision mounts. */
function installPreviewInspectorDomObservers() {
  window.addEventListener('pointermove', handlePreviewInspectorPointerMove, true);
  window.addEventListener('click', handlePreviewInspectorPick, true);
  window.addEventListener('resize', schedulePreviewInspectorHighlight);
  window.addEventListener('scroll', schedulePreviewInspectorHighlight, true);
  const mutationObserver = typeof MutationObserver === 'function'
    ? new MutationObserver(handlePreviewInspectorMutations)
    : undefined;
  mutationObserver?.observe(mountNode, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
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
    previewInspectorSession.lastTreeSnapshot = undefined;
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
  portalHost.style.setProperty('inset', '0', 'important');
  portalHost.style.setProperty('pointer-events', 'none', 'important');
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
  const fallbackValuesEnabled = readPreviewInspectorFallbackValuesEnabled();
  const automaticTargetProps = React.useMemo(
    () => createPreviewPropsFromLayers(
      fallbackValuesEnabled ? metadata?.inferredPropShape : undefined,
      targetProps,
    ),
    [fallbackValuesEnabled, metadata?.inferredPropShape, targetProps],
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
  const conditionRevision = readPreviewInspectorRenderConditionRevision();
  return React.createElement(
    PreviewInspectorTargetBoundary,
    { exportName, key: exportName + ':' + String(revision) + ':' + String(conditionRevision) },
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
  const selectedCandidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const selectedRoot = selectedCandidate?.root ?? descriptor?.inspector?.root;
  const rootName = createPreviewInspectorRootName(selectedRoot);
  const automaticRootProps = normalizePreviewInspectorProps(
    selectedCandidate?.rootAutomaticProps ?? descriptor?.automaticProps ?? {},
  );
  const baseRootProps = { ...automaticRootProps, ...targetProps };
  React.useEffect(() => {
    registerPreviewInspectorBaseProps(rootName, baseRootProps);
  }, [rootName, stringifyPreviewInspectorProps(baseRootProps)]);
  const overrideProps = previewInspectorSession.overridesByExport.get(rootName) ?? {};
  const effectiveProps = { ...baseRootProps, ...overrideProps };
  const revision = previewInspectorSession.propsRevisionByExport.get(rootName) ?? 0;
  const conditionRevision = readPreviewInspectorRenderConditionRevision();
  const candidateKey = selectedCandidate?.id ?? 'nearest-authored-owner';
  return useStorybook
    ? React.createElement(StorybookPreviewRoot, {
        PreviewTarget: descriptor.value,
        key: candidateKey + ':' + String(revision) + ':' + String(conditionRevision),
        previewConfig,
        storyContext: { ...storyContext, args: effectiveProps },
        targetProps: effectiveProps,
      })
    : createPreviewInspectorElement(descriptor.value, {
        ...effectiveProps,
        key: candidateKey + ':' + String(revision) + ':' + String(conditionRevision),
      });
}

/** Resets an ancestor-root error boundary when edited target props request a scoped remount. */
function PreviewPageInspectorExportBoundary({ descriptor, children }) {
  usePreviewInspectorStore();
  const inspectedExportName =
    descriptor?.inspector?.target?.exportName ?? descriptor?.exportName ?? 'default';
  const targetRevision =
    previewInspectorSession.propsRevisionByExport.get(inspectedExportName) ?? 0;
  const selectedCandidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const rootName = createPreviewInspectorRootName(
    selectedCandidate?.root ?? descriptor?.inspector?.root,
  );
  const rootRevision = previewInspectorSession.propsRevisionByExport.get(rootName) ?? 0;
  const dataRevision = previewInspectorSession.dataRevision ?? 0;
  return React.createElement(
    PreviewExportErrorBoundary,
    {
      exportName: descriptor?.exportName ?? inspectedExportName,
      key: inspectedExportName + ':' + String(targetRevision) + ':' + rootName + ':' +
        String(rootRevision) + ':candidate:' + String(selectedCandidate?.id ?? '') +
        ':data:' + String(dataRevision),
      parentSlice: descriptor?.parentSlice,
    },
    children,
  );
}

/** Keeps privileged editor navigation lexical to extension-owned UI code, outside the facade API. */
const previewInspectorSourceNavigation = Object.freeze({
  openSource: openPreviewInspectorTreeSource,
});

/** Exposes only stable, non-host-privileged operations to generated target facade modules. */
const previewInspectorApi = {
  TargetRenderer: PreviewInspectorTargetRenderer,
  collectTree: collectPreviewInspectorTreeSnapshot,
  createPageCandidateElement: createPreviewInspectorPageCandidateElement,
  getSnapshot() {
    return {
      highlightEnabled: previewInspectorSession.highlightEnabled,
      selectedExportName: previewInspectorSession.selectedExportName,
      version: previewInspectorSession.version,
    };
  },
  registerTargetElement: registerPreviewInspectorTargetElement,
  previewAxiosRequest: previewInspectorAxiosRequest,
  previewFetch: previewInspectorFetch,
  recordConsoleEntry: recordPreviewInspectorConsoleEntry,
  resolveDataPayload: resolvePreviewInspectorDataPayload,
  resolveRenderCondition: resolvePreviewInspectorRenderCondition,
  resolveRuntimeHook: resolvePreviewInspectorRuntimeHook,
  remount: remountPreviewInspectorExport,
  resetPropsOverride: resetPreviewInspectorPropsOverride,
  selectExport: selectPreviewInspectorExport,
  selectNode: selectPreviewInspectorTreeNode,
  setHighlightEnabled: setPreviewInspectorHighlightEnabled,
  setPropsOverride: setPreviewInspectorPropsOverride,
  subscribeTree: subscribePreviewInspectorTree,
};
globalThis[PREVIEW_INSPECTOR_API_KEY] = previewInspectorApi;
installPreviewInspectorConsoleCapture();
installPreviewInspectorNetworkBoundary();
registerPreviewRuntimeCapability('Data', {
  readPreviewRuntimeStatus: readPreviewInspectorDataRuntimeStatus,
});
registerPreviewRuntimeCapability('Render isolation', {
  readPreviewRuntimeStatus: readPreviewInspectorRuntimeFallbackStatus,
});

${devtoolsUiRuntimeSource}
`;
}
