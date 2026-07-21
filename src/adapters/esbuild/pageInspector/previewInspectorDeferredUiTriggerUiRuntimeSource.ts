/**
 * Generates component-tree placeholders and explicit activation controls for deferred UI triggers.
 * Static metadata stays visible while the event prop is dormant; activation is enabled only when the
 * private runtime registry proves that the exact authored handler remains on a mounted Fiber.
 */

/**
 * Creates browser UI helpers consumed by the component-tree enricher, row, and details pane.
 *
 * Expected lexical bindings include React, condition-owner helpers, source normalization,
 * `PreviewInspectorDevtoolsButton`, and the private deferred-trigger runtime operations.
 */
export function createPreviewInspectorDeferredUiTriggerUiRuntimeSource(): string {
  return String.raw`
/** Reports one inert pseudo-node representing a user-fired imperative React UI branch. */
function isPreviewInspectorDeferredUiTriggerNode(node) {
  return node?.kind === 'deferred-ui-trigger' && typeof node.triggerId === 'string';
}

/** Converts a private runtime snapshot into a serializable component-tree placeholder. */
function createPreviewInspectorDeferredUiTriggerTreeNode(trigger) {
  const available = trigger.available === true;
  const statusLabel = available
    ? trigger.status === 'failed' ? 'failed' : trigger.status === 'invoked' ? 'activated' : 'ready'
    : trigger.mounted === true ? 'activation unavailable' : 'not mounted';
  return {
    children: [],
    id: 'deferred-ui-trigger:' + trigger.id,
    kind: 'deferred-ui-trigger',
    name: 'Deferred UI · ' + trigger.eventName + ' → ' + trigger.methodName + '() · ' + statusLabel,
    props: {
      activationCount: trigger.activationCount,
      available,
      event: trigger.eventName,
      method: trigger.methodName,
      status: trigger.status,
    },
    source: normalizePreviewInspectorUiSource({
      column: trigger.column,
      displayName: trigger.sourcePath,
      line: trigger.line,
      path: trigger.sourcePath,
    }),
    state: {
      expression: trigger.expression,
      lastError: trigger.lastError,
    },
    trigger,
    triggerId: trigger.id,
  };
}

/** Appends trigger placeholders without mutating the collector-owned component snapshot. */
function appendPreviewInspectorDeferredUiTriggers(nodes, assignments) {
  return nodes.map((node) => ({
    ...node,
    children: [
      ...appendPreviewInspectorDeferredUiTriggers(node.children, assignments),
      ...(assignments.get(node.id) ?? []).map(createPreviewInspectorDeferredUiTriggerTreeNode),
    ],
  }));
}

/** Collects live and static expected component owners while excluding every Inspector pseudo-node. */
function collectPreviewInspectorDeferredUiTriggerOwners(nodes, owners = [], depth = 0) {
  for (const node of nodes) {
    const sourcePath = normalizePreviewInspectorConditionSourcePath(node.source?.path);
    if (
      sourcePath.length > 0 &&
      !['blocker', 'condition', 'condition-group', 'deferred-ui-trigger',
        'deferred-ui-trigger-group', 'render-choice'].includes(node.kind)
    ) {
      owners.push({
        contextOnly: node.contextOnly === true,
        currentFileExport: node.currentFileExport === true,
        depth,
        exportName: node.exportName,
        id: node.id,
        line: Number.isSafeInteger(node.source?.line) ? node.source.line : 0,
        name: node.name,
        sourcePath,
      });
    }
    collectPreviewInspectorDeferredUiTriggerOwners(node.children, owners, depth + 1);
  }
  return owners;
}

/** Selects an exact same-file named owner, admitting static expected JSX when Fiber is absent. */
function findPreviewInspectorDeferredUiTriggerOwner(trigger, owners) {
  const sourcePath = normalizePreviewInspectorConditionSourcePath(trigger.sourcePath);
  if (sourcePath.length === 0) return undefined;
  const line = Number.isSafeInteger(trigger.line) ? trigger.line : 0;
  const ownerName = typeof trigger.ownerName === 'string' ? trigger.ownerName : '';
  let selected;
  let selectedScore = Number.POSITIVE_INFINITY;
  for (const owner of owners) {
    if (!matchesPreviewInspectorConditionSourcePath(owner.sourcePath, sourcePath)) continue;
    const exactName = ownerName.length > 0 &&
      (owner.name === ownerName || owner.exportName === ownerName);
    const precedes = owner.line <= line;
    const score = (exactName ? 0 : 10_000_000) +
      (owner.contextOnly ? 10_000 : 0) +
      (precedes ? 0 : 1_000_000) +
      Math.abs(line - owner.line) - owner.depth / 1_000;
    if (score < selectedScore) {
      selected = owner;
      selectedScore = score;
    }
  }
  return selected;
}

/**
 * Attaches each trigger to the nearest same-file named component and retains unmatched source in an
 * explicit root group. Metadata-only records therefore remain visible before any handler mounts.
 */
function attachPreviewInspectorDeferredUiTriggersToSnapshot(snapshot) {
  const triggers = readPreviewInspectorDeferredUiTriggers();
  if (triggers.length === 0) return snapshot;
  const owners = collectPreviewInspectorDeferredUiTriggerOwners(snapshot.roots);
  const assignments = new Map();
  const unowned = [];
  for (const trigger of triggers) {
    const owner = findPreviewInspectorDeferredUiTriggerOwner(trigger, owners);
    if (owner === undefined) {
      unowned.push(trigger);
      continue;
    }
    const assigned = assignments.get(owner.id) ?? [];
    assigned.push(trigger);
    assignments.set(owner.id, assigned);
  }
  const roots = appendPreviewInspectorDeferredUiTriggers(snapshot.roots, assignments);
  if (unowned.length > 0) {
    roots.push({
      children: unowned.map(createPreviewInspectorDeferredUiTriggerTreeNode),
      id: 'deferred-ui-triggers:unowned',
      kind: 'deferred-ui-trigger-group',
      name: 'Deferred UI triggers',
      props: undefined,
      source: undefined,
      state: undefined,
    });
  }
  return { ...snapshot, roots };
}

/** Invokes a selected trigger through the stale-safe private registry and refreshes its row state. */
function activatePreviewInspectorDeferredUiTrigger(node) {
  if (!isPreviewInspectorDeferredUiTriggerNode(node) || node.trigger?.available !== true) return;
  invokePreviewInspectorDeferredUiTrigger(node.triggerId);
}

/** Renders the compact one-shot action directly beside a deferred trigger tree row. */
function PreviewInspectorDeferredUiTriggerRowAction({ node }) {
  if (!isPreviewInspectorDeferredUiTriggerNode(node)) return null;
  const available = node.trigger?.available === true;
  const mountedUnavailable = node.trigger?.mounted === true && !available;
  return React.createElement(
    'button',
    {
      'aria-label': available
        ? 'Activate ' + node.trigger.methodName + ' deferred UI'
        : mountedUnavailable
          ? 'Activation unavailable: ' +
            String(node.trigger.unavailableReason ?? 'ambiguous mounted handler')
          : node.trigger.methodName + ' deferred UI is not mounted',
      className: 'rpi-row-action',
      disabled: !available,
      onClick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        activatePreviewInspectorDeferredUiTrigger(node);
      },
      title: available
        ? 'Invoke the authored handler once with no guessed arguments'
        : node.trigger.unavailableReason ??
          'The event handler is not attached to a mounted React component',
      type: 'button',
    },
    available ? 'Activate' : mountedUnavailable ? 'Unavailable' : 'Dormant',
  );
}

/** Explains and activates one selected deferred UI placeholder without pretending it is Boolean. */
function PreviewInspectorDeferredUiTriggerDetail({ node }) {
  const trigger = node.trigger;
  const available = trigger.available === true;
  const mountedUnavailable = trigger.mounted === true && !available;
  return React.createElement(
    'div',
    { className: 'rpi-detail-content' },
    React.createElement(
      'div',
      { className: 'rpi-meta' },
      'Deferred JSX event · ' + trigger.eventName + ' · ' +
        (available ? 'mounted callable' : 'source placeholder only'),
    ),
    React.createElement('pre', { className: 'rpi-json' }, trigger.expression),
    React.createElement(
      'div',
      { className: 'rpi-note' },
      available
        ? 'The exact authored handler is still attached to a mounted React Fiber. Activation calls it once without arguments.'
        : 'React Preview keeps this source-proven path visible but will not activate it: ' +
          String(trigger.unavailableReason ?? 'the event handler is not mounted') + '.',
    ),
    React.createElement(
      'div',
      { className: 'rpi-actions' },
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          disabled: !available,
          onClick: () => activatePreviewInspectorDeferredUiTrigger(node),
          title: available
            ? 'Invoke the original event handler once'
            : mountedUnavailable
              ? String(trigger.unavailableReason ?? 'Activation unavailable')
              : 'Wait for this event prop to mount before activation',
        },
        available
          ? 'Activate ' + trigger.methodName + '()'
          : mountedUnavailable
            ? 'Activation unavailable'
            : 'Handler not mounted',
      ),
    ),
    React.createElement(
      'div',
      { className: 'rpi-note' },
      'Activated ' + String(trigger.activationCount ?? 0) + ' time(s).' +
        (typeof trigger.lastError === 'string' ? ' Last failure: ' + trigger.lastError : ''),
    ),
  );
}
`;
}
