/**
 * Generates exact-target activation for authored hooks that own a local visibility state machine.
 *
 * A modal can stay empty even after its component mounts when an effect normally calls a controller
 * such as `useModalActions`. This runtime observes only successful instrumented hook results, proves
 * one matching false visibility value and activation callback, then lets the settled reachability
 * probe invoke that callback outside render. Ambiguous controllers remain untouched.
 */
export function createPreviewInspectorLocalUiControllerRuntimeSource(): string {
  return String.raw`
const previewInspectorLocalUiVisibilityNames = new Set([
  'active',
  'expanded',
  'open',
  'present',
  'show',
  'shown',
  'visible',
]);

/** Recognizes conventional overlay exports when structural visibility evidence is unavailable. */
function isPreviewInspectorLocalUiOverlayTargetName(value) {
  return /(?:modal|dialog|drawer|popover|popper|popup|overlay|portal|sheet|lightbox|tooltip|toast|snackbar|dropdown|menu)s?(?:form|content|container|wrapper|view|panel)?$/iu.test(
    String(value ?? ''),
  );
}

/** Lazily owns ephemeral callbacks; none are persisted or exposed to the extension host. */
function initializePreviewInspectorLocalUiControllerState() {
  if (!(previewInspectorSession.localUiControllers instanceof Map)) {
    previewInspectorSession.localUiControllers = new Map();
  }
  if (!(previewInspectorSession.localUiControllerAttemptKeys instanceof Set)) {
    previewInspectorSession.localUiControllerAttemptKeys = new Set();
  }
}

/** Maps conventional Boolean/action spellings onto one positive UI state identity. */
function normalizePreviewInspectorLocalUiStateName(propertyName, action) {
  let normalized = String(propertyName).replace(/[-_]/gu, '').toLowerCase();
  if (normalized.startsWith('is') && normalized.length > 2) normalized = normalized.slice(2);
  if (action && normalized.startsWith('on') && normalized.length > 2) {
    normalized = normalized.slice(2);
  }
  return previewInspectorLocalUiVisibilityNames.has(normalized) ? normalized : undefined;
}

/** Reads only shallow own data properties; accessors and project prototypes are never invoked. */
function collectPreviewInspectorLocalUiControllerLeaves(value) {
  const visibility = [];
  const actions = [];
  const pending = [{ path: [], value }];
  let visited = 0;
  while (pending.length > 0 && visited < 48) {
    const current = pending.shift();
    if (
      current === undefined || current.path.length > 2 ||
      (typeof current.value !== 'object' && typeof current.value !== 'function') ||
      current.value === null
    ) continue;
    visited += 1;
    let descriptors;
    try { descriptors = Object.getOwnPropertyDescriptors(current.value); } catch { continue; }
    for (const [propertyName, descriptor] of Object.entries(descriptors).slice(0, 32)) {
      if (
        blockedInspectorPropNames.has(propertyName) ||
        !Object.hasOwn(descriptor, 'value') ||
        descriptor.enumerable !== true
      ) continue;
      const child = descriptor.value;
      const path = [...current.path, propertyName];
      const visibilityName = normalizePreviewInspectorLocalUiStateName(propertyName, false);
      if (child === false && visibilityName !== undefined) {
        const callableLeaves = new Set();
        let visibilityDescriptors;
        try { visibilityDescriptors = Object.getOwnPropertyDescriptors(current.value); } catch {}
        for (const descriptor of Object.values(visibilityDescriptors ?? {})) {
          if (Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'function') {
            callableLeaves.add(descriptor.value);
          }
        }
        visibility.push({
          callableLeaves,
          name: visibilityName,
          path: path.join('.'),
          receiver: current.value,
        });
        continue;
      }
      const actionName = normalizePreviewInspectorLocalUiStateName(propertyName, true);
      if (typeof child === 'function' && actionName !== undefined) {
        actions.push({ action: child, name: actionName, path: path.join('.'), receiver: current.value });
        continue;
      }
      if (current.path.length < 2 && typeof child === 'object' && child !== null) {
        pending.push({ path, value: child });
      }
    }
  }
  return { actions, visibility };
}

/** Retains one unambiguous authored state/action pair reached at an instrumented custom-hook site. */
function rememberPreviewInspectorLocalUiController(metadata, value) {
  initializePreviewInspectorLocalUiControllerState();
  const controllers = previewInspectorSession.localUiControllers;
  if (metadata.id.length === 0 || metadata.sourcePath.length === 0) return undefined;
  const leaves = collectPreviewInspectorLocalUiControllerLeaves(value);
  const pairs = leaves.visibility.flatMap((visibility) =>
    leaves.actions
      .filter((action) => action.name === visibility.name)
      .map((action) => ({ action, visibility })),
  );
  if (pairs.length !== 1) {
    controllers.delete(metadata.id);
    return undefined;
  }
  const pair = pairs[0];
  const controller = {
    action: pair.action.action,
    actionPath: pair.action.path,
    id: metadata.id,
    ownerName: metadata.ownerName,
    reachabilityKey:
      typeof previewInspectorSession.activeTargetReachabilityKey === 'string'
        ? previewInspectorSession.activeTargetReachabilityKey
        : undefined,
    receiver: pair.action.receiver,
    sourcePath: metadata.sourcePath.replaceAll('\\', '/'),
    visibilityCallableLeaves: pair.visibility.callableLeaves,
    visibilityPath: pair.visibility.path,
    visibilityReceiver: pair.visibility.receiver,
  };
  controllers.set(metadata.id, controller);
  return controller;
}

/** Preserves only the authored false visibility leaf while other missing hook fields stay fillable. */
function protectPreviewInspectorLocalUiVisibilityGuard(metadata, controller) {
  const visibilityPath = typeof controller?.visibilityPath === 'string'
    ? controller.visibilityPath
    : '';
  if (visibilityPath.length === 0 || !Array.isArray(metadata?.renderGuardPaths)) return metadata;
  const renderGuardPaths = metadata.renderGuardPaths.filter(
    (requiredPath) => String(requiredPath) !== visibilityPath,
  );
  return renderGuardPaths.length === metadata.renderGuardPaths.length
    ? metadata
    : { ...metadata, renderGuardPaths };
}

/** Accepts compiler-observed overlay visibility in the exact selected target, independent of name. */
function hasPreviewInspectorExactTargetLocalUiOverlayEvidence(state) {
  const targetSourcePath = String(state?.targetSourcePath ?? '').replaceAll('\\', '/');
  if (targetSourcePath.length === 0) return false;
  const exactOwnerNames = new Set([state.targetExportName]);
  const facadeOwnerNames =
    previewInspectorSession.targetFacadeRuntimeOwnerNamesByExport?.get?.(state.targetExportName);
  if (facadeOwnerNames instanceof Set) {
    for (const ownerName of facadeOwnerNames) exactOwnerNames.add(ownerName);
  }
  return [...(previewInspectorSession.renderConditions?.values?.() ?? [])].some((condition) =>
    condition?.reachabilityKey === state.key &&
    condition.kind === 'overlay-visibility' &&
    condition.role === 'overlay' &&
    String(condition.sourcePath ?? '').replaceAll('\\', '/') === targetSourcePath &&
    exactOwnerNames.has(condition.ownerName),
  );
}

/** Reads an own data property without invoking project accessors or inherited behavior. */
function readPreviewInspectorLocalUiOwnData(value, propertyName) {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined;
  }
  let descriptor;
  try { descriptor = Object.getOwnPropertyDescriptor(value, propertyName); } catch { return undefined; }
  return descriptor !== undefined && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

/** Finds the one committed exact target boundary without retaining project props beyond this probe. */
function readPreviewInspectorExactTargetLocalUiBoundaries(state) {
  const boundaries = previewInspectorSession.boundariesByExport?.get?.(state?.targetExportName);
  if (typeof boundaries?.values !== 'function') return [];
  const targetSourcePath = String(state?.targetSourcePath ?? '').replaceAll('\\', '/');
  return [...boundaries].filter((boundary) => {
    const props = readPreviewInspectorLocalUiOwnData(boundary, 'props');
    return readPreviewInspectorLocalUiOwnData(props, 'exportName') === state.targetExportName &&
      String(readPreviewInspectorLocalUiOwnData(props, 'sourcePath') ?? '').replaceAll('\\', '/') ===
        targetSourcePath;
  });
}

/** Proves a target input prop still holds the caller's false-state record or callback identity. */
function hasPreviewInspectorCallerLocalUiTargetPropProof(boundary, controller) {
  const boundaryProps = readPreviewInspectorLocalUiOwnData(boundary, 'props');
  const targetElement = readPreviewInspectorLocalUiOwnData(boundaryProps, 'children');
  const targetProps = readPreviewInspectorLocalUiOwnData(targetElement, 'props');
  const receiver = controller?.visibilityReceiver;
  const callableLeaves = controller?.visibilityCallableLeaves;
  if (
    (typeof receiver !== 'object' && typeof receiver !== 'function') || receiver === null ||
    !(callableLeaves instanceof Set)
  ) return false;
  const pending = [targetProps];
  let visited = 0;
  while (pending.length > 0 && visited < 48) {
    const current = pending.shift();
    if ((typeof current !== 'object' && typeof current !== 'function') || current === null) continue;
    visited += 1;
    let descriptors;
    try { descriptors = Object.getOwnPropertyDescriptors(current); } catch { continue; }
    for (const [propertyName, descriptor] of Object.entries(descriptors).slice(0, 32)) {
      if (blockedInspectorPropNames.has(propertyName) || !Object.hasOwn(descriptor, 'value')) continue;
      const child = descriptor.value;
      if (child === receiver || (typeof child === 'function' && callableLeaves.has(child))) return true;
      if (typeof child === 'object' && child !== null && visited < 48) pending.push(child);
    }
  }
  return false;
}

/** Admits a caller controller only through one authored path and one identity-safe target input. */
function hasPreviewInspectorCallerLocalUiControllerProof(state, controller) {
  if (
    !Array.isArray(state?.applicationPath) ||
    !state.applicationPath.includes(controller?.ownerName) ||
    controller?.sourcePath === state.targetSourcePath
  ) return false;
  const boundaries = readPreviewInspectorExactTargetLocalUiBoundaries(state);
  return boundaries.length === 1 && hasPreviewInspectorCallerLocalUiTargetPropProof(boundaries[0], controller);
}

/** Retains an authored positive overlay listener without changing emitter dispatch semantics. */
function registerPreviewInspectorLocalUiEventListener(metadata, emitter, event, listener) {
  initializePreviewInspectorLocalUiControllerState();
  if (
    metadata === null || typeof metadata !== 'object' ||
    typeof metadata.id !== 'string' || metadata.id.length === 0 ||
    typeof metadata.sourcePath !== 'string' || metadata.sourcePath.length === 0 ||
    typeof metadata.ownerName !== 'string' || metadata.ownerName.length === 0 ||
    typeof metadata.eventName !== 'string' || metadata.eventName.length === 0 ||
    typeof listener !== 'function'
  ) return;
  previewInspectorSession.localUiControllers.set(metadata.id, {
    action: listener,
    actionPath: metadata.occurrenceId ?? metadata.id,
    emitter,
    event,
    eventName: metadata.eventName,
    id: metadata.id,
    kind: 'event-listener',
    ownerName: metadata.ownerName,
    reachabilityKey:
      typeof previewInspectorSession.activeTargetReachabilityKey === 'string'
        ? previewInspectorSession.activeTargetReachabilityKey
        : undefined,
    sourcePath: metadata.sourcePath.replaceAll('\\', '/'),
  });
}

/** Removes only the exact authored listener record after its matching authored cleanup ran. */
function unregisterPreviewInspectorLocalUiEventListener(metadata, emitter, event, listener) {
  const controller = previewInspectorSession.localUiControllers?.get?.(metadata?.id);
  if (
    controller?.kind === 'event-listener' &&
    controller.emitter === emitter && controller.event === event && controller.action === listener
  ) previewInspectorSession.localUiControllers.delete(metadata.id);
}

/** Records an activation failure without allowing an optional controller to unmount the page. */
function recordPreviewInspectorLocalUiControllerFailure(controller, error, phase) {
  recordPreviewInspectorRuntimeEffectIsolation(
    {
      evidence: 'Exact selected target local UI activation',
      hookName: 'local UI controller',
      id: 'local-ui-controller:' + controller.id,
      ownerName: controller.ownerName,
      sourcePath: controller.sourcePath,
    },
    error,
    phase,
    previewInspectorSession.runtimeFallbackScopeKey,
  );
}

/**
 * Opens one exact-target local UI controller after its boundary mounted without host output.
 * Invocation happens from the settled reachability probe, never during the component render that
 * registered the hook result. Multiple possible controllers fail closed as a user choice.
 */
function autoActivatePreviewInspectorTargetLocalUiController(state) {
  if (
    state === undefined ||
    state.targetMounted !== true ||
    state.targetHasOutput === true ||
    !(
      isPreviewInspectorLocalUiOverlayTargetName(state.targetExportName) ||
      hasPreviewInspectorExactTargetLocalUiOverlayEvidence(state)
    ) ||
    previewInspectorSession.fallbackValuesEnabled !== true
  ) return undefined;
  initializePreviewInspectorLocalUiControllerState();
  const exactOwnerNames = new Set([state.targetExportName]);
  const facadeOwnerNames =
    previewInspectorSession.targetFacadeRuntimeOwnerNamesByExport?.get?.(state.targetExportName);
  if (facadeOwnerNames instanceof Set) {
    for (const ownerName of facadeOwnerNames) exactOwnerNames.add(ownerName);
  }
  const targetSourcePath = String(state.targetSourcePath ?? '').replaceAll('\\', '/');
  const matches = [...previewInspectorSession.localUiControllers.values()].filter((controller) =>
    controller?.reachabilityKey === state.key && (
      (controller.sourcePath === targetSourcePath && exactOwnerNames.has(controller.ownerName)) ||
      hasPreviewInspectorCallerLocalUiControllerProof(state, controller)
    ),
  );
  if (matches.length !== 1) return undefined;
  const controller = matches[0];
  const revision = typeof previewEntryRevision === 'number' ? previewEntryRevision : 0;
  const attemptKey = [revision, state.key, controller.id, controller.actionPath].join('\u0000');
  if (previewInspectorSession.localUiControllerAttemptKeys.has(attemptKey)) return undefined;
  previewInspectorSession.localUiControllerAttemptKeys.add(attemptKey);
  let result;
  try {
    result = controller.kind === 'event-listener'
      ? controller.action.call(undefined, Object.freeze({
          currentTarget: null,
          detail: Object.freeze({ identity: controller.id, source: 'page-inspector' }),
          preventDefault() {},
          stopPropagation() {},
          target: null,
          type: controller.eventName,
        }))
      : controller.action.call(controller.receiver);
  } catch (error) {
    recordPreviewInspectorLocalUiControllerFailure(controller, error, 'local UI activation');
    return undefined;
  }
  if (isPreviewInspectorRuntimeThenable(result)) {
    Promise.resolve(result).catch((error) =>
      recordPreviewInspectorLocalUiControllerFailure(
        controller,
        error,
        'async local UI activation',
      ),
    );
  }
  if (typeof recordPreviewInspectorBlockerAutoDecision === 'function') {
    recordPreviewInspectorBlockerAutoDecision({
      action: 'Activate selected target local UI',
      blockerId: 'target-local-ui:' + controller.id,
      blockerKind: 'target-reachability',
      blockerName: 'Hidden local UI · ' + state.targetExportName,
      generatedPaths: [controller.visibilityPath ?? controller.eventName],
      mode: 'target-overlay-auto',
      ownerName: controller.ownerName,
      reason: controller.kind === 'event-listener'
        ? 'The exact selected target mounted empty with one live positive overlay listener'
        : 'The exact selected target mounted empty with one matching visibility state and activation action',
      selectedValue: true,
      sourcePath: controller.sourcePath,
      startsRenderAttempt: true,
      targetReachabilityKey: state.key,
    });
  }
  return controller;
}
`;
}
