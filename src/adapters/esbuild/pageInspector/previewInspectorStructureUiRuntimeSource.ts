/** Generates UI-side normalization and presentation helpers for wrappers and overlay layers. */

/**
 * Creates structure helpers used by the DevTools-style component tree.
 * Collector metadata remains data-only; these helpers never access Fiber or application objects.
 *
 * @returns Plain JavaScript source for component admission, roles, icons, and row classes.
 */
export function createPreviewInspectorStructureUiRuntimeSource(): string {
  return String.raw`
/** Collector kinds representing authored/declarative boundaries, including project portals. */
const previewInspectorComponentKinds = new Set([
  'class',
  'component',
  'context',
  'entry',
  'forward-ref',
  'function',
  'lazy',
  'memo',
  'portal',
  'suspense',
  'target',
]);

/** Returns whether a collector node is an authored React boundary rather than an internal Fiber. */
function isPreviewInspectorComponentNode(node) {
  const kind = typeof node?.kind === 'string' ? node.kind.toLowerCase() : 'component';
  if (node?.isHost === true) return false;
  if (kind === 'root') {
    return typeof node?.exportName === 'string' && node.exportName.length > 0;
  }
  return previewInspectorComponentKinds.has(kind);
}

/** Reports portal, modal, and compiler-discovered dormant overlay entries uniformly. */
function isPreviewInspectorOverlayNode(node) {
  return node?.role === 'overlay' || node?.kind === 'portal' || node?.condition?.role === 'overlay';
}

/** Reports a mounted component that forwards children through hostless/provider boundaries. */
function isPreviewInspectorTransparentWrapperNode(node) {
  return node?.role === 'transparent-wrapper';
}

/** Reports whether the bounded neural sweep exhausted this exact blocker rather than another row. */
function hasPreviewInspectorResolutionEffortExhausted(node) {
  if (
    typeof readPreviewInspectorNeuralAssistanceReachability !== 'function' ||
    typeof createPreviewInspectorAutomaticNeuralAssistanceKey !== 'function' ||
    typeof createPreviewInspectorNeuralAssistanceAttemptIdentity !== 'function' ||
    typeof readPreviewInspectorNeuralAssistanceAttemptLimit !== 'function'
  ) return false;
  const reachability = readPreviewInspectorNeuralAssistanceReachability();
  if (reachability === undefined) return false;
  const key = createPreviewInspectorAutomaticNeuralAssistanceKey(reachability);
  const record = previewInspectorSession.automaticNeuralAssistanceByKey?.get?.(key);
  const identity = createPreviewInspectorNeuralAssistanceAttemptIdentity(node);
  if (record === undefined || typeof identity !== 'string') return false;
  const attempts = record.attemptsByBlocker?.get?.(identity) ?? 0;
  const effortRecord = Number.isSafeInteger(record.manualPasses)
    ? record
    : { ...record, manualPasses: 0 };
  return attempts >= readPreviewInspectorNeuralAssistanceAttemptLimit(
    effortRecord,
    node?.blockerKind,
  );
}

/** Reports a source-proven target repair that can run without asking the user to invent a value. */
function hasPreviewInspectorAutomaticTargetFailureRepair(node) {
  return node?.blockerKind === 'target-error' &&
    typeof createPreviewInspectorFinitePropChoiceMutation === 'function' &&
    createPreviewInspectorFinitePropChoiceMutation(node.blocker) !== undefined;
}

/** Classifies this exact unresolved row as automatic progress, a user decision, or a real error. */
function readPreviewInspectorResolutionKind(node) {
  if (node?.blockerKind === 'runtime-global') return 'error';
  const condition = node?.condition ?? (
    node?.blockerKind === 'render-condition' ? node?.blocker : undefined
  );
  if (
    condition !== undefined ||
    (typeof isPreviewInspectorConditionNode === 'function' && isPreviewInspectorConditionNode(node))
  ) {
    const rejected = previewInspectorSession.renderConditionRejectedAutoOverridesByKey?.get?.(
      condition?.reachabilityKey,
    );
    return condition?.requiresAuthoredState === true ||
      typeof condition?.override === 'boolean' || rejected?.has?.(condition?.id) === true ||
      hasPreviewInspectorResolutionEffortExhausted({
        ...node,
        blocker: condition,
        blockerKind: 'render-condition',
      })
      ? 'choice'
      : 'automatic';
  }
  if (node?.blockerKind === 'target-error') {
    if (hasPreviewInspectorAutomaticTargetFailureRepair(node)) return 'automatic';
    const choices = typeof readPreviewInspectorTargetFailurePropChoices === 'function'
      ? readPreviewInspectorTargetFailurePropChoices(node.blocker)
      : [];
    if (choices.length > 0) return 'choice';
    return hasPreviewInspectorResolutionEffortExhausted(node) ? 'error' : 'automatic';
  }
  if (node?.blockerKind === 'target-reachability') {
    if (node?.blocker?.status === 'awaiting-authored-state') return 'choice';
    return typeof isPreviewInspectorTargetReachabilityResolving === 'function' &&
      isPreviewInspectorTargetReachabilityResolving(node.blocker) &&
      !hasPreviewInspectorResolutionEffortExhausted(node)
      ? 'automatic'
      : 'choice';
  }
  if (['data-request', 'runtime-fallback'].includes(node?.blockerKind)) {
    return hasPreviewInspectorResolutionEffortExhausted(node) ? 'choice' : 'automatic';
  }
  return 'error';
}

/** Keeps exact exceptions ahead of generic reachability symptoms in every next-step surface. */
function readPreviewInspectorResolutionPriority(node) {
  const blockerKind = node?.blockerKind ?? (
    typeof isPreviewInspectorConditionNode === 'function' && isPreviewInspectorConditionNode(node)
      ? 'render-condition'
      : ''
  );
  const blockerPriority = [
    'target-error',
    'runtime-global',
    'render-condition',
    'runtime-fallback',
    'data-request',
    'target-reachability',
  ].indexOf(blockerKind);
  return blockerPriority < 0 ? 99 : blockerPriority;
}

/** Sorts unresolved rows in the same exception-first order used by the bounded neural resolver. */
function comparePreviewInspectorResolutionNodes(left, right) {
  return readPreviewInspectorResolutionPriority(left) -
    readPreviewInspectorResolutionPriority(right) ||
    String(left?.id ?? left?.blocker?.id ?? left?.blocker?.key ?? '').localeCompare(
      String(right?.id ?? right?.blocker?.id ?? right?.blocker?.key ?? ''),
    );
}

/** Uses a stable symbol vocabulary without the ambiguous generic exclamation mark. */
function readPreviewInspectorResolutionSymbol(node) {
  const kind = readPreviewInspectorResolutionKind(node);
  return kind === 'error' ? '×' : kind === 'automatic' ? '↻' : '?';
}

/** Produces a semantic tree icon while keeping the explicit role label available beside it. */
function readPreviewInspectorStructureIcon(node, isCondition, isBlocking, isCurrentFileExport) {
  if (isBlocking) return readPreviewInspectorResolutionSymbol(node);
  if (isCondition) return '?';
  if (node?.kind === 'deferred-ui-trigger') return '▶';
  if (node?.blockerKind === 'target-reachability') return '↳';
  if (node?.kind === 'blocker') return '≈';
  if (isCurrentFileExport) return '◎';
  if (node?.edgeKind === 'workspace-render-root') return '⌂';
  if (node?.edgeKind === 'hoc-wrapper') return 'H';
  if (node?.edgeKind === 'component-slot') return 'P';
  if (node?.kind === 'route' && node?.contextOnly === true) return '↳';
  if (node?.kind === 'entry' && node?.contextOnly === true) return '◆';
  if (isPreviewInspectorOverlayNode(node)) return '▱';
  if (isPreviewInspectorTransparentWrapperNode(node)) return '⬚';
  return 'C';
}

/** Gives every row one plain-language role so users never infer meaning from color alone. */
function readPreviewInspectorTreeNodeRole(node, isCondition, isBlocking, isCurrentFileExport) {
  if (
    node?.blockerKind === 'target-reachability' &&
    node?.blocker?.pageRootCommitted === true &&
    node?.blocker?.targetMounted !== true
  ) {
    return { key: 'path', label: 'FLOW OUTCOME' };
  }
  if (isBlocking) {
    const resolutionKind = readPreviewInspectorResolutionKind(node);
    if (resolutionKind === 'error') return { key: 'blocker', label: 'ERROR' };
    if (resolutionKind === 'automatic') return { key: 'assisted', label: 'RESOLVING' };
    return { key: 'condition', label: 'ACTION' };
  }
  if (isCondition) return { key: 'condition', label: 'CONDITION' };
  if (node?.kind === 'deferred-ui-trigger') return { key: 'condition', label: 'DEFERRED UI' };
  if (node?.blockerKind === 'target-reachability') {
    return { key: 'path', label: 'PAGE SEARCH' };
  }
  if (node?.kind === 'blocker') return { key: 'assisted', label: 'PREVIEW VALUE' };
  if (isCurrentFileExport) {
    const descriptor = typeof findSelectedPreviewInspectorDescriptor === 'function'
      ? findSelectedPreviewInspectorDescriptor()
      : undefined;
    const moduleContext = typeof readSelectedPreviewInspectorModuleContext === 'function'
      ? readSelectedPreviewInspectorModuleContext(descriptor)
      : descriptor?.inspector?.contextModule;
    return moduleContext === undefined
      ? { key: 'target', label: 'CURRENT FILE' }
      : { key: 'target', label: 'PAGE ROOT' };
  }
  if (node?.edgeKind === 'hoc-wrapper') return { key: 'path', label: 'HOC' };
  if (node?.edgeKind === 'component-slot') return { key: 'path', label: 'COMPONENT PROP' };
  if (node?.contextOnly === true) return { key: 'path', label: 'PAGE PATH' };
  return { key: 'component', label: 'COMPONENT' };
}

/** Adds narrowly scoped role classes without allowing collector-provided arbitrary class names. */
function readPreviewInspectorStructureRowClass(node) {
  if (isPreviewInspectorOverlayNode(node)) return ' rpi-overlay-row';
  if (node?.edgeKind === 'hoc-wrapper' || node?.edgeKind === 'component-slot') {
    return ' rpi-wrapper-row';
  }
  if (isPreviewInspectorTransparentWrapperNode(node)) return ' rpi-wrapper-row';
  return '';
}
`;
}
