/**
 * Generates one accessible React component-tree row for Page Inspector.
 *
 * Row presentation is isolated from snapshot collection so target-export highlighting, render-path
 * badges, blocker status, and Reveal actions can evolve without coupling Fiber compatibility code to
 * the DevTools shell layout.
 */

/**
 * Creates browser source for recursive component-tree rows and current-file export reveal controls.
 *
 * Expected lexical bindings include React plus selection, structure, condition, and blocker helpers
 * declared by the surrounding generated UI runtime.
 *
 * @returns Plain JavaScript source concatenated before the Components pane renders.
 */
export function createPreviewInspectorTreeNodeUiRuntimeSource(): string {
  return String.raw`
/** Selects one export row, admits its host outline, and lets the pane expand/scroll it into view. */
function revealPreviewInspectorCurrentFileExport(node) {
  selectPreviewInspectorUiNode(node);
  if (previewInspectorSession.highlightEnabled !== true) {
    setPreviewInspectorHighlightEnabled(true);
  } else {
    schedulePreviewInspectorHighlight();
  }
}

/** Labels inert entry/route evidence without presenting it as a mounted application component. */
function formatPreviewInspectorRenderContextBadge(node) {
  if (node?.edgeKind === 'workspace-render-root') return 'render root';
  if (node?.edgeKind === 'expected-output-group') return 'authored output';
  if (node?.edgeKind === 'expected-render-outcome') {
    return node.expectedOutcomeActive === true ? 'selected return' : 'inactive return';
  }
  if (node?.edgeKind === 'deferred-render-callback') {
    return node?.expectedFrontier === true ? 'callback output not observed' : 'awaiting callback';
  }
  if (node?.edgeKind === 'expected-jsx-component') {
    return node?.expectedFrontier === true ? 'output not observed' : 'authored child';
  }
  if (node?.kind === 'route') return node.certainty === 'conditional' ? 'route · conditional' : 'route';
  if (node?.kind === 'entry' && node.contextOnly === true) return 'entry';
  if (node?.kind === 'lazy' && node.contextOnly === true) return 'lazy path';
  if (node?.contextOnly === true && node.edgeKind === 'wrapper') return 'wrapper path';
  return undefined;
}

/**
 * Labels only proven absence from the active Fiber path.
 *
 * Analyzer-only JSX rows describe authored possibilities and cannot truthfully claim a mount state;
 * their nearest missing runtime frontier is reported separately as output evidence.
 */
function readPreviewInspectorTreePresenceBadge(node) {
  if (node?.mounted !== false || node?.expectedOutput === true) return undefined;
  return node?.currentFileExport === true ? 'not on active page path' : 'not mounted';
}

/** Summarizes one missing-output cause at the expectation group instead of every static descendant. */
function formatPreviewInspectorExpectedOutputBadge(node) {
  if (node?.edgeKind !== 'expected-output-group') return undefined;
  if (node?.props?.deferredCallbackPending === true) return 'CALLBACK OUTPUT NOT OBSERVED';
  if (node?.props?.wrapperOrFallbackHost === true) return 'FALLBACK VISIBLE';
  return node?.authoredOutputMissing === true ? 'OUTPUT NOT OBSERVED' : undefined;
}

/** Explains the distinction between live Fiber rows and source-only authored JSX evidence. */
function formatPreviewInspectorExpectedEvidenceTitle(node) {
  if (node?.edgeKind === 'expected-output-group') {
    if (node?.props?.deferredCallbackPending === true) {
      return 'A mounted callback receiver has not produced its authored JSX output yet.';
    }
    if (node?.props?.wrapperOrFallbackHost === true) {
      return 'The selected export owns fallback or wrapper DOM, but its authored output is not observed.';
    }
    return 'The selected export mounted without observable authored host output.';
  }
  if (node?.edgeKind === 'expected-render-outcome') {
    return node?.expectedOutcomeActive === true
      ? 'Selected authored return. Runtime presence is reported by its output group and live Fiber rows.'
      : 'Inactive authored return alternative; it is not a claim about the current Fiber tree.';
  }
  if (node?.edgeKind === 'deferred-render-callback') {
    return node?.expectedFrontier === true
      ? 'Authored callback output is the first source occurrence not observed in the live subtree.'
      : 'Authored callback output may appear after its receiver invokes the function child.';
  }
  return node?.expectedFrontier === true
    ? 'First authored source occurrence not observed in the live subtree.'
    : 'Authored child discovered statically; individual runtime presence is not asserted.';
}

/**
 * Serializes one normalized source location onto the authoritative tree row.
 *
 * The companion tab clones these inert attributes and can therefore issue a source-selection action
 * without serializing project objects or depending on a live Fiber. Approximate ancestry locations
 * remain explicitly marked so downstream UI never presents them as exact runtime evidence.
 */
function createPreviewInspectorTreeRowSourceAttributes(source) {
  const sourcePath = typeof source?.path === 'string' ? source.path : source?.sourcePath;
  if (typeof sourcePath !== 'string' || sourcePath.length === 0) return {};
  return {
    'data-react-preview-source-select': 'true',
    'data-rpi-source-approximate': typeof source.approximate === 'boolean'
      ? source.approximate ? 'true' : 'false'
      : undefined,
    'data-rpi-source-column': Number.isSafeInteger(source.column) && source.column > 0
      ? source.column
      : undefined,
    'data-rpi-source-line': Number.isSafeInteger(source.line) && source.line > 0
      ? source.line
      : undefined,
    'data-rpi-source-offset': Number.isSafeInteger(source.occurrenceStart) &&
      source.occurrenceStart >= 0
      ? source.occurrenceStart
      : undefined,
    'data-rpi-source-origin': typeof source.origin === 'string' ? source.origin : undefined,
    'data-rpi-source-path': sourcePath,
  };
}

/**
 * Renders one logical-AND control directly in its component-tree row.
 *
 * The button stops only the row click; the tree viewport's capture handler still records both scroll
 * axes before a condition remounts the page. A source-proven but short-circuited guard stays visible
 * and disabled until its preceding guard allows JavaScript to evaluate the live resolver.
 */
function PreviewInspectorComponentTreeConditionSwitch({ node }) {
  if (!isPreviewInspectorConditionNode(node) || node.condition?.kind !== 'logical-and') {
    return null;
  }
  const condition = node.condition;
  const reached = condition.reached !== false && typeof node.conditionId === 'string';
  const enabled = reached && condition.effectiveEnabled === true;
  const overridden = reached && (
    typeof condition.override === 'boolean' || typeof condition.autoOverride === 'boolean'
  );
  const stopRowClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  return React.createElement(
    'span',
    { className: 'rpi-tree-condition-controls' },
    React.createElement(
      'button',
      {
        'aria-checked': enabled,
        'aria-disabled': !reached,
        'aria-label': reached
          ? (enabled ? 'Disable ' : 'Enable ') + condition.expression
          : condition.expression + ' is not reached yet',
        className: 'rpi-row-action rpi-tree-condition-switch',
        disabled: !reached,
        onClick: (event) => {
          stopRowClick(event);
          if (reached) togglePreviewInspectorRenderCondition(node.conditionId);
        },
        role: 'switch',
        title: reached
          ? 'Toggle this JSX logical-AND condition'
          : 'Not reached yet; enable the preceding JSX switch first',
        type: 'button',
      },
      reached ? enabled ? 'On' : 'Off' : 'Wait',
    ),
    overridden
      ? React.createElement(
          'button',
          {
            'aria-label': 'Use authored value for ' + condition.expression,
            className: 'rpi-row-action rpi-tree-condition-reset',
            onClick: (event) => {
              stopRowClick(event);
              resetPreviewInspectorRenderConditionOverride(node.conditionId);
            },
            title: 'Use the project-authored condition value again',
            type: 'button',
          },
          'Authored',
        )
      : undefined,
  );
}

/** Renders one React-centered branch with export, route, overlay, condition, and blocker badges. */
function PreviewInspectorComponentTreeNode({
  expandedIds,
  focusableId,
  node,
  selectedId,
  setExpandedIds,
}) {
  const hasChildren = node.children.length > 0;
  const expanded = hasChildren && expandedIds.has(node.id);
  const selected = node.id === selectedId;
  const isCondition = isPreviewInspectorConditionNode(node) ||
    isPreviewInspectorRenderChoiceNode(node);
  const isDeferredUiTrigger = isPreviewInspectorDeferredUiTriggerNode(node);
  const isRenderControl = isPreviewInspectorBlockerNode(node);
  const isFlowOutcome = node?.blockerKind === 'target-reachability' &&
    node?.blocker?.pageRootCommitted === true && node?.blocker?.targetMounted !== true;
  const isBlocking = isPreviewInspectorBlockingNode(node) && !isFlowOutcome;
  const isPathProbe = node?.blockerKind === 'target-reachability' &&
    !isBlocking && !isFlowOutcome;
  const isAssisted = isRenderControl && !isCondition && !isBlocking && !isPathProbe;
  const isOverlay = isPreviewInspectorOverlayNode(node);
  const isWrapper = isPreviewInspectorTransparentWrapperNode(node);
  const isBlockedOwner = node.blockedOwner === true;
  const isCurrentFileExport = node.currentFileExport === true;
  const isActiveExport = node.exportName === previewInspectorSession.selectedExportName;
  const hiddenHostCount = countPreviewInspectorHiddenElementsForTreeNode(node.id);
  const contextBadge = formatPreviewInspectorRenderContextBadge(node);
  const expectedOutputBadge = formatPreviewInspectorExpectedOutputBadge(node);
  const presenceBadge = readPreviewInspectorTreePresenceBadge(node);
  const role = node.expectedOutput === true
    ? { key: 'expected', label: 'EXPECTED JSX' }
    : readPreviewInspectorTreeNodeRole(
        node,
        isCondition,
        isBlocking,
        isCurrentFileExport,
      );
  const toggle = () => {
    if (!hasChildren) return;
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(node.id)) next.delete(node.id); else next.add(node.id);
      return next;
    });
  };
  return React.createElement(
    'li',
    { role: 'none' },
    React.createElement('button', {
      'aria-label': (expanded ? 'Collapse ' : 'Expand ') + node.name,
      'data-react-preview-tree-toggle': node.id,
      hidden: true,
      onClick: toggle,
      tabIndex: -1,
      type: 'button',
    }),
    React.createElement(
      'div',
      {
        'aria-expanded': hasChildren ? expanded : undefined,
        'aria-selected': selected,
        className: 'rpi-tree-row' + (isCondition ? ' rpi-condition-row' : '') +
          (isBlocking ? ' rpi-blocker-row' : '') +
          (isFlowOutcome ? ' rpi-flow-outcome-row' : '') +
          (isAssisted ? ' rpi-assisted-row' : '') +
          (isPathProbe ? ' rpi-path-probe-row' : '') +
          (isBlockedOwner ? ' rpi-blocked-owner-row' : '') +
          (isCurrentFileExport ? ' rpi-current-export-row' : '') +
          readPreviewInspectorStructureRowClass(node),
        'data-render-blocked-owner': isBlockedOwner ? 'true' : undefined,
        'data-render-blocker': isBlocking ? 'true' : undefined,
        'data-render-condition': isCondition ? 'true' : undefined,
        'data-tree-role': role.key,
        'data-react-preview-tree-row': node.id,
        ...createPreviewInspectorTreeRowSourceAttributes(node.source),
        onClick: () => selectPreviewInspectorUiNode(node),
        onDoubleClick: toggle,
        role: 'treeitem',
        tabIndex: node.id === focusableId ? 0 : -1,
        title: isBlocking
          ? 'Rendering stops here. Select this row to apply a value or retry.'
          : isFlowOutcome
            ? 'This authored flow rendered without the current file. Select it to compare paths or inspect path evidence.'
          : isDeferredUiTrigger
            ? node.trigger?.available === true
              ? 'This authored event can reveal deferred UI. Activate it explicitly or inspect its source.'
              : 'Deferred UI source placeholder; its exact event handler is not currently mounted.'
          : isCondition
            ? 'This render control selects which React branch is visible. Select it to inspect the branches.'
            : isAssisted
              ? 'React Preview supplied a local value here. Select it to inspect or edit that value.'
              : isPathProbe
                ? 'React Preview is following the authored page path to find the current file.'
              : node.expectedOutput === true
                ? formatPreviewInspectorExpectedEvidenceTitle(node)
              : node.contextOnly === true
                ? 'Static page path evidence; this row is not a mounted React component.'
                : 'Mounted React component. Select it to inspect props, state, and source.',
      },
      React.createElement(
        'span',
        {
          'aria-hidden': true,
          className: 'rpi-twisty',
          'data-expandable': hasChildren,
          'data-react-preview-tree-toggle-control': hasChildren ? node.id : undefined,
          onClick: (event) => {
            if (!hasChildren) return;
            event.preventDefault();
            event.stopPropagation();
            toggle();
          },
          title: hasChildren ? (expanded ? 'Collapse component' : 'Expand component') : undefined,
        },
        hasChildren ? (expanded ? '▼' : '▶') : '',
      ),
      React.createElement(
        'span',
        { 'aria-hidden': true, className: 'rpi-component-icon' },
        readPreviewInspectorStructureIcon(node, isCondition, isBlocking, isCurrentFileExport),
      ),
      React.createElement(
        'span',
        { className: 'rpi-node-role', 'data-role': role.key },
        role.label,
      ),
      React.createElement('span', { className: 'rpi-node-name' }, node.name),
      selected ? React.createElement('span', { className: 'rpi-badge' }, 'selected') : undefined,
      isCurrentFileExport
        ? React.createElement(
            'span',
            { className: 'rpi-badge rpi-export-badge' },
            findSelectedPreviewInspectorDescriptor()?.inspector?.contextModule === undefined
              ? 'current file export'
              : 'consuming page root',
          )
        : undefined,
      isActiveExport
        ? React.createElement('span', { className: 'rpi-badge' }, 'active')
        : undefined,
      hiddenHostCount > 0
        ? React.createElement(
            'span',
            { className: 'rpi-badge', title: 'Exact picked host elements removed from layout' },
            'hidden ' + String(hiddenHostCount),
          )
        : undefined,
      presenceBadge
        ? React.createElement('span', { className: 'rpi-badge' }, presenceBadge)
        : undefined,
      expectedOutputBadge
        ? React.createElement('span', { className: 'rpi-badge rpi-blocker-badge' },
            expectedOutputBadge)
        : undefined,
      isBlockedOwner
        ? React.createElement('span', { className: 'rpi-badge rpi-blocker-badge' }, 'render blocked here')
        : undefined,
      contextBadge
        ? React.createElement('span', { className: 'rpi-badge' }, contextBadge)
        : undefined,
      isOverlay
        ? React.createElement(
            'span',
            { className: 'rpi-badge' },
            'overlay' + (node.overlayState ? ' · ' + node.overlayState : ''),
          )
        : undefined,
      isWrapper ? React.createElement('span', { className: 'rpi-badge' }, 'wrapper') : undefined,
      isBlocking
        ? React.createElement('span', { className: 'rpi-badge rpi-blocker-badge' },
            'BLOCKS PAGE · CLICK TO FIX')
        : isFlowOutcome
          ? React.createElement('span', { className: 'rpi-badge rpi-flow-outcome-badge' },
              'AUTHORED FLOW · TARGET ABSENT')
        : isAssisted
          ? React.createElement('span', { className: 'rpi-badge rpi-assisted-badge' },
              'PAGE CAN CONTINUE')
          : isPathProbe
            ? React.createElement('span', { className: 'rpi-badge rpi-assisted-badge' },
                'SEARCHING PAGE')
          : undefined,
      isRenderControl
        ? React.createElement('span', { className: 'rpi-badge' },
            formatPreviewInspectorBlockerBadge(node))
        : undefined,
      React.createElement(PreviewInspectorComponentTreeConditionSwitch, { node }),
      React.createElement(PreviewInspectorDeferredUiTriggerRowAction, { node }),
      isCurrentFileExport
        ? React.createElement(
            'button',
            {
              'aria-label': 'Reveal ' + node.name + ' in the rendered page',
              className: 'rpi-row-action',
              onClick: (event) => {
                event.preventDefault();
                event.stopPropagation();
                revealPreviewInspectorCurrentFileExport(node);
              },
              title: presenceBadge !== undefined
                ? 'Reveal this export row; choose a page path that mounts it to highlight DOM output'
                : 'Reveal and highlight this current-file export in the rendered page',
              type: 'button',
            },
            'Reveal',
          )
        : undefined,
    ),
    expanded
      ? React.createElement(
          'ul',
          { className: 'rpi-tree-group', role: 'group' },
          node.children.map((child) => React.createElement(PreviewInspectorComponentTreeNode, {
            expandedIds,
            focusableId,
            key: child.id,
            node: child,
            selectedId,
            setExpandedIds,
          })),
        )
      : undefined,
  );
}
`;
}
