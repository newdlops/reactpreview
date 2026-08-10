import { createPreviewInspectorFiberRuntimeSource } from './previewInspectorFiberRuntimeSource';
import { createPreviewInspectorChainRuntimeSource } from './previewInspectorChainRuntimeSource';
import { createPreviewInspectorBlockerTraceRuntimeSource } from './previewInspectorBlockerTraceRuntimeSource';
import { createPreviewInspectorConditionRuntimeSource } from './previewInspectorConditionRuntimeSource';
import { createPreviewInspectorCompanionRuntimeSource } from './previewInspectorCompanionRuntimeSource';
import { createPreviewInspectorConsoleRuntimeSource } from './previewInspectorConsoleRuntimeSource';
import { createPreviewInspectorDataRuntimeSource } from './previewInspectorDataRuntimeSource';
import { createPreviewInspectorDeferredUiTriggerRuntimeSource } from './previewInspectorDeferredUiTriggerRuntimeSource';
import { createPreviewInspectorDiagnosticsRuntimeSource } from './previewInspectorDiagnosticsRuntimeSource';
import { createPreviewInspectorDevtoolsUiRuntimeSource } from './previewInspectorDevtoolsUiRuntimeSource';
import { createPreviewInspectorElementVisibilityRuntimeSource } from './previewInspectorElementVisibilityRuntimeSource';
import { createPreviewInspectorGraphqlDocumentRuntimeSource } from './previewInspectorGraphqlDocumentRuntimeSource';
import { createPreviewInspectorPageCandidateRuntimeSource } from './previewInspectorPageCandidateRuntimeSource';
import { createPreviewInspectorPropsUiRuntimeSource } from './previewInspectorPropsUiRuntimeSource';
import { createPreviewInspectorRefreshRuntimeSource } from './previewInspectorRefreshRuntimeSource';
import { createPreviewInspectorRuntimeCorrelationSource } from './previewInspectorRuntimeCorrelationSource';
import { createPreviewInspectorRuntimeHealthSource } from './previewInspectorRuntimeHealthSource';
import { createPreviewInspectorRenderOutcomeRuntimeSource } from './previewInspectorRenderOutcomeRuntimeSource';
import { createPreviewInspectorStateRuntimeSource } from './previewInspectorStateRuntimeSource';
import { createPreviewInspectorTargetBoundaryRuntimeSource } from './previewInspectorTargetBoundaryRuntimeSource';
import { createPreviewInspectorTargetAttemptRuntimeSource } from './previewInspectorTargetAttemptRuntimeSource';
import { createPreviewInspectorTargetOutputRuntimeSource } from './previewInspectorTargetOutputRuntimeSource';
import { createPreviewInspectorTargetReachabilityRuntimeSource } from './previewInspectorTargetReachabilityRuntimeSource';
import { createPreviewInspectorTargetPathIdentityRuntimeSource } from './previewInspectorTargetPathIdentityRuntimeSource';
import { createPreviewInspectorRuntimeFallbackRuntimeSource } from './previewInspectorRuntimeFallbackRuntimeSource';
import { createPreviewInspectorRuntimeFallbackScopeRuntimeSource } from './previewInspectorRuntimeFallbackScopeRuntimeSource';
import { createPreviewInspectorSmartPropsRuntimeSource } from './previewInspectorSmartPropsRuntimeSource';
import { createPreviewInspectorDomOwnershipRuntimeSource } from './previewInspectorDomOwnershipRuntimeSource';
export const PREVIEW_PAGE_INSPECTOR_API_SYMBOL = 'newdlops.react-file-preview.page-inspector';
export const PREVIEW_PAGE_INSPECTOR_UI_ATTRIBUTE = 'data-react-preview-inspector-ui';
/** Internal helper. */
export function createPreviewPageInspectorRuntimeSource(sourceGestureSecret?: string): string {
  const chainRuntimeSource = createPreviewInspectorChainRuntimeSource();
  const blockerTraceRuntimeSource = createPreviewInspectorBlockerTraceRuntimeSource();
  const companionRuntimeSource = createPreviewInspectorCompanionRuntimeSource();
  const conditionRuntimeSource = createPreviewInspectorConditionRuntimeSource();
  const consoleRuntimeSource = createPreviewInspectorConsoleRuntimeSource();
  const dataRuntimeSource = createPreviewInspectorDataRuntimeSource();
  const deferredUiTriggerRuntimeSource = createPreviewInspectorDeferredUiTriggerRuntimeSource();
  const diagnosticsRuntimeSource = createPreviewInspectorDiagnosticsRuntimeSource();
  const devtoolsUiRuntimeSource = createPreviewInspectorDevtoolsUiRuntimeSource();
  const elementVisibilityRuntimeSource = createPreviewInspectorElementVisibilityRuntimeSource();
  const fiberRuntimeSource = createPreviewInspectorFiberRuntimeSource();
  const graphqlDocumentRuntimeSource = createPreviewInspectorGraphqlDocumentRuntimeSource();
  const pageCandidateRuntimeSource = createPreviewInspectorPageCandidateRuntimeSource();
  const propsUiRuntimeSource = createPreviewInspectorPropsUiRuntimeSource();
  const refreshRuntimeSource = createPreviewInspectorRefreshRuntimeSource();
  const runtimeCorrelationSource = createPreviewInspectorRuntimeCorrelationSource();
  const runtimeHealthSource = createPreviewInspectorRuntimeHealthSource();
  const renderOutcomeRuntimeSource = createPreviewInspectorRenderOutcomeRuntimeSource();
  const stateRuntimeSource = createPreviewInspectorStateRuntimeSource();
  const targetBoundaryRuntimeSource = createPreviewInspectorTargetBoundaryRuntimeSource();
  const targetAttemptRuntimeSource = createPreviewInspectorTargetAttemptRuntimeSource();
  const targetOutputRuntimeSource = createPreviewInspectorTargetOutputRuntimeSource();
  const targetPathIdentityRuntimeSource = createPreviewInspectorTargetPathIdentityRuntimeSource();
  const targetReachabilityRuntimeSource = createPreviewInspectorTargetReachabilityRuntimeSource();
  const runtimeFallbackRuntimeSource = createPreviewInspectorRuntimeFallbackRuntimeSource();
  const runtimeFallbackScopeRuntimeSource =
    createPreviewInspectorRuntimeFallbackScopeRuntimeSource();
  const smartPropsRuntimeSource = createPreviewInspectorSmartPropsRuntimeSource();
  const domOwnershipRuntimeSource = createPreviewInspectorDomOwnershipRuntimeSource();
  const encodedSourceGestureSecret = JSON.stringify(sourceGestureSecret ?? '');
  return String.raw`
const PREVIEW_INSPECTOR_API_KEY = Symbol.for('newdlops.react-file-preview.page-inspector');
const PREVIEW_INSPECTOR_UI_ATTRIBUTE = 'data-react-preview-inspector-ui';
const PREVIEW_INSPECTOR_STATE_KEY = 'reactFilePreviewPageInspector';
const PREVIEW_INSPECTOR_SOURCE_GESTURE_SECRET = ${encodedSourceGestureSecret};
const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
${domOwnershipRuntimeSource}
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
${runtimeCorrelationSource}
${fiberRuntimeSource}
${deferredUiTriggerRuntimeSource}
${elementVisibilityRuntimeSource}
${chainRuntimeSource}
${pageCandidateRuntimeSource}
${stateRuntimeSource}
${dataRuntimeSource}
${renderOutcomeRuntimeSource}
${conditionRuntimeSource}
${targetOutputRuntimeSource}
const hasPreviewInspectorResolvedTargetOutput = createPreviewInspectorTargetOutputFactory();
${targetReachabilityRuntimeSource}
${targetPathIdentityRuntimeSource}
${targetAttemptRuntimeSource}
${blockerTraceRuntimeSource}
${runtimeHealthSource}
${consoleRuntimeSource}
${runtimeFallbackRuntimeSource}
${runtimeFallbackScopeRuntimeSource}
${graphqlDocumentRuntimeSource}
${smartPropsRuntimeSource}
${refreshRuntimeSource}
${diagnosticsRuntimeSource}
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
    lastRequestedRouteSelectionPath: undefined,
    overridesByExport: new Map(
      persistedOverrides.filter(([, value]) => value !== null && typeof value === 'object'),
    ),
    instanceEpochByExport: new Map(),
    pickerCandidate: undefined,
    pickerEnabled: false,
    pendingRouteBranchId: undefined,
    pendingRouteBuildRevision: undefined,
    pendingRouteInteractionId: undefined,
    pendingRouteBranchRevision: undefined,
    pendingRouteError: undefined,
    pendingRouteSelectionPath: undefined,
    pendingRouteTimeout: undefined,
    pendingPageCandidateId: undefined,
    pendingPageCandidateInteractionId: undefined,
    pendingPageCandidateRevision: undefined,
    propsRevisionByExport: new Map(),
    renderabilityByExport: new Map(),
    resolverPropsByExport: new Map(),
    resolverPropsRevision: previewEntryRevision,
    renderScenario:
      persisted.renderScenario === 'file-components' ? 'file-components' : 'authored-page',
    selectedExportName:
      typeof persisted.selectedExportName === 'string' ? persisted.selectedExportName : '',
    selectedPageCandidateId:
      typeof persisted.selectedPageCandidateId === 'string' ? persisted.selectedPageCandidateId : '',
    selectedTreeNodeId:
      typeof persisted.selectedTreeNodeId === 'string' ? persisted.selectedTreeNodeId : undefined,
    targetOwnershipPhasesByIdentity: new Map(),
    treeListeners: new Set(),
    treeDirty: true,
    userSelectedPageCandidateId:
      typeof persisted.userSelectedPageCandidateId === 'string'
        ? persisted.userSelectedPageCandidateId
        : typeof persisted.selectedPageCandidateId === 'string' ? persisted.selectedPageCandidateId : '',
    version: 0,
    interactionSequence: 0,
  };
}
const previewInspectorSession =
  previewHotRuntime.inspectorSession ?? createPreviewInspectorSession();
previewHotRuntime.inspectorSession = previewInspectorSession;
previewInspectorSession.instanceEpochByExport ??= new Map();
previewInspectorSession.targetOwnershipPhasesByIdentity ??= new Map();
previewInspectorSession.lastRequestedRouteSelectionPath ??= undefined;
previewInspectorSession.pendingRouteBranchId ??= undefined;
previewInspectorSession.pendingRouteBuildRevision ??= undefined;
previewInspectorSession.pendingRouteInteractionId ??= undefined;
previewInspectorSession.pendingRouteBranchRevision ??= undefined;
previewInspectorSession.pendingRouteError ??= undefined;
previewInspectorSession.pendingRouteSelectionPath ??= undefined;
previewInspectorSession.pendingRouteTimeout ??= undefined;
previewInspectorSession.pendingPageCandidateId ??= undefined;
previewInspectorSession.pendingPageCandidateInteractionId ??= undefined;
previewInspectorSession.pendingPageCandidateRevision ??= undefined;
previewInspectorSession.interactionSequence ??= 0;
previewInspectorSession.selectionStatusHandler = handlePreviewInspectorSelectionStatus;
if (!previewInspectorSession.selectionStatusListenerInstalled) {
  previewInspectorSession.selectionStatusListenerInstalled = true;
  window.addEventListener('message', (event) =>
    previewHotRuntime.inspectorSession?.selectionStatusHandler?.(event.data),
  );
}
if (previewInspectorSession.resolverPropsRevision !== previewEntryRevision) {
  /* Automatic overlay props belong only to one built source revision, never persisted user state. */
  previewInspectorSession.resolverPropsByExport = new Map();
  previewInspectorSession.resolverPropsRevision = previewEntryRevision;
}
previewInspectorSession.resolverPropsByExport ??= new Map();
previewInspectorSession.renderabilityByExport ??= new Map();
previewInspectorSession.treeListeners ??= new Set();
previewInspectorSession.treeDirty ??= true;
previewInspectorSession.userSelectedPageCandidateId ??= '';
function getPreviewInspectorVersion() {
  return previewInspectorSession.version;
}
function subscribePreviewInspector(listener) {
  previewInspectorSession.listeners.add(listener);
  return () => previewInspectorSession.listeners.delete(listener);
}
function usePreviewInspectorStore() {
  const [, setVersion] = React.useState(getPreviewInspectorVersion);
  React.useEffect(
    () => subscribePreviewInspector(() => setVersion(getPreviewInspectorVersion())),
    [],
  );
}
function notifyPreviewInspector() {
  previewInspectorSession.version += 1;
  for (const listener of [...previewInspectorSession.listeners]) {
    listener();
  }
}
function registerPreviewInspectorTargetRenderability(exportName, renderable) {
  if (typeof exportName !== 'string' || exportName.length === 0 || typeof renderable !== 'boolean') {
    return;
  }
  const previous = previewInspectorSession.renderabilityByExport.get(exportName);
  if (previous === renderable) return;
  previewInspectorSession.renderabilityByExport.set(exportName, renderable);
  const descriptorOwnsExport = previewInspectorSession.descriptors.some((descriptor) =>
    descriptor?.inspector?.target?.exportName === exportName ||
    Object.hasOwn(descriptor?.inspector?.renderChainsByExport ?? {}, exportName),
  );
  if (renderable && descriptorOwnsExport) {
    if (!previewInspectorSession.descriptorNames.includes(exportName)) {
      previewInspectorSession.descriptorNames = [...previewInspectorSession.descriptorNames, exportName];
    }
  } else if (!renderable) {
    previewInspectorSession.descriptorNames = previewInspectorSession.descriptorNames.filter(
      (name) => name !== exportName,
    );
  }
  if (!renderable && previewInspectorSession.selectedExportName === exportName) {
    const fallback = previewInspectorSession.descriptors.flatMap((descriptor) => [
      descriptor?.inspector?.target?.exportName,
      ...Object.keys(descriptor?.inspector?.renderChainsByExport ?? {}),
    ]).find((name) =>
      typeof name === 'string' &&
      previewInspectorSession.renderabilityByExport.get(name) !== false,
    );
    previewInspectorSession.selectedExportName = fallback ??
      previewInspectorSession.descriptorNames[0] ?? '';
    previewInspectorSession.selectedTreeNodeId = undefined;
    resetPreviewInspectorTargetReachability();
  }
  persistPreviewInspectorState();
  notifyPreviewInspector();
  schedulePreviewInspectorTreeRefresh();
  schedulePreviewInspectorCommitRefresh();
}
function setPreviewInspectorDescriptors(descriptors) {
  const replacingExistingDescriptors =
    Array.isArray(previewInspectorSession.descriptors) &&
    previewInspectorSession.descriptors.length > 0 &&
    previewInspectorSession.descriptors !== descriptors;
  previewInspectorSession.descriptors = Array.isArray(descriptors) ? descriptors : [];
  const names = Array.isArray(descriptors)
    ? descriptors
        .map(
          (descriptor) =>
            descriptor?.inspector?.target?.exportName ??
            descriptor?.inspectedExportName ??
            descriptor?.exportName,
        )
        .filter((name) =>
          typeof name === 'string' && name.length > 0 &&
          previewInspectorSession.renderabilityByExport.get(name) !== false,
        )
    : [];
  const renderChainNames = previewInspectorSession.descriptors.flatMap((descriptor) =>
    Object.keys(descriptor?.inspector?.renderChainsByExport ?? {}).filter(
      (name) => previewInspectorSession.renderabilityByExport.get(name) !== false,
    ),
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
  const candidateChanged = reconcilePreviewInspectorPageCandidateSelection(candidateIds);
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
    previewInspectorSession.instanceEpochByExport,
    previewInspectorSession.propsRevisionByExport,
    previewInspectorSession.resolverPropsByExport,
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
  const reachabilityChanged = replacingExistingDescriptors
    ? resetPreviewInspectorTargetReachability()
    : false;
  if (namesChanged || candidateChanged || reachabilityChanged) {
    persistPreviewInspectorState();
    notifyPreviewInspector();
  }
  schedulePreviewInspectorCommitRefresh();
}
function createPreviewInspectorRootName(root) {
  return '@root:' + String(root?.sourcePath ?? '') + ':' + String(root?.exportName ?? 'default');
}
function formatPreviewInspectorEntryName(name) {
  return name.startsWith('@root:') ? 'Root · ' + (name.split(':').at(-1) || 'default') : 'Target · ' + name;
}
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
function collectPreviewInspectorTreeSnapshot() {
  if (
    previewInspectorSession.treeDirty !== true &&
    previewInspectorSession.lastTreeSnapshot !== undefined
  ) {
    return previewInspectorSession.lastTreeSnapshot;
  }
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const selectedName = previewInspectorSession.selectedExportName;
  const instrumentedTargetName =
    descriptor?.inspector?.target?.exportName ?? descriptor?.exportName ?? selectedName;
  const selectedCandidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const selectedRoot = selectedCandidate?.root ?? descriptor?.inspector?.root;
  const rootName = selectedRoot === undefined
    ? undefined
    : createPreviewInspectorRootName(selectedRoot);
  const currentFileExportNames = [
    ...new Set([
      instrumentedTargetName,
      ...Object.keys(descriptor?.inspector?.renderChainsByExport ?? {}),
    ]),
  ];
  const targetName =
    selectedName !== rootName && currentFileExportNames.includes(selectedName)
      ? selectedName
      : instrumentedTargetName;
  const orderedExportNames = [
    targetName,
    ...currentFileExportNames.filter((exportName) => exportName !== targetName),
  ];
  const boundaries = orderedExportNames.flatMap((exportName) => {
    const reference =
      descriptor?.inspector?.renderChainsByExport?.[exportName]?.target ??
      (descriptor?.inspector?.target?.exportName === exportName
        ? descriptor.inspector.target
        : descriptor?.exportName === exportName &&
            typeof descriptor?.sourcePath === 'string' &&
            descriptor.sourcePath.length > 0
          ? { exportName, sourcePath: descriptor.sourcePath }
          : undefined);
    return [...readPreviewInspectorBoundariesForReference(reference)].map((boundary) => ({
      boundary,
      exportName,
      sourcePath: reference?.sourcePath,
    }));
  });
  const snapshot = collectPreviewInspectorFiberTree(
    boundaries,
    previewInspectorSession.selectedTreeNodeId,
    {
      descriptor,
      pageCandidate: selectedCandidate,
      rootExportName: rootName,
      selectedExportName: previewInspectorSession.selectedExportName,
      targetExportName: targetName,
      targetExportNames: currentFileExportNames,
    },
  );
  previewInspectorSession.lastTreeSnapshot = snapshot;
  previewInspectorSession.treeDirty = false;
  return snapshot;
}
function notifyPreviewInspectorTreeSubscribers() {
  for (const listener of [...previewInspectorSession.treeListeners]) {
    try {
      listener();
    } catch (error) {
      console.warn('[React Preview] Component tree subscriber failed.', error);
    }
  }
}
function subscribePreviewInspectorTree(listener) {
  if (typeof listener !== 'function') return () => undefined;
  previewInspectorSession.treeListeners.add(listener);
  return () => {
    previewInspectorSession.treeListeners.delete(listener);
  };
}
function selectPreviewInspectorTreeNode(nodeId, expectedExportName) {
  if (typeof nodeId !== 'string' || nodeId.length === 0) return;
  const snapshot = collectPreviewInspectorTreeSnapshot();
  let selection = selectPreviewInspectorFiberTreeNode(snapshot, nodeId);
  if (
    typeof expectedExportName === 'string' &&
    expectedExportName.length > 0 &&
    selection?.node?.exportName !== expectedExportName
  ) {
    const matchingIds = [...(snapshot.nodeById?.entries?.() ?? [])]
      .filter(([, node]) => node?.exportName === expectedExportName)
      .map(([id]) => id);
    selection = matchingIds.length === 1
      ? selectPreviewInspectorFiberTreeNode(snapshot, matchingIds[0])
      : undefined;
  }
  if (selection === undefined) return;
  previewInspectorSession.selectedTreeNodeId = selection.node.id;
  previewInspectorSession.explicitTreeSelectionId = selection.node.id;
  if (selection.hostNodes.length > 0) previewInspectorSession.highlightEnabled = true;
  previewInspectorSession.lastTreeSnapshot = snapshot;
  persistPreviewInspectorState();
  schedulePreviewInspectorTreeRefresh();
  schedulePreviewInspectorHighlight();
}
function encodePreviewInspectorSourceToken(bytes) {
  const cryptoBridge = previewInspectorSourceCrypto;
  if (cryptoBridge === undefined) return undefined;
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return cryptoBridge.encodeBase64(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
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
function createPreviewInspectorSourceNonce() {
  const cryptoBridge = previewInspectorSourceCrypto;
  if (cryptoBridge === undefined) return undefined;
  const bytes = new Uint8Array(16);
  cryptoBridge.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
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
  schedulePreviewInspectorTreeRefresh();
}
function selectPreviewInspectorExport(exportName) {
  if (
    typeof exportName !== 'string' ||
    exportName.length === 0 ||
    previewInspectorSession.renderabilityByExport.get(exportName) === false ||
    exportName === previewInspectorSession.selectedExportName
  ) {
    return;
  }
  previewInspectorSession.selectedTreeNodeId = undefined;
  resetPreviewInspectorTargetReachability();
  previewInspectorSession.selectedExportName = exportName;
  persistPreviewInspectorState();
  schedulePreviewInspectorTreeRefresh();
  schedulePreviewInspectorCommitRefresh();
}
function setPreviewInspectorPropsOverride(exportName, value, commit = true) {
  if (typeof exportName !== 'string' || exportName.length === 0) {
    return false;
  }
  const serializedValue = copyPreviewInspectorBlockerValueForJson(value, { nodes: 0 });
  previewInspectorSession.overridesByExport.set(
    exportName,
    normalizePreviewInspectorProps(serializedValue),
  );
  if (commit) {
    refreshPreviewInspectorExport(exportName, false);
    persistPreviewInspectorState();
  } else {
    const currentRevision = previewInspectorSession.propsRevisionByExport.get(exportName) ?? 0;
    previewInspectorSession.propsRevisionByExport.set(exportName, currentRevision + 1);
  }
  return true;
}
function setPreviewInspectorResolverPropsOverride(exportName, value, commit = true) {
  if (typeof exportName !== 'string' || exportName.length === 0) return false;
  const serializedValue = copyPreviewInspectorBlockerValueForJson(value, { nodes: 0 });
  previewInspectorSession.resolverPropsByExport.set(
    exportName,
    normalizePreviewInspectorProps(serializedValue),
  );
  if (commit) {
    refreshPreviewInspectorExport(exportName, false);
  } else {
    const revision = previewInspectorSession.propsRevisionByExport.get(exportName) ?? 0;
    previewInspectorSession.propsRevisionByExport.set(exportName, revision + 1);
  }
  return true;
}
function resetPreviewInspectorPropsOverride(exportName) {
  previewInspectorSession.overridesByExport.delete(exportName);
  refreshPreviewInspectorExport(exportName, false);
  persistPreviewInspectorState();
}
function refreshPreviewInspectorExport(exportName, persist = true) {
  const currentRevision = previewInspectorSession.propsRevisionByExport.get(exportName) ?? 0;
  previewInspectorSession.propsRevisionByExport.set(exportName, currentRevision + 1);
  const activeReachabilityKey = previewInspectorSession.activeTargetReachabilityKey;
  const activeReachabilityState = typeof activeReachabilityKey === 'string'
    ? previewInspectorSession.targetReachabilityByKey?.get(activeReachabilityKey)
    : undefined;
  if (activeReachabilityState?.targetExportName === exportName) {
    activeReachabilityState.probeRevision += 1;
  }
  if (persist) {
    persistPreviewInspectorState();
  }
  notifyPreviewInspector();
  schedulePreviewInspectorCommitRefresh();
}
function remountPreviewInspectorExport(exportName, persist = true) {
  const currentEpoch = previewInspectorSession.instanceEpochByExport.get(exportName) ?? 0;
  previewInspectorSession.instanceEpochByExport.set(exportName, currentEpoch + 1);
  refreshPreviewInspectorExport(exportName, persist);
}
function registerPreviewInspectorBoundary(exportName, sourcePath, boundary) {
  if (
    typeof exportName !== 'string' ||
    typeof sourcePath !== 'string' ||
    sourcePath.length === 0
  ) return () => undefined;
  const boundaries = previewInspectorSession.boundariesByExport.get(exportName) ?? new Set();
  boundaries.add(boundary);
  previewInspectorSession.boundariesByExport.set(exportName, boundaries);
  schedulePreviewInspectorCommitRefresh();
  return () => {
    boundaries.delete(boundary);
    if (boundaries.size === 0) {
      previewInspectorSession.boundariesByExport.delete(exportName);
    }
    schedulePreviewInspectorCommitRefresh();
  };
}
const PREVIEW_INSPECTOR_TARGET_OWNERSHIP_PHASES = new Set([
  'compiler-export-evidence',
  'local-binding-rewrite',
  'facade-resolution',
  'facade-evaluation',
  'wrapper-render',
  'boundary-commit',
  'source-export-match',
  'fiber-availability',
]);
function createPreviewInspectorTargetOwnershipIdentity(metadata) {
  return typeof metadata?.sourcePath === 'string' &&
    metadata.sourcePath.length > 0 &&
    typeof metadata?.exportName === 'string' &&
    metadata.exportName.length > 0
    ? metadata.sourcePath.replaceAll('\\', '/') + '\0' + metadata.exportName
    : undefined;
}
function registerPreviewInspectorTargetOwnershipPhase(metadata, phase) {
  const identity = createPreviewInspectorTargetOwnershipIdentity(metadata);
  if (identity === undefined || !PREVIEW_INSPECTOR_TARGET_OWNERSHIP_PHASES.has(phase)) {
    return false;
  }
  let state = previewInspectorSession.targetOwnershipPhasesByIdentity.get(identity);
  if (state === undefined) {
    state = {
      exportName: metadata.exportName,
      phases: new Set(),
      sourcePath: metadata.sourcePath.replaceAll('\\', '/'),
    };
    previewInspectorSession.targetOwnershipPhasesByIdentity.set(identity, state);
  }
  const previousSize = state.phases.size;
  state.phases.add(phase);
  if (state.phases.size !== previousSize) schedulePreviewInspectorCommitRefresh();
  return true;
}
function readPreviewInspectorTargetOwnershipPhases(metadata) {
  const identity = createPreviewInspectorTargetOwnershipIdentity(metadata);
  const state =
    identity === undefined
      ? undefined
      : previewInspectorSession.targetOwnershipPhasesByIdentity.get(identity);
  return Object.fromEntries(
    [...PREVIEW_INSPECTOR_TARGET_OWNERSHIP_PHASES].map((phase) => [
      phase,
      state?.phases?.has(phase) === true,
    ]),
  );
}
function readPreviewInspectorBoundariesForReference(reference) {
  const exportName = reference?.exportName;
  const sourcePath = typeof reference?.sourcePath === 'string'
    ? reference.sourcePath.replaceAll('\\', '/')
    : undefined;
  if (typeof exportName !== 'string' || sourcePath === undefined) return new Set();
  const boundaries = previewInspectorSession.boundariesByExport.get(exportName);
  if (!(boundaries instanceof Set)) return new Set();
  return new Set([...boundaries].filter((boundary) =>
    typeof boundary?.props?.sourcePath === 'string' &&
    boundary.props.sourcePath.replaceAll('\\', '/') === sourcePath &&
    boundary.props.exportName === exportName
  ));
}
function readPreviewInspectorActiveTargetBoundaries(exportName) {
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const reference = descriptor?.inspector?.target ?? (
    descriptor?.exportName === exportName &&
    typeof descriptor?.sourcePath === 'string' &&
    descriptor.sourcePath.length > 0
      ? { exportName, sourcePath: descriptor.sourcePath }
      : undefined
  );
  return reference?.exportName === exportName
    ? readPreviewInspectorBoundariesForReference(reference)
    : new Set();
}
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
const PreviewInspectorTargetBoundary = createPreviewInspectorTargetBoundaryFactory({ React });
const PreviewInspectorContextualBoundaryRoleContext = React.createContext(undefined);
function createPreviewInspectorElement(Component, props) {
  return React.isValidElement(Component)
    ? React.cloneElement(Component, props)
    : React.createElement(Component, props);
}
function PreviewInspectorTargetRenderer({ Component, contextualBoundaryRoleToken, forwardedRef, metadata, targetMarker, targetProps }) {
  usePreviewInspectorStore();
  const exportName = metadata?.exportName ?? Component?.displayName ?? Component?.name ?? 'default';
  const sourcePath = typeof metadata?.sourcePath === 'string' ? metadata.sourcePath : '';
  const targetIdentity = sourcePath.replaceAll('\\', '/') + '\0' + exportName;
  rememberPreviewInspectorTargetRuntimeOwner(exportName, Component);
  const ownershipToken = React.useMemo(
    () => createPreviewInspectorOwnershipToken(targetMarker, metadata),
    [targetMarker, metadata?.exportName, metadata?.sourcePath],
  );
  const contextualBoundaryRoleTokenFromFactory = React.useContext(PreviewInspectorContextualBoundaryRoleContext);
  const contextualBoundaryRole = typeof validatePreviewInspectorContextualBoundaryRoleToken === 'function'
    ? validatePreviewInspectorContextualBoundaryRoleToken(
        contextualBoundaryRoleToken ?? contextualBoundaryRoleTokenFromFactory,
        metadata,
      )
    : undefined;
  const fallbackValuesEnabled = readPreviewInspectorFallbackValuesEnabled();
  const generatedListSampleCount = readPreviewGeneratedListSampleCount();
  const automaticTargetProps = React.useMemo(
    () => createPreviewTargetPropsFromLayers(
      fallbackValuesEnabled ? metadata?.inferredPropShape : undefined,
      targetProps,
    ),
    [fallbackValuesEnabled, generatedListSampleCount, metadata?.inferredPropShape, targetProps],
  );
  React.useEffect(() => {
    registerPreviewInspectorBaseProps(exportName, automaticTargetProps);
  }, [exportName, automaticTargetProps]);
  const overrideProps = materializePreviewInspectorRuntimeFallbackOverride(
    previewInspectorSession.overridesByExport.get(exportName) ?? {},
  );
  const resolverProps = materializePreviewInspectorRuntimeFallbackOverride(
    previewInspectorSession.resolverPropsByExport.get(exportName) ?? {},
  );
  const effectiveProps = createPreviewPropsFromLayers(
    undefined,
    automaticTargetProps,
    resolverProps,
    overrideProps,
  );
  // Compare only while both props records are live. The resulting scalar lets the output proof
  // distinguish a retained route passed through this facade unchanged from a replacement supplied
  // by a later prop layer, without retaining a project element or exposing the role token.
  const ownChildrenDescriptor = targetProps !== null && typeof targetProps === 'object'
    ? Object.getOwnPropertyDescriptor(targetProps, 'children')
    : undefined;
  const effectiveChildrenDescriptor = effectiveProps !== null && typeof effectiveProps === 'object'
    ? Object.getOwnPropertyDescriptor(effectiveProps, 'children')
    : undefined;
  const contextualChildrenUnchanged = contextualBoundaryRole !== undefined &&
    ownChildrenDescriptor !== undefined && ownChildrenDescriptor.value !== undefined &&
    ownChildrenDescriptor.value !== null && effectiveChildrenDescriptor !== undefined &&
    effectiveChildrenDescriptor.value === ownChildrenDescriptor.value;
  if (forwardedRef !== undefined && forwardedRef !== null) {
    effectiveProps.ref = forwardedRef;
  }
  const revision = previewInspectorSession.propsRevisionByExport.get(exportName) ?? 0;
  const instanceEpoch = previewInspectorSession.instanceEpochByExport.get(exportName) ?? 0;
  const conditionRevision = readPreviewInspectorRenderConditionRevision();
  const targetElement = metadata?.intentionalNavigationOutput === true
    ? null
    : createPreviewInspectorElement(Component, {
        ...effectiveProps,
        key: targetIdentity + ':instance:' + String(instanceEpoch),
      });
  const targetBoundary = React.createElement(
    PreviewInspectorTargetBoundary,
    {
      exportName,
      key: targetIdentity,
      resetKey: String(revision) + ':' + String(conditionRevision),
      sourcePath,
      contextualBoundaryKey: contextualBoundaryRole?.key,
      contextualBoundaryRole: contextualBoundaryRole?.role,
      contextualChildrenUnchanged,
      effectControllerOutputCandidate: metadata?.effectControllerOutputCandidate === true,
      ownershipToken,
    },
    targetElement,
  );
  // The generated contextual role belongs only to this outer target facade. Without a reset
  // provider, a transparent target that returns the retained route leaks the same role into every
  // authored occurrence of that export below it, making the unique boundary selector fail closed.
  return contextualBoundaryRole === undefined
    ? targetBoundary
    : React.createElement(
        PreviewInspectorContextualBoundaryRoleContext.Provider,
        { value: undefined },
        targetBoundary,
      );
}

const previewInspectorLocalTargetWrapperMetadata = new WeakMap();
const previewInspectorLocalTargetWrapperCache = new WeakMap();
const PREVIEW_INSPECTOR_LOCAL_TARGET_OBJECT_TYPES = new Set([
  Symbol.for('react.forward_ref'),
  Symbol.for('react.lazy'),
  Symbol.for('react.memo'),
]);
const PREVIEW_INSPECTOR_LOCAL_TARGET_BLOCKED_STATICS = new Set([
  '$$typeof', '_debugInfo', '_init', '_payload', 'arguments', 'arity', 'callee', 'caller',
  'childContextTypes', 'compare', 'contextType', 'contextTypes', 'defaultProps', 'displayName',
  'getDefaultProps', 'getDerivedStateFromError', 'getDerivedStateFromProps', 'length', 'mixins',
  'name', 'propTypes', 'prototype', 'render', 'type',
]);

/** Accepts only compiler-shaped exact source/export metadata for a selected local binding. */
function normalizePreviewInspectorLocalTargetMetadata(metadata) {
  if (
    metadata?.compilerExportEvidence !== true ||
    metadata?.facadeResolutionEvidence !== true ||
    typeof metadata?.exportName !== 'string' ||
    metadata.exportName.length === 0 ||
    metadata.exportName.length > 240 ||
    typeof metadata?.sourcePath !== 'string' ||
    metadata.sourcePath.length === 0 ||
    metadata.sourcePath.length > 4_096 ||
    typeof metadata?.preparedSourceDigest !== 'string' ||
    metadata.preparedSourceDigest.length === 0 ||
    metadata.preparedSourceDigest.length > 128
  ) return undefined;
  return Object.freeze({
    ...metadata,
    exportName: metadata.exportName,
    sourcePath: metadata.sourcePath.replaceAll('\\', '/'),
  });
}

/** Mirrors the facade's final runtime check before changing one exported application value. */
function isPreviewInspectorLocalTargetRenderable(value) {
  if (typeof value === 'function' || React.isValidElement(value)) return true;
  if (value === null || typeof value !== 'object') return false;
  if (PREVIEW_INSPECTOR_LOCAL_TARGET_OBJECT_TYPES.has(value.$$typeof)) return true;
  // styled-components v6 exposes a forward-ref-shaped object. Some compatibility builds retain
  // its exact styled contract while the public $$typeof read is unavailable, so require all three
  // library-owned fields before treating that selected compiler export as renderable.
  return typeof value.render === 'function' &&
    typeof value.styledComponentId === 'string' &&
    value.styledComponentId.length > 0 &&
    value.componentStyle !== null && typeof value.componentStyle === 'object';
}

/** Preserves styled/HOC statics needed by same-module interpolation and wrapper composition. */
function copyPreviewInspectorLocalTargetStatics(source, target) {
  if ((typeof source !== 'object' && typeof source !== 'function') || source === null) return;
  for (const propertyName of Reflect.ownKeys(source)) {
    if (PREVIEW_INSPECTOR_LOCAL_TARGET_BLOCKED_STATICS.has(propertyName)) continue;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(source, propertyName);
      if (descriptor !== undefined) Object.defineProperty(target, propertyName, descriptor);
    } catch {
      /* Frozen or exotic component statics are non-essential to the render boundary. */
    }
  }
}

/**
 * Gives same-module references the exact boundary normally supplied by the selected import facade.
 * The wrapper is generated only for compiler-selected variable exports and is reused by the facade.
 */
function wrapPreviewInspectorLocalTarget(Component, rawMetadata) {
  const metadata = normalizePreviewInspectorLocalTargetMetadata(rawMetadata);
  if (metadata === undefined || !isPreviewInspectorLocalTargetRenderable(Component)) {
    return Component;
  }
  const identity = metadata.sourcePath + '\0' + metadata.exportName + '\0' +
    metadata.preparedSourceDigest;
  let wrappersByIdentity = previewInspectorLocalTargetWrapperCache.get(Component);
  if (!(wrappersByIdentity instanceof Map)) {
    wrappersByIdentity = new Map();
    previewInspectorLocalTargetWrapperCache.set(Component, wrappersByIdentity);
  }
  const existing = wrappersByIdentity.get(identity);
  if (existing !== undefined) return existing;
  const targetMarker = {};
  registerPreviewInspectorCompilerCapability(targetMarker, metadata);
  registerPreviewInspectorTargetOwnershipPhase(metadata, 'compiler-export-evidence');
  registerPreviewInspectorTargetOwnershipPhase(metadata, 'local-binding-rewrite');
  const WrappedPreviewInspectorLocalTarget = React.forwardRef((targetProps, forwardedRef) => {
    registerPreviewInspectorTargetOwnershipPhase(metadata, 'wrapper-render');
    registerPreviewInspectorCompilerCapability(targetMarker, metadata);
    return React.createElement(PreviewInspectorTargetRenderer, {
      Component,
      forwardedRef,
      metadata,
      targetMarker,
      targetProps,
    });
  });
  WrappedPreviewInspectorLocalTarget.displayName =
    'ReactPreviewInspectorLocal(' + metadata.exportName + ')';
  copyPreviewInspectorLocalTargetStatics(Component, WrappedPreviewInspectorLocalTarget);
  previewInspectorLocalTargetWrapperMetadata.set(WrappedPreviewInspectorLocalTarget, metadata);
  wrappersByIdentity.set(identity, WrappedPreviewInspectorLocalTarget);
  return WrappedPreviewInspectorLocalTarget;
}

/** Resolves one deferred source wrapper only after the entry-owned Inspector API is installed. */
function createPreviewInspectorLocalTargetElement(Component, metadata, targetProps, forwardedRef) {
  const WrappedTarget = wrapPreviewInspectorLocalTarget(Component, metadata);
  if (WrappedTarget === Component && !isPreviewInspectorLocalTargetRenderable(Component)) return null;
  return React.createElement(WrappedTarget, {
    ...(targetProps !== null && typeof targetProps === 'object' ? targetProps : {}),
    ...(forwardedRef === undefined || forwardedRef === null ? {} : { ref: forwardedRef }),
  });
}

/** Lets the import facade avoid adding a second boundary around the same exact local wrapper. */
function isPreviewInspectorLocalTargetWrapper(Component, rawMetadata) {
  if ((typeof Component !== 'object' && typeof Component !== 'function') || Component === null) {
    return false;
  }
  const expected = normalizePreviewInspectorLocalTargetMetadata(rawMetadata);
  const actual = previewInspectorLocalTargetWrapperMetadata.get(Component);
  return expected !== undefined && actual !== undefined &&
    actual.exportName === expected.exportName &&
    actual.sourcePath === expected.sourcePath &&
    actual.preparedSourceDigest === expected.preparedSourceDigest;
}
/** Creates one registered outer target without exposing its private role token to project props. */
function createPreviewInspectorContextualTargetElement(Component, metadata, roleToken, children) {
  const role = typeof validatePreviewInspectorContextualBoundaryRoleToken === 'function'
    ? validatePreviewInspectorContextualBoundaryRoleToken(roleToken, metadata)
    : undefined;
  if (role === undefined) return undefined;
  const descriptor = findSelectedPreviewInspectorDescriptor();
  const candidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const pathname = candidate?.routeLocation?.pathname;
  const targetElement = createPreviewCandidateRouterElement(
    React.createElement(Component, undefined, children),
    {
      initialEntry: typeof pathname === 'string' ? pathname : undefined,
      ownsRouter: false,
    },
  );
  return React.createElement(
    PreviewInspectorContextualBoundaryRoleContext.Provider,
    { value: roleToken },
    targetElement,
  );
}
const PreviewInspectorDirectTargetContext = React.createContext(undefined);
/** Reads the live extension-owned target token at an authored hook position. */
function usePreviewInspectorTargetOwnershipToken() {
  const OwnershipContext = readPreviewInspectorJsxOwnershipContext();
  return OwnershipContext === undefined ? undefined : React.useContext(OwnershipContext);
}
function PreviewInspectorDirectTarget(targetProps) {
  const definition = React.useContext(PreviewInspectorDirectTargetContext);
  return React.createElement(PreviewInspectorTargetRenderer, {
    Component: definition?.Component,
    forwardedRef: undefined,
    metadata: definition?.metadata,
    targetProps,
  });
}
function PreviewInspectorRoutedDirectTarget(targetProps) {
  return createPreviewCandidateRouterElement(
    React.createElement(PreviewInspectorDirectTarget, targetProps),
    { ownsRouter: false },
  );
}
function PreviewPageInspectorRootRenderer({ descriptor, previewConfig, storyContext, targetProps, useStorybook }) {
  usePreviewInspectorStore();
  if (descriptor?.inspector === undefined) {
    const metadata = {
      exportName: descriptor?.exportName ?? 'default',
      inferredPropShape: descriptor?.inferredPropShape,
      inferredProps: descriptor?.inferredProps,
      sourcePath: descriptor?.sourcePath,
    };
    const directTarget = useStorybook
      ? React.createElement(StorybookPreviewRoot, {
          PreviewTarget: PreviewInspectorRoutedDirectTarget,
          previewConfig,
          storyContext,
          targetProps,
        })
      : React.createElement(PreviewInspectorRoutedDirectTarget, targetProps);
    return React.createElement(
      PreviewInspectorDirectTargetContext.Provider,
      { value: { Component: descriptor?.value, metadata } },
      directTarget,
    );
  }
  const selectedCandidate = readSelectedPreviewInspectorPageCandidate(descriptor);
  const selectedRoot = selectedCandidate?.root ?? descriptor?.inspector?.root;
  const rootName = createPreviewInspectorRootName(selectedRoot);
  const automaticRootProps = normalizePreviewInspectorProps(
    selectedCandidate?.rootAutomaticProps ?? descriptor?.automaticProps ?? {},
  );
  const fallbackValuesEnabled = readPreviewInspectorFallbackValuesEnabled();
  const baseRootProps = createPreviewPropsFromLayers(
    fallbackValuesEnabled ? selectedCandidate?.rootInferredPropShape : undefined,
    automaticRootProps,
    targetProps,
  );
  React.useEffect(() => {
    registerPreviewInspectorBaseProps(rootName, baseRootProps);
  }, [rootName, stringifyPreviewInspectorProps(baseRootProps)]);
  const overrideProps = materializePreviewInspectorRuntimeFallbackOverride(
    previewInspectorSession.overridesByExport.get(rootName) ?? {},
  );
  const effectiveProps = { ...baseRootProps, ...overrideProps };
  const candidateKey = selectedCandidate?.id ?? 'nearest-authored-owner';
  return useStorybook
    ? React.createElement(StorybookPreviewRoot, {
        PreviewTarget: descriptor.value,
        key: candidateKey,
        previewConfig,
        storyContext: { ...storyContext, args: effectiveProps },
        targetProps: effectiveProps,
      })
    : createPreviewInspectorElement(descriptor.value, {
        ...effectiveProps,
        key: candidateKey,
      });
}
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
  const conditionRevision = readPreviewInspectorRenderConditionRevision();
  return React.createElement(
    PreviewExportErrorBoundary,
    {
      exportName: descriptor?.exportName ?? inspectedExportName,
      key: inspectedExportName + ':candidate:' + String(selectedCandidate?.id ?? ''),
      parentSlice: descriptor?.parentSlice,
      resetKey: String(targetRevision) + ':' + rootName + ':' + String(rootRevision) +
        ':data:' + String(dataRevision) + ':condition:' + String(conditionRevision),
    },
    children,
  );
}
const previewInspectorSourceNavigation = Object.freeze({
  openSource: openPreviewInspectorTreeSource,
});
const previewInspectorApi = {
  TargetRenderer: PreviewInspectorTargetRenderer,
  createContextualTargetElement: createPreviewInspectorContextualTargetElement,
  createLocalTargetElement: createPreviewInspectorLocalTargetElement,
  collectTree: collectPreviewInspectorTreeSnapshot,
  createPageCandidateElement: createPreviewInspectorPageCandidateElement,
  getDiagnostics: readPreviewInspectorSerializableDiagnostics,
  getSnapshot() {
    return {
      highlightEnabled: previewInspectorSession.highlightEnabled,
      selectedExportName: previewInspectorSession.selectedExportName,
      version: previewInspectorSession.version,
    };
  },
  registerTargetElement: registerPreviewInspectorTargetElement,
  isLocalTargetWrapper: isPreviewInspectorLocalTargetWrapper,
  registerJsxOwnershipContext: registerPreviewInspectorJsxOwnershipContext,
  registerCompilerCapability: registerPreviewInspectorCompilerCapability,
  registerContextualTargetFallback: registerPreviewInspectorContextualTargetFallback,
  registerOwnedHost: registerPreviewInspectorOwnedHost,
  registerTargetRenderability: registerPreviewInspectorTargetRenderability,
  registerTargetOwnershipPhase: registerPreviewInspectorTargetOwnershipPhase,
  registerVirtualPageSource: registerPreviewInspectorVirtualPageSource,
  registerDeferredUiTrigger: registerPreviewInspectorDeferredUiTrigger,
  registerDeferredUiTriggerMetadata: registerPreviewInspectorDeferredUiTriggerMetadata,
  registerLocalUiEventListener: registerPreviewInspectorLocalUiEventListener,
  registerRenderConditionDefinitions: registerPreviewInspectorRenderConditionDefinitions,
  registerGraphqlRenderPropUsage: registerPreviewInspectorGraphqlRenderPropUsage,
  previewAxiosRequest: previewInspectorAxiosRequest,
  previewFetch: previewInspectorFetch,
  recordConsoleEntry: recordPreviewInspectorConsoleEntry,
  recordRuntimeHealth: recordPreviewInspectorRuntimeHealth,
  resolveBackendRequest: resolvePreviewInspectorBackendRequest,
  resolveDataPayload: resolvePreviewInspectorDataPayload,
  resolveGraphqlFragment: resolvePreviewInspectorGraphqlFragmentValue,
  resolveGraphqlInterpolation: resolvePreviewInspectorGraphqlInterpolation,
  resolveOverlayActivationRenderValue: resolvePreviewInspectorOverlayActivationRenderValue,
  resolveRenderChoice: resolvePreviewInspectorRenderChoice,
  resolveRenderCondition: resolvePreviewInspectorRenderCondition,
  resolveRenderConditionLazy: resolvePreviewInspectorRenderConditionLazy,
  resolveRuntimeEffect: resolvePreviewInspectorRuntimeEffect,
  resolveRuntimeHook: resolvePreviewInspectorScopedRuntimeHook,
  wrapLocalTarget: wrapPreviewInspectorLocalTarget,
  useTargetOwnershipToken: usePreviewInspectorTargetOwnershipToken,
  unregisterLocalUiEventListener: unregisterPreviewInspectorLocalUiEventListener,
  readJsxOwnershipContext: readPreviewInspectorJsxOwnershipContext,
  remount: remountPreviewInspectorExport,
  resetPropsOverride: resetPreviewInspectorPropsOverride,
  selectExport: selectPreviewInspectorExport,
  selectNode: selectPreviewInspectorTreeNode,
  setHighlightEnabled: setPreviewInspectorHighlightEnabled,
  setPropsOverride: setPreviewInspectorPropsOverride,
  shouldRenderContextualTargetFallback: shouldRenderPreviewInspectorContextualTargetFallback,
  subscribe: subscribePreviewInspector,
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
registerPreviewRuntimeCapability('GraphQL documents', {
  readPreviewRuntimeStatus: readPreviewInspectorGraphqlDocumentStatus,
});
${companionRuntimeSource}
${propsUiRuntimeSource}
${devtoolsUiRuntimeSource}
`;
}
