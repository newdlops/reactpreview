/** Verifies the isolated DevTools-style Page Inspector shell without executing project React code. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorDevtoolsUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorDevtoolsUiRuntimeSource';
import { createPreviewPageInspectorRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewPageInspectorRuntimeSource';

describe('Page Inspector DevTools UI runtime source', () => {
  /** Parses the composed browser source so presentation-only template edits cannot ship bad JS. */
  it('emits syntactically valid browser runtime source', () => {
    expect(() => new vm.Script(createPreviewInspectorDevtoolsUiRuntimeSource())).not.toThrow();
  });

  /** Keeps the authoritative controls hidden in the preview and mirrored into a companion tab. */
  it('renders companion-ready inspector controls through the existing portal', () => {
    const source = createPreviewInspectorDevtoolsUiRuntimeSource();

    expect(source).toContain("new Set(['bottom', 'left', 'right', 'floating'])");
    expect(source).toContain('\'.rpi-shell[data-dock="floating"]');
    expect(source).toContain("value: 'bottom' }, 'Bottom drawer'");
    expect(source).toContain("value: 'right' }, 'Right drawer'");
    expect(source).toContain("value: 'left' }, 'Left drawer'");
    expect(source).toContain("value: 'floating' }, 'Floating'");
    expect(source).toContain("'.rpi-workbench{display:grid");
    expect(source).toContain(
      '\'.rpi-shell[data-react-preview-companion-source="true"]{display:none!important}\'',
    );
    expect(source).toContain('container-name:rpi-inspector;container-type:inline-size');
    expect(source).toContain('@container rpi-inspector (max-width:759px)');
    expect(source).toContain('@container rpi-inspector (max-width:460px)');
    expect(source).toContain('display:flex;flex-wrap:wrap;gap:6px;max-width:100%');
    expect(source).toContain("'data-collapsed': collapsed");
    expect(source).toContain('usePreviewInspectorTreeRefresh(!collapsed || wireframeVisible)');
    expect(source).toContain('style: createPreviewInspectorShellStyle(layout, collapsed)');
    expect(source).toContain('ref: setPreviewInspectorCompanionShell');
    expect(source).toContain('React.useEffect(schedulePreviewInspectorCompanionSnapshot)');
    expect(source).toContain('function PreviewInspectorResizeHandle');
    expect(source).toContain('function PreviewInspectorMoveHandle');
    expect(source).toContain('beginPreviewInspectorLayoutPointerGesture');
    expect(source).toContain('const pageContext = readPreviewInspectorPageContext()');
    expect(source).toContain('title: "Go to the current file\'s main component"');
    expect(source).toContain("'Current file'");
    expect(source).toContain("'Auto values'");
    expect(source).toContain("'Wireframe'");
    expect(source).toContain('function PreviewInspectorWireframeLayer');
    expect(source).toContain('function PreviewInspectorBlockerFlowDetail');
    expect(source).toContain('createPreviewInspectorBlockerFlow(snapshot)');
    expect(source).toContain("['flow', 'Fix blockers (' + String(flow.unresolvedCount) + ')']");
    expect(source).toContain("activeTab === 'flow'");
    expect(source).toContain("previewInspectorDevtoolsSessionState.activeTab !== 'flow'");
    expect(source).toContain("'aria-label': 'Blocker dependency flow chart'");
    expect(source).toContain("'aria-label': 'React page layout wireframe'");
    expect(source).toContain("'data-react-preview-wireframe-blocker': item.node.id");
    expect(source).toContain('revealPreviewInspectorWireframeBlocker(node, setCollapsed)');
    expect(source).toContain('consumePreviewInspectorWireframeTreeReveal(selectedId)');
    expect(source).toContain('copyPreviewInspectorSnapshotRuntimeIndexes(');
    expect(source).toContain("['payloads', 'Payloads']");
    expect(source).toContain("['console', 'Console ('");
    expect(source).toContain('function PreviewInspectorConsoleDetail');
    expect(source).toContain("'Filter console messages by level'");
    expect(source).toContain("'Filter console message text'");
    expect(source).toContain("'Stack and failure context'");
    expect(source).toContain("'No console messages captured yet.'");
    expect(source).toContain('clearPreviewInspectorConsoleEntries');
    expect(source).toContain("'Auto payloads'");
    expect(source).toContain("'Generate Lorem'");
    expect(source).toContain("'Smart fill minimum'");
    expect(source).toContain('smartFillPreviewInspectorDataPayload');
    expect(source).toContain("'Apply JSON'");
    expect(source).toContain('GENERATED · AUTO');
    expect(source).toContain('USER + SMART MINIMUM');
    expect(source).toContain('No API or GraphQL payload has been observed yet.');
    expect(source).toContain("'aria-label': 'Rendered page component context'");
    expect(source).toContain("className: 'rpi-context-badge'");
    expect(source).toContain("'aria-label': 'Authored page caller path'");
    expect(source).toContain('selectPreviewInspectorPageCandidate(event.target.value)');
    expect(source).toContain("'aria-label': 'Preview rendering perspective'");
    expect(source).toContain("'Page flow (as authored)'");
    expect(source).toContain("'File components (all exports)'");
    expect(source).toContain("'Current-file component overview'");
    expect(source).toContain("'FILE COMPONENTS'");
    expect(source).toContain("'TARGET ABSENT'");
    expect(source).toContain("'Rendered flow does not contain the current file'");
    expect(source).toContain('React Preview does not classify this application outcome.');
    expect(source).toContain("'aria-label': 'Inspector tree legend'");
    expect(source).toContain("'Fix next blocker'");
    expect(source).toContain("'Page context is ready'");
    expect(source).toContain("'aria-label': 'Resize React Page Inspector'");
    expect(source).toContain("'aria-label': 'Move floating React Page Inspector'");
    expect(source).toContain(
      "React.createElement('style', undefined, previewInspectorDevtoolsCss)",
    );
    expect(source).not.toContain("React.createElement('div', undefined, children");
    expect(source).toContain('previewInspectorSession.devtoolsState');
    expect(source).toContain('() => previewInspectorDevtoolsSessionState.activeTab');
    expect(source).toContain('() => previewInspectorDevtoolsSessionState.query');
  });

  /** Clamps restored geometry and applies edge-specific pointer deltas deterministically. */
  it('keeps drawer and floating geometry inside the current viewport', () => {
    const runtime = evaluateDevtoolsUiHelpers();
    const floating = runtime.normalizeLayout(
      {
        dock: 'floating',
        floatingHeight: 400,
        floatingWidth: 500,
        floatingX: 9_999,
        floatingY: -200,
      },
      { height: 600, width: 800 },
    );

    expect(floating).toMatchObject({
      dock: 'floating',
      floatingHeight: 400,
      floatingWidth: 500,
      floatingX: 292,
      floatingY: 8,
    });
    expect(runtime.shellStyle(floating, false)).toMatchObject({
      height: 400,
      left: 292,
      top: 8,
      width: 500,
    });
    expect(runtime.shellStyle(floating, true, { height: 640, width: 360 })).toMatchObject({
      bottom: 8,
      left: 8,
      maxWidth: 'none',
      right: 'auto',
      transform: 'none',
      width: 344,
    });

    const bottom = runtime.normalizeLayout(
      { bottomHeight: 300, dock: 'bottom' },
      { height: 800, width: 1280 },
    );
    expect(runtime.resizeLayout(bottom, 'resize', 0, -40).bottomHeight).toBe(340);
    const right = runtime.normalizeLayout(
      { dock: 'right', sideWidth: 400 },
      { height: 800, width: 1280 },
    );
    expect(runtime.resizeLayout(right, 'resize', -32, 0).sideWidth).toBe(432);
  });

  /** Proves the composed Page Inspector entry uses this shell instead of the legacy floating form. */
  it('is integrated into the generated Page Inspector runtime', () => {
    const source = createPreviewPageInspectorRuntimeSource();

    expect(source).toContain('const previewInspectorDevtoolsCss');
    expect(source).toContain('function PreviewInspectorComponentsPane');
    expect(source).toContain('function PreviewInspectorDetailsPane');
    expect(source).toContain('resolveRenderCondition: resolvePreviewInspectorRenderCondition');
    expect(source).toContain(
      'renderConditionOverrides: serializePreviewInspectorRenderConditionOverrides()',
    );
    expect(source).toContain('dataPayloadOverrides: serializePreviewInspectorDataOverrides()');
    expect(source).toContain('resolveDataPayload: resolvePreviewInspectorDataPayload');
    expect(source).toContain('installPreviewInspectorNetworkBoundary()');
    expect(source).toContain('installPreviewInspectorConsoleCapture()');
    expect(source).toContain('recordConsoleEntry: recordPreviewInspectorConsoleEntry');
    expect(source).toContain(
      'stringifyPreviewInspectorProps(previewInspectorSession.devtoolsState ?? {})',
    );
    expect(source).not.toContain('const inspectorControlStyle');
  });

  /** Keeps the left pane component-only, searchable, accessible, and keyboard navigable. */
  it('emits an ARIA React component tree with filtering and directional keys', () => {
    const source = createPreviewInspectorDevtoolsUiRuntimeSource();

    expect(source).toContain('const previewInspectorComponentKinds = new Set([');
    expect(source).toContain('return previewInspectorComponentKinds.has(kind)');
    expect(source).toContain("if (kind === 'root')");
    expect(source).toContain("'aria-label': 'Filter React components'");
    expect(source).toContain("role: 'tree'");
    expect(source).toContain("role: 'treeitem'");
    expect(source).toContain("{ role: 'none' }");
    expect(source).toContain('tabIndex: node.id === focusableId ? 0 : -1');
    expect(source).toContain('row.parentElement?.closest?.(\'[role="group"]\')');
    expect(source).toContain("event.key === 'ArrowDown' || event.key === 'ArrowUp'");
    expect(source).toContain("event.key === 'ArrowRight'");
    expect(source).toContain("event.key === 'ArrowLeft'");
    expect(source).toContain("event.key === 'Enter' || event.key === ' '");
    expect(source).toContain('onDoubleClick: toggle');
    expect(source).toContain('event.stopPropagation();');
    expect(source).toContain("'selected'");
    expect(source).toContain("'current file export'");
    expect(source).toContain("'Reveal'");
    expect(source).toContain("label: 'COMPONENT'");
    expect(source).toContain("label: 'BLOCKER'");
    expect(source).toContain("'BLOCKS PAGE · CLICK TO FIX'");
    expect(source).toContain("'AUTHORED FLOW · TARGET ABSENT'");
    expect(source).toContain("label: 'FLOW OUTCOME'");
    expect(source).toContain('rpi-flow-outcome-row');
    expect(source).toContain('isPreviewInspectorBlockingNode(node)');
    expect(source).toContain('revealPreviewInspectorCurrentFileExport(node)');
    expect(source).toContain('attachPreviewInspectorConditionsToSnapshot');
    expect(source).toContain('attachPreviewInspectorBlockersToSnapshot');
    expect(source).toContain('enrichPreviewInspectorRenderTreeSnapshot');
    expect(source).toContain("'Apply pass value'");
    expect(source).toContain("'Auto pass'");
    expect(source).toContain("node?.kind === 'condition'");
    expect(source).toContain('isPreviewInspectorOverlayNode(node)');
    expect(source).toContain("' rpi-overlay-row'");
    expect(source).toContain("'transparent-wrapper'");
    expect(source).toContain("'overlay' + (node.overlayState");
    expect(source).toContain("'Use authored value'");
  });

  /** Promotes internal Fiber/host records while retaining every supported authored component kind. */
  it('normalizes collector output through an explicit component-kind allowlist', () => {
    const runtime = evaluateDevtoolsUiHelpers();
    const normalized = runtime.normalize([
      treeNode('strict', 'other', 'StrictMode', [
        treeNode('app', 'function', 'App', [
          treeNode('main', 'host', 'main', [treeNode('panel', 'class', 'Panel')]),
        ]),
      ]),
      treeNode('react-root', 'root', 'ReactRoot', [treeNode('target', 'target', 'Target')]),
      treeNode('fragment', 'fragment', 'Fragment', [treeNode('memo', 'memo', 'MemoCard')]),
      {
        ...treeNode('portal', 'portal', 'OverlayPortal', [treeNode('lazy', 'lazy', 'LazyDialog')]),
        role: 'overlay',
      },
      treeNode('text', 'text', '#text'),
      {
        ...treeNode('authored-root', 'root', 'DashboardPage'),
        exportName: '@root:/workspace/DashboardPage.tsx:DashboardPage',
      },
      treeNode('static-component', 'component', 'StaticWrapper'),
      treeNode('static-entry', 'entry', 'ApplicationEntry'),
    ]);

    expect(normalized.map((node) => node.name)).toEqual([
      'App',
      'Target',
      'MemoCard',
      'OverlayPortal',
      'DashboardPage',
      'StaticWrapper',
      'ApplicationEntry',
    ]);
    expect(normalized[0]?.children.map((node) => node.name)).toEqual(['Panel']);
    expect(normalized.map((node) => node.name)).not.toEqual(
      expect.arrayContaining(['StrictMode', 'ReactRoot', 'Fragment', 'main', '#text']),
    );
    expect(normalized.find((node) => node.name === 'OverlayPortal')).toMatchObject({
      role: 'overlay',
    });
  });

  /** Keeps one visible row tabbable and resolves ArrowLeft through the role=group owner container. */
  it('retains a keyboard entry row when selection is filtered or collapsed', () => {
    const runtime = evaluateDevtoolsUiHelpers();
    const sibling = treeNode('sibling', 'function', 'Sibling');
    const roots = [
      treeNode('root', 'function', 'Root', [
        treeNode('child', 'function', 'Child', [treeNode('leaf', 'function', 'Leaf')]),
      ]),
      sibling,
    ];

    expect(runtime.focusableId(roots, 'leaf', ['root'])).toBe('root');
    expect(runtime.focusableId(roots, 'child', ['root'])).toBe('child');
    expect(runtime.focusableId([sibling], 'leaf', [])).toBe('sibling');
    expect(runtime.expandedForSelection(roots, 'leaf', [])).toEqual(['root', 'child']);
    expect(runtime.expandedForSelection(roots, 'leaf', ['root'])).toEqual(['root', 'child']);

    let prevented = false;
    let parentFocused = false;
    const parentRow = {
      focus: () => {
        parentFocused = true;
      },
    };
    const parentGroup = {
      parentElement: {
        querySelector: () => parentRow,
      },
    };
    const row = {
      closest: () => row,
      getAttribute: () => 'false',
      parentElement: {
        closest: () => parentGroup,
      },
    };
    runtime.handleTreeKeyDown({
      currentTarget: { querySelectorAll: () => [row] },
      key: 'ArrowLeft',
      preventDefault: () => {
        prevented = true;
      },
      target: row,
    });

    expect(prevented).toBe(true);
    expect(parentFocused).toBe(true);
  });

  /** Separates editable instrumented props from observational Fiber props, state, and source. */
  it('renders guarded Props, read-only State, and adapter-owned Source details', () => {
    const source = createPreviewInspectorDevtoolsUiRuntimeSource();

    expect(source).toContain("['props', 'Props']");
    expect(source).toContain("['state', 'State']");
    expect(source).toContain("['source', 'Source']");
    expect(source).toContain('isPreviewInspectorUiNodeEditable');
    expect(source).toContain('Editable instrumented target/root props');
    expect(source).toContain('Read-only Fiber props snapshot');
    expect(source).toContain('Read-only component state / hooks snapshot');
    expect(source).toContain(
      'previewInspectorSourceNavigation.openSource(source, event.nativeEvent, event.currentTarget)',
    );
    expect(source).toContain("'data-react-preview-source-open': sourceOpen === true ? 'true'");
    expect(source).toContain("'data-rpi-source-path': sourceOpen === true ? companionSourcePath");
    expect(source).toContain('companionSource: source');
    expect(source).toContain('sourceOpen: true');
    expect(source).not.toContain('previewInspectorApi.openSource(source)');
    expect(source).not.toContain('postMessage(');
    expect(source).not.toContain('acquireVsCodeApi');
  });

  /** Remains useful before a live collector or editor bridge has registered its optional methods. */
  it('falls back to static exports and bounds untrusted collector snapshots', () => {
    const source = createPreviewInspectorDevtoolsUiRuntimeSource();

    expect(source).toContain('createFallbackPreviewInspectorTreeSnapshot');
    expect(source).toContain("typeof collectTree !== 'function'");
    expect(source).toContain('counter.count >= 4096');
    expect(source).toContain('depth > 64');
    expect(source).toContain('normalized.occurrenceStart = source.occurrenceStart');
    expect(source).toContain("typeof source.path === 'string' ? source.path : source.sourcePath");
    expect(source).toContain("typeof collectorSnapshot?.status === 'string'");
    expect(source).toContain('truncated: collectorSnapshot?.truncated === true');
    expect(source).toContain("truncated ? 'bounded tree' : status ?? 'live tree'");
    expect(source).toContain("typeof previewInspectorApi.subscribeTree === 'function'");
    expect(source).toContain('setInterval(refresh, 750)');
    expect(source).not.toContain('_reactInternals');
    expect(source).not.toContain('_reactInternalFiber');
  });
});

/** Serializable collector fixture used by generated UI helper behavior tests. */
interface DevtoolsUiTestNode {
  readonly children: readonly DevtoolsUiTestNode[];
  readonly exportName?: string;
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly overlayState?: string;
  readonly role?: string;
}

/** Small generated helper surface exposed only inside the isolated VM test realm. */
interface DevtoolsUiTestRuntime {
  readonly expandedForSelection: (
    nodes: readonly DevtoolsUiTestNode[],
    selectedId: string | undefined,
    expandedIds: readonly string[],
  ) => string[];
  readonly focusableId: (
    nodes: readonly DevtoolsUiTestNode[],
    selectedId: string | undefined,
    expandedIds: readonly string[],
  ) => string | undefined;
  readonly handleTreeKeyDown: (event: unknown) => void;
  readonly normalizeLayout: (
    value: Partial<PreviewInspectorTestLayout>,
    viewport: { readonly height: number; readonly width: number },
  ) => PreviewInspectorTestLayout;
  readonly normalize: (nodes: readonly DevtoolsUiTestNode[]) => DevtoolsUiTestNode[];
  readonly resizeLayout: (
    layout: PreviewInspectorTestLayout,
    action: 'move' | 'resize',
    deltaX: number,
    deltaY: number,
  ) => PreviewInspectorTestLayout;
  readonly shellStyle: (
    layout: PreviewInspectorTestLayout,
    collapsed: boolean,
    viewport?: { readonly height: number; readonly width: number },
  ) => Record<string, unknown>;
}

/** Serializable generated layout shape used only by the isolated runtime test realm. */
interface PreviewInspectorTestLayout {
  readonly bottomHeight: number;
  readonly dock: 'bottom' | 'floating' | 'left' | 'right';
  readonly floatingHeight: number;
  readonly floatingWidth: number;
  readonly floatingX: number;
  readonly floatingY: number;
  readonly sideWidth: number;
}

/** Creates one immutable component/internal-node fixture with optional nested collector children. */
function treeNode(
  id: string,
  kind: string,
  name: string,
  children: readonly DevtoolsUiTestNode[] = [],
): DevtoolsUiTestNode {
  return { children, id, kind, name };
}

/** Evaluates the emitted plain JavaScript and publishes only pure normalization/keyboard helpers. */
function evaluateDevtoolsUiHelpers(): DevtoolsUiTestRuntime {
  const context: {
    __devtoolsUiRuntime?: DevtoolsUiTestRuntime;
    previewInspectorSession: Record<string, unknown>;
  } = { previewInspectorSession: {} };
  const source = `${createPreviewInspectorDevtoolsUiRuntimeSource()}
globalThis.__devtoolsUiRuntime = {
  expandedForSelection(nodes, selectedId, expandedIds) {
    return [...expandPreviewInspectorUiSelection(nodes, selectedId, new Set(expandedIds))];
  },
  focusableId(nodes, selectedId, expandedIds) {
    return resolvePreviewInspectorTreeFocusableId(nodes, selectedId, new Set(expandedIds));
  },
  handleTreeKeyDown: handlePreviewInspectorTreeKeyDown,
  normalizeLayout: normalizePreviewInspectorLayout,
  normalize(nodes) {
    return normalizePreviewInspectorUiNodes(nodes, 0, { count: 0 });
  },
  resizeLayout: resizePreviewInspectorLayout,
  shellStyle: createPreviewInspectorShellStyle,
};`;
  vm.runInNewContext(source, context);
  if (context.__devtoolsUiRuntime === undefined) {
    throw new Error('DevTools UI runtime fixture did not load.');
  }
  return context.__devtoolsUiRuntime;
}
