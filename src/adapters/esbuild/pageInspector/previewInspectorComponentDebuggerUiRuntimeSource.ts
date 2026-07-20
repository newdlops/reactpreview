/**
 * Generates the selected-component debugger shown beside the Page Component Tree.
 *
 * The debugger is intentionally component-scoped: it edits only instrumented props, compiler-
 * proven render conditions, exact picked-host visibility, and runtime/data records whose owner
 * identity matches the selected component. Arbitrary React hook slots remain read-only because
 * React provides no stable public mutation API for them.
 */

/**
 * Creates browser source for the Props, State, Source, and Payload component-debugger tabs.
 *
 * Expected lexical bindings include React, the Inspector tree/session helpers, props and blocker
 * editors, condition operations, payload/fallback registries, visibility controls, and the source
 * navigation bridge composed by the surrounding Page Inspector runtime.
 *
 * @returns Plain JavaScript source concatenated into the isolated Inspector UI runtime.
 */
export function createPreviewInspectorComponentDebuggerUiRuntimeSource(): string {
  return String.raw`
const previewInspectorComponentDebuggerTabs = new Set(['props', 'state', 'source', 'payload']);

/** Normalizes wrapper display names without conflating unrelated component owners. */
function normalizePreviewInspectorComponentDebuggerOwnerName(value) {
  if (typeof value !== 'string') return '';
  let normalized = value.trim();
  for (let depth = 0; depth < 4; depth += 1) {
    const match = /^(?:ForwardRef|Memo|ReactPreviewInspector|Styled)\((.+)\)$/u.exec(normalized);
    if (match === null) break;
    normalized = match[1].trim();
  }
  return normalized;
}

/** Normalizes only path separators; filesystem resolution remains outside the browser runtime. */
function normalizePreviewInspectorComponentDebuggerSourcePath(value) {
  return typeof value === 'string' ? value.replaceAll('\\', '/') : '';
}

/** Matches an exact path or one absolute/relative representation of the same authored module. */
function matchesPreviewInspectorComponentDebuggerSourcePath(leftValue, rightValue) {
  const left = normalizePreviewInspectorComponentDebuggerSourcePath(leftValue);
  const right = normalizePreviewInspectorComponentDebuggerSourcePath(rightValue);
  if (left.length === 0 || right.length === 0) return true;
  if (left === right) return true;
  const leftAbsolute = left.startsWith('/') || /^[A-Za-z]:\//u.test(left);
  const rightAbsolute = right.startsWith('/') || /^[A-Za-z]:\//u.test(right);
  if (leftAbsolute === rightAbsolute) return false;
  const absolute = leftAbsolute ? left : right;
  const relative = (leftAbsolute ? right : left).replace(/^\.\//u, '');
  return relative.length > 0 && absolute.endsWith('/' + relative);
}

/** Returns exact component identities admitted for compiler/runtime owner correlation. */
function readPreviewInspectorComponentDebuggerOwnerNames(node) {
  return new Set(
    [node?.name, node?.exportName]
      .map(normalizePreviewInspectorComponentDebuggerOwnerName)
      .filter((value) => value.length > 0),
  );
}

/**
 * Correlates a record only through an exact normalized owner name, then rejects a contradictory
 * source path. Source-only matching is intentionally disallowed because one file commonly owns
 * many components and hooks.
 */
function isPreviewInspectorRecordOwnedByComponent(record, node) {
  const ownerName = normalizePreviewInspectorComponentDebuggerOwnerName(record?.ownerName);
  if (ownerName.length === 0 || !readPreviewInspectorComponentDebuggerOwnerNames(node).has(ownerName)) {
    return false;
  }
  return matchesPreviewInspectorComponentDebuggerSourcePath(
    record?.sourcePath,
    node?.source?.path ?? node?.source?.sourcePath,
  );
}

/** Collects direct blocker IDs already assigned to this component by the tree owner resolver. */
function readPreviewInspectorComponentDirectBlockerIds(node, blockerKind) {
  return new Set(
    (Array.isArray(node?.children) ? node.children : [])
      .filter((child) => child?.blockerKind === blockerKind && typeof child?.blockerId === 'string')
      .map((child) => child.blockerId),
  );
}

/**
 * Builds one deterministic component scope from direct tree assignments plus exact owner metadata.
 * Direct assignments win because the tree resolver also uses bounded source-line evidence when a
 * compiler cannot retain an owner name.
 */
function createPreviewInspectorComponentDebuggerScope(node, requests, fallbacks) {
  const directRequestIds = readPreviewInspectorComponentDirectBlockerIds(node, 'data-request');
  const directFallbackIds = readPreviewInspectorComponentDirectBlockerIds(
    node,
    'runtime-fallback',
  );
  const ownedRequests = (Array.isArray(requests) ? requests : []).filter(
    (record) => directRequestIds.has(record?.id) || isPreviewInspectorRecordOwnedByComponent(record, node),
  );
  const ownedFallbacks = (Array.isArray(fallbacks) ? fallbacks : []).filter(
    (record) => directFallbackIds.has(record?.id) || isPreviewInspectorRecordOwnedByComponent(record, node),
  );
  const conditions = (Array.isArray(node?.children) ? node.children : []).filter(
    isPreviewInspectorConditionNode,
  );
  return { conditions, fallbacks: ownedFallbacks, requests: ownedRequests };
}

/** Labels the editable/read-only props surface with the exact selected component identity. */
function PreviewInspectorComponentScopedPropsDetail({ node }) {
  return React.createElement(
    React.Fragment,
    undefined,
    React.createElement(
      'div',
      { className: 'rpi-meta rpi-component-debugger-scope' },
      'Selected component props · ' + String(node?.name ?? node?.id ?? 'unknown'),
    ),
    React.createElement(PreviewInspectorPropsDetail, { node }),
  );
}

/** Renders one compact compiler-instrumented branch switch owned by the selected component. */
function PreviewInspectorComponentRenderStateControl({ node }) {
  const condition = node.condition;
  const forced = typeof condition?.override === 'boolean';
  const targetGuided = typeof condition?.autoOverride === 'boolean';
  const effective = condition?.effectiveEnabled === true;
  return React.createElement(
    'div',
    { className: 'rpi-source-card' },
    React.createElement('strong', undefined, condition?.expression ?? 'Conditional render'),
    React.createElement(
      'div',
      { className: 'rpi-meta' },
      (condition?.kind ?? 'condition') + ' · effective ' + String(effective) + ' · ' +
        (forced ? 'USER FORCED' : targetGuided ? 'TARGET-GUIDED' : 'AUTHORED'),
    ),
    React.createElement(
      'div',
      { className: 'rpi-note' },
      'Authored ' + String(condition?.authoredEnabled === true) + ' · ' +
        (effective ? condition?.truthyLabel : condition?.falsyLabel),
    ),
    React.createElement(
      'div',
      { className: 'rpi-actions' },
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          onClick: () => setPreviewInspectorRenderConditionOverride(condition.id, true),
          pressed: condition.override === true,
          title: 'Force this compiler-proven truthy render branch',
        },
        'True · ' + condition.truthyLabel,
      ),
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          onClick: () => setPreviewInspectorRenderConditionOverride(condition.id, false),
          pressed: condition.override === false,
          title: 'Force this compiler-proven falsy or hidden render branch',
        },
        'False · ' + condition.falsyLabel,
      ),
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          disabled: !forced && !targetGuided,
          onClick: () => resetPreviewInspectorRenderConditionOverride(condition.id),
          title: 'Return this branch to its authored runtime value',
        },
        'Use authored',
      ),
    ),
  );
}

/** Renders safe render-state controls while leaving arbitrary React hook slots observational. */
function PreviewInspectorComponentRenderStateDetail({ node, scope }) {
  const editable = isPreviewInspectorUiNodeEditable(node);
  const hiddenElements = readPreviewInspectorHiddenElementSummaries().filter(
    (summary) => summary.treeNodeId === node?.id,
  );
  return React.createElement(
    'div',
    { className: 'rpi-detail-content' },
    React.createElement(
      'div',
      { className: 'rpi-meta' },
      'Render state · ' + String(scope.conditions.length) + ' compiler-proven switch(es)',
    ),
    React.createElement(
      'div',
      { className: 'rpi-actions' },
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          disabled: !editable,
          onClick: () => remountPreviewInspectorExport(node.exportName),
          title: editable
            ? 'Remount this instrumented export without mutating hook slots'
            : 'Arbitrary Fiber components cannot be independently remounted through a public React API',
        },
        'Remount component',
      ),
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          onClick: () => setPreviewInspectorHighlightEnabled(!previewInspectorSession.highlightEnabled),
          pressed: previewInspectorSession.highlightEnabled,
          title: 'Toggle outlines for the selected component host roots',
        },
        'Highlight component',
      ),
      React.createElement(
        PreviewInspectorDevtoolsButton,
        {
          onClick: () => setPreviewInspectorPickerEnabled(true),
          pressed: previewInspectorSession.pickerEnabled,
          title: 'Pick an exact rendered host before hiding it from the preview layout',
        },
        'Pick child to hide',
      ),
    ),
    scope.conditions.length === 0
      ? React.createElement(
          'div',
          { className: 'rpi-empty' },
          'No instrumented &&, ternary, early-return, or overlay visibility switch is owned by this component yet.',
        )
      : scope.conditions.map((conditionNode) => React.createElement(
          PreviewInspectorComponentRenderStateControl,
          { key: conditionNode.id, node: conditionNode },
        )),
    hiddenElements.map((summary) => React.createElement(
      'div',
      { className: 'rpi-source-card', key: summary.id },
      React.createElement('strong', undefined, 'Hidden host · ' + summary.label),
      React.createElement(
        'div',
        { className: 'rpi-actions' },
        React.createElement(
          PreviewInspectorDevtoolsButton,
          { onClick: () => restorePreviewInspectorHiddenElement(summary.id) },
          'Show host',
        ),
      ),
    )),
    React.createElement('div', { className: 'rpi-meta' }, 'Observed React state / hooks'),
    React.createElement(
      'pre',
      { className: 'rpi-json' },
      stringifyPreviewInspectorProps(node?.state ?? {}),
    ),
    React.createElement(
      'div',
      { className: 'rpi-note' },
      'Hook and class-state snapshots are read-only. React has no stable public API for rewriting arbitrary hook slots; use the compiler-proven switches, page UI, props, payloads, visibility, or a remount instead.',
    ),
  );
}

/** Renders source navigation and the exact evidence used to scope mutable runtime records. */
function PreviewInspectorComponentSourceEvidenceDetail({ node, scope }) {
  const sourcePath = node?.source?.path ?? node?.source?.sourcePath;
  return React.createElement(
    'div',
    { className: 'rpi-detail-content' },
    React.createElement(PreviewInspectorSourceDetail, { node }),
    React.createElement(
      'div',
      { className: 'rpi-source-card' },
      React.createElement('strong', undefined, 'Component ownership evidence'),
      React.createElement('div', { className: 'rpi-note' }, 'Tree identity: ' + String(node?.id ?? 'unknown')),
      React.createElement('div', { className: 'rpi-note' }, 'Runtime name: ' + String(node?.name ?? 'unknown')),
      React.createElement('div', { className: 'rpi-note' }, 'Export: ' + String(node?.exportName ?? 'not instrumented')),
      React.createElement('div', { className: 'rpi-note' }, 'Source: ' + String(sourcePath ?? 'unavailable')),
      React.createElement(
        'div',
        { className: 'rpi-note' },
        'Scoped evidence: ' + String(scope.conditions.length) + ' render switch(es), ' +
          String(scope.fallbacks.length) + ' runtime fallback(s), ' +
          String(scope.requests.length) + ' backend request(s).',
      ),
    ),
  );
}

/** Renders only the hook fallbacks and backend requests owned by the selected component. */
function PreviewInspectorComponentPayloadDetail({ node, scope }) {
  const fallbackIdentity = scope.fallbacks.map((fallback) => fallback.id).join('\u0000');
  const [fallbackId, setFallbackId] = React.useState(() => scope.fallbacks[0]?.id ?? '');
  React.useEffect(() => {
    if (!scope.fallbacks.some((fallback) => fallback.id === fallbackId)) {
      setFallbackId(scope.fallbacks[0]?.id ?? '');
    }
  }, [node?.id, fallbackIdentity]);
  const selectedFallback = scope.fallbacks.find((fallback) => fallback.id === fallbackId) ??
    scope.fallbacks[0];
  return React.createElement(
    'div',
    { className: 'rpi-detail-content' },
    React.createElement(
      'div',
      { className: 'rpi-meta' },
      'Component-owned payloads · ' + String(scope.requests.length) + ' backend · ' +
        String(scope.fallbacks.length) + ' hook fallback',
    ),
    scope.requests.length === 0
      ? React.createElement(
          'div',
          { className: 'rpi-empty' },
          'No backend or GraphQL request is proven to be owned by this component.',
        )
      : React.createElement(PreviewInspectorDataDetail, {
          requestIds: scope.requests.map((request) => request.id),
        }),
    scope.fallbacks.length === 0
      ? React.createElement(
          'div',
          { className: 'rpi-empty' },
          'No render-only runtime fallback is proven to be owned by this component.',
        )
      : React.createElement(
          React.Fragment,
          undefined,
          React.createElement(
            'select',
            {
              'aria-label': 'Component runtime fallback',
              className: 'rpi-select',
              onChange: (event) => setFallbackId(event.target.value),
              value: selectedFallback?.id ?? '',
            },
            scope.fallbacks.map((fallback) => React.createElement(
              'option',
              { key: fallback.id, value: fallback.id },
              fallback.hookName + ' · ' + fallback.mode,
            )),
          ),
          selectedFallback === undefined
            ? undefined
            : React.createElement(PreviewInspectorRuntimeBlockerDetail, {
                node: createPreviewInspectorRuntimeFallbackTreeNode(selectedFallback),
              }),
        ),
  );
}

/**
 * Renders the selected actual component as a React-oriented debugger with four stable sub-tabs.
 * Selecting another tree row keeps the chosen perspective while every scoped control recomputes
 * from the new component identity.
 */
function PreviewInspectorComponentDebuggerDetail({ node }) {
  const requests = readPreviewInspectorDataRequests();
  const fallbacks = readPreviewInspectorRuntimeFallbacks();
  const scope = createPreviewInspectorComponentDebuggerScope(node, requests, fallbacks);
  const initialTab = previewInspectorComponentDebuggerTabs.has(
    previewInspectorDevtoolsSessionState.componentDebuggerTab,
  ) ? previewInspectorDevtoolsSessionState.componentDebuggerTab : 'props';
  const [activeTab, setActiveTab] = React.useState(initialTab);
  const selectTab = (tab) => {
    if (!previewInspectorComponentDebuggerTabs.has(tab)) return;
    previewInspectorDevtoolsSessionState.componentDebuggerTab = tab;
    setActiveTab(tab);
    persistPreviewInspectorState();
  };
  const tabs = [
    ['props', 'Props'],
    ['state', 'State'],
    ['source', 'Source'],
    ['payload', 'Payload'],
  ];
  return React.createElement(
    'div',
    { className: 'rpi-component-debugger', 'data-component-id': node?.id },
    React.createElement(
      'div',
      { 'aria-label': 'Selected component debugger views', className: 'rpi-tabs', role: 'tablist' },
      tabs.map(([id, label]) => React.createElement(
        'button',
        {
          'aria-controls': 'react-preview-component-debugger-' + id + '-panel',
          'aria-selected': activeTab === id,
          className: 'rpi-tab',
          id: 'react-preview-component-debugger-' + id + '-tab',
          key: id,
          onClick: () => selectTab(id),
          role: 'tab',
          type: 'button',
        },
        label,
      )),
    ),
    React.createElement(
      'div',
      {
        'aria-labelledby': 'react-preview-component-debugger-' + activeTab + '-tab',
        className: 'rpi-component-debugger-panel',
        id: 'react-preview-component-debugger-' + activeTab + '-panel',
        role: 'tabpanel',
      },
      activeTab === 'props'
        ? React.createElement(PreviewInspectorComponentScopedPropsDetail, { node })
        : activeTab === 'state'
          ? React.createElement(PreviewInspectorComponentRenderStateDetail, { node, scope })
          : activeTab === 'source'
            ? React.createElement(PreviewInspectorComponentSourceEvidenceDetail, { node, scope })
            : React.createElement(PreviewInspectorComponentPayloadDetail, { node, scope }),
    ),
  );
}
`;
}
