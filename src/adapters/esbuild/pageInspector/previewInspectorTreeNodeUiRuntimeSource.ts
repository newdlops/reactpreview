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
  if (node?.kind === 'route') return node.certainty === 'conditional' ? 'route · conditional' : 'route';
  if (node?.kind === 'entry' && node.contextOnly === true) return 'entry';
  if (node?.kind === 'lazy' && node.contextOnly === true) return 'lazy path';
  if (node?.contextOnly === true && node.edgeKind === 'wrapper') return 'wrapper path';
  return undefined;
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
  const isCondition = isPreviewInspectorConditionNode(node);
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
  const contextBadge = formatPreviewInspectorRenderContextBadge(node);
  const role = readPreviewInspectorTreeNodeRole(
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
        onClick: () => selectPreviewInspectorUiNode(node),
        onDoubleClick: toggle,
        role: 'treeitem',
        tabIndex: node.id === focusableId ? 0 : -1,
        title: isBlocking
          ? 'Rendering stops here. Select this row to apply a value or retry.'
          : isFlowOutcome
            ? 'This authored flow rendered without the current file. Select it to compare paths or inspect path evidence.'
          : isCondition
            ? 'This condition controls which React branch is visible. Select it to toggle the branch.'
            : isAssisted
              ? 'React Preview supplied a local value here. Select it to inspect or edit that value.'
              : isPathProbe
                ? 'React Preview is following the authored page path to find the current file.'
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
          onClick: (event) => {
            if (!hasChildren) return;
            event.preventDefault();
            event.stopPropagation();
            toggle();
          },
          title: hasChildren ? (expanded ? 'Collapse component' : 'Expand component') : undefined,
        },
        hasChildren ? (expanded ? '▾' : '▸') : '',
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
        ? React.createElement('span', { className: 'rpi-badge rpi-export-badge' }, 'current file export')
        : undefined,
      isActiveExport
        ? React.createElement('span', { className: 'rpi-badge' }, 'active')
        : undefined,
      node.mounted === false
        ? React.createElement('span', { className: 'rpi-badge' }, 'not mounted')
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
              title: node.mounted === false
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
