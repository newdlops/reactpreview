/**
 * Generates the hierarchical route explorer shown above the authored caller-path selector.
 *
 * Large applications can expose hundreds of paths. The browser receives only inert route metadata,
 * browses it by common path folders, and asks the extension to rebuild one selected leaf. Project
 * modules remain outside this UI runtime and unselected routes never become dynamic bundle entries.
 */

/**
 * Creates route folder, search, breadcrumb, and branch-selection browser source.
 *
 * Expected lexical bindings include React, the selected descriptor helpers, session notification,
 * and `selectPreviewInspectorRouteBranch` from the page-candidate runtime.
 *
 * @returns Plain browser JavaScript concatenated into the Inspector context UI.
 */
export function createPreviewInspectorRouteExplorerUiRuntimeSource(): string {
  return String.raw`
const PREVIEW_INSPECTOR_ROUTE_SEARCH_LIMIT = 80;

/** Splits an authored absolute route without interpreting dynamic parameter tokens. */
function splitPreviewInspectorExplorerRoute(pattern) {
  return typeof pattern === 'string' ? pattern.split('/').filter(Boolean) : [];
}

/** Finds the stable folder prefix shared by every currently discovered route branch. */
function collectPreviewInspectorRouteCommonPrefix(branches) {
  const routes = branches.map((branch) => splitPreviewInspectorExplorerRoute(branch?.pattern));
  const first = routes[0] ?? [];
  const prefix = [];
  for (let index = 0; index < first.length; index += 1) {
    const segment = first[index];
    if (!routes.every((route) => route[index] === segment)) break;
    prefix.push(segment);
  }
  return prefix;
}

/** Reports whether one route lives at or below the currently opened route folder. */
function previewInspectorRouteStartsWith(route, folder) {
  return folder.every((segment, index) => route[index] === segment);
}

/** Creates one compact root-relative display path while retaining the absolute path in the title. */
function formatPreviewInspectorExplorerBranch(branch, commonPrefix) {
  const segments = splitPreviewInspectorExplorerRoute(branch?.pattern);
  const relative = segments.slice(commonPrefix.length);
  return (relative.length === 0 ? '/' : '/' + relative.join('/')) +
    ' · ' + String(branch?.componentName ?? 'route');
}

/** Returns true when a rebuilt effective route keeps every segment explicitly selected by the user. */
function previewInspectorRouteSelectionPathStartsWith(actual, expected) {
  if (!Array.isArray(actual) || !Array.isArray(expected) || expected.length > actual.length) {
    return false;
  }
  return expected.every((step, index) =>
    step?.componentName === actual[index]?.componentName && step?.pattern === actual[index]?.pattern,
  );
}

/** Renders one branch button and delegates compilation only after explicit selection. */
function PreviewInspectorRouteBranchButton({ branch, commonPrefix, selected }) {
  const pending = previewInspectorSession.pendingRouteBranchId === branch.id;
  const failed = previewInspectorSession.pendingRouteError?.branchId === branch.id;
  const selectable = branch.selectable !== false;
  const activate = selectable ? () => selectPreviewInspectorRouteBranch(branch) : undefined;
  const reasonLabels = {
    'catalog-unresolved': 'Catalog path unresolved',
    'component-unresolved': 'Component module unresolved',
    'submodule-base-unresolved': 'Nested route base unresolved',
    'factory-contract-unresolved': 'Factory route contract unresolved',
  };
  return React.createElement(
    'button',
    {
      'aria-current': selected ? 'page' : undefined,
      className: 'rpi-route-item' +
        (selected ? ' is-selected' : '') +
        (pending ? ' is-pending' : '') +
        (failed ? ' is-error' : ''),
      'data-rpi-scroll-transaction': 'route-selection:' + branch.id,
      'data-rpi-scroll-transaction-state': pending
        ? 'pending'
        : selected ? 'complete' : 'available',
      disabled: pending || !selectable,
      key: branch.id,
      onClick: activate,
      title: selectable
        ? String(branch.pathname ?? branch.pattern ?? '')
        : (reasonLabels[branch.availability] ?? 'Route unresolved'),
      type: 'button',
    },
    React.createElement(
      'span',
      { 'aria-hidden': true, className: 'rpi-route-kind' },
      branch.childState === 'expanded' ? '▾' : branch.childState === 'unknown' ? '▸' : '•',
    ),
    React.createElement(
      'span',
      { className: 'rpi-route-label' },
      selectable
        ? formatPreviewInspectorExplorerBranch(branch, commonPrefix)
        : String(branch.componentName ?? 'route'),
    ),
    pending
      ? React.createElement(
          'span',
          { 'aria-live': 'polite', className: 'rpi-route-state', 'data-state': 'pending' },
          'Preparing…',
        )
      : failed
        ? React.createElement(
            'span',
            { className: 'rpi-route-state', 'data-state': 'error', role: 'status' },
            'Retry route',
          )
      : selected
        ? React.createElement('span', { className: 'rpi-route-state', 'data-state': 'active' }, 'Active')
        : !selectable
          ? React.createElement(
              'span',
              { className: 'rpi-route-state' },
              reasonLabels[branch.availability] ?? 'Needs analysis',
            )
          : undefined,
  );
}

/** Renders a path-folder browser whose visible DOM stays small even for thousands of route records. */
function PreviewInspectorRouteExplorer({ descriptor }) {
  const branches = readPreviewInspectorRouteBranches(descriptor);
  const commonPrefix = React.useMemo(
    () => collectPreviewInspectorRouteCommonPrefix(branches),
    [branches],
  );
  const commonPrefixKey = commonPrefix.join('/');
  const selectedId = descriptor?.inspector?.selectedRouteBranchId;
  const [folder, setFolder] = React.useState(commonPrefix);
  const [query, setQuery] = React.useState('');
  React.useEffect(() => {
    setFolder((current) =>
      previewInspectorRouteStartsWith(current, commonPrefix) ? current : commonPrefix,
    );
  }, [commonPrefixKey]);
  React.useEffect(() => {
    const selectedBranch = branches.find((branch) => branch.id === selectedId);
    const pendingSelectionPath = previewInspectorSession.pendingRouteSelectionPath;
    if (
      selectedId === previewInspectorSession.pendingRouteBranchId ||
      previewInspectorRouteSelectionPathStartsWith(selectedBranch?.selectionPath, pendingSelectionPath)
    ) {
      clearPreviewInspectorPendingRouteSelection();
      notifyPreviewInspector();
    }
  }, [branches, selectedId]);
  if (branches.length === 0) {
    return React.createElement(
      'section',
      { className: 'rpi-route-explorer rpi-route-explorer-empty' },
      React.createElement('span', { className: 'rpi-context-badge' }, 'APPLICATION ROUTE'),
      React.createElement('span', { className: 'rpi-note' }, 'No application routes found'),
    );
  }
  const normalizedQuery = query.trim().toLowerCase();
  const matchingBranches =
    normalizedQuery.length === 0
      ? []
      : branches.filter((branch) =>
          [branch.componentName, branch.pathname, branch.pattern]
            .some((value) => String(value ?? '').toLowerCase().includes(normalizedQuery)),
        );
  const folderRoutes = branches
    .map((branch) => ({ branch, segments: splitPreviewInspectorExplorerRoute(branch.pattern) }))
    .filter((item) => previewInspectorRouteStartsWith(item.segments, folder));
  const immediateBranches = folderRoutes
    .filter((item) => item.segments.length <= folder.length)
    .map((item) => item.branch);
  const childFolderCounts = new Map();
  for (const item of folderRoutes) {
    const segment = item.segments[folder.length];
    if (segment === undefined) continue;
    childFolderCounts.set(segment, (childFolderCounts.get(segment) ?? 0) + 1);
  }
  const selectedBranch = branches.find((branch) => branch.id === selectedId);
  const requestedSelectionPath = previewInspectorSession.lastRequestedRouteSelectionPath;
  const selectedDefaultChild =
    descriptor?.inspector?.routeSelectionResolution === 'exact' &&
    previewInspectorRouteSelectionPathStartsWith(selectedBranch?.selectionPath, requestedSelectionPath) &&
    selectedBranch.selectionPath.length > requestedSelectionPath.length;
  const visibleSearchMatches = matchingBranches.slice(0, PREVIEW_INSPECTOR_ROUTE_SEARCH_LIMIT);
  const visibleChildFolders = [...childFolderCounts].slice(0, PREVIEW_INSPECTOR_ROUTE_SEARCH_LIMIT);
  const visibleImmediateBranches = immediateBranches.slice(0, PREVIEW_INSPECTOR_ROUTE_SEARCH_LIMIT);
  const routeError = previewInspectorSession.pendingRouteError;
  return React.createElement(
    'details',
    { 'aria-busy': previewInspectorSession.pendingRouteBranchId !== undefined, className: 'rpi-route-explorer', open: true },
    React.createElement(
      'summary',
      { className: 'rpi-route-summary' },
      React.createElement('span', { className: 'rpi-context-badge' }, 'ROUTES ' + String(branches.length)),
      React.createElement(
        'span',
        {
          className: 'rpi-route-summary-label',
          title: selectedDefaultChild
            ? 'The selected router opened its default child route.'
            : undefined,
        },
        selectedBranch === undefined
          ? 'Choose an application path'
          : selectedBranch.componentName + ' · ' + selectedBranch.pathname +
            (selectedDefaultChild ? ' · default child' : ''),
      ),
    ),
    React.createElement(
      'div',
      { className: 'rpi-route-browser', 'data-rpi-scroll-key': 'route-browser' },
      React.createElement('input', {
        'aria-label': 'Filter application routes',
        autoComplete: 'off',
        className: 'rpi-search',
        name: 'route-filter',
        onChange: (event) => setQuery(event.target.value),
        placeholder: 'Filter paths or components',
        spellCheck: false,
        type: 'search',
        value: query,
      }),
      routeError === undefined
        ? undefined
        : React.createElement(
            'div',
            { className: 'rpi-note rpi-route-error', role: 'status' },
            routeError.message,
          ),
      normalizedQuery.length > 0
        ? React.createElement(
            'div',
            { className: 'rpi-route-list' },
            visibleSearchMatches.length === 0
              ? React.createElement(
                  'div',
                  { className: 'rpi-note rpi-route-empty', role: 'status' },
                  'No application routes match this filter.',
                )
              : visibleSearchMatches.map((branch) =>
              React.createElement(PreviewInspectorRouteBranchButton, {
                branch,
                commonPrefix,
                key: branch.id,
                selected: branch.id === selectedId,
              }),
            ),
            matchingBranches.length > visibleSearchMatches.length
              ? React.createElement(
                  'div',
                  { className: 'rpi-note' },
                  'Showing ' + String(visibleSearchMatches.length) + ' of ' +
                    String(matchingBranches.length) + ' matches. Refine the filter.',
                )
              : undefined,
          )
        : React.createElement(
            React.Fragment,
            undefined,
            React.createElement(
              'div',
              { className: 'rpi-route-breadcrumbs' },
              React.createElement(
                'button',
                {
                  className: 'rpi-route-crumb',
                  onClick: () => setFolder(commonPrefix),
                  type: 'button',
                },
                '/',
              ),
              folder.slice(commonPrefix.length).map((segment, relativeIndex) =>
                React.createElement(
                  'button',
                  {
                  className: 'rpi-route-crumb',
                    key: folder.slice(0, commonPrefix.length + relativeIndex + 1).join('/'),
                    onClick: () =>
                      setFolder(folder.slice(0, commonPrefix.length + relativeIndex + 1)),
                    title: segment,
                    type: 'button',
                  },
                  segment,
                ),
              ),
            ),
            React.createElement(
              'div',
              { className: 'rpi-route-folders' },
              visibleChildFolders.map(([segment, count]) =>
                React.createElement(
                  'button',
                  {
                  className: 'rpi-route-folder',
                    key: segment,
                    onClick: () => setFolder([...folder, segment]),
                    title: segment,
                    type: 'button',
                  },
                  React.createElement('span', { 'aria-hidden': true }, '▸'),
                  React.createElement('span', undefined, segment),
                  React.createElement('span', { className: 'rpi-route-count' }, String(count)),
                ),
              ),
            ),
            childFolderCounts.size > visibleChildFolders.length
              ? React.createElement(
                  'div',
                  { className: 'rpi-note' },
                  'Showing the first ' + String(visibleChildFolders.length) +
                    ' folders. Filter routes to find another path.',
                )
              : undefined,
            React.createElement(
              'div',
              { className: 'rpi-route-list' },
              visibleImmediateBranches.map((branch) =>
                React.createElement(PreviewInspectorRouteBranchButton, {
                  branch,
                  commonPrefix,
                  key: branch.id,
                  selected: branch.id === selectedId,
                }),
              ),
            ),
            immediateBranches.length > visibleImmediateBranches.length
              ? React.createElement(
                  'div',
                  { className: 'rpi-note' },
                  'Showing the first ' + String(visibleImmediateBranches.length) +
                    ' routes. Filter routes to find another path.',
                )
              : undefined,
          ),
    ),
  );
}
`;
}
