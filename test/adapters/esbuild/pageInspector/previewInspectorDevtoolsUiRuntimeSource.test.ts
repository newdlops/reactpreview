/** Verifies the isolated DevTools-style Page Inspector shell without executing project React code. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorDevtoolsUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorDevtoolsUiRuntimeSource';
import { createPreviewPageInspectorRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewPageInspectorRuntimeSource';

describe('Page Inspector DevTools UI runtime source', () => {
  /** Provides the requested docked Elements layout without inserting a wrapper into the app tree. */
  it('renders a collapsible two-pane inspector through the existing portal', () => {
    const source = createPreviewInspectorDevtoolsUiRuntimeSource();

    expect(source).toContain('\'.rpi-shell[data-dock="bottom"]');
    expect(source).toContain('\'.rpi-shell[data-dock="right"]');
    expect(source).toContain("'.rpi-workbench{display:grid");
    expect(source).toContain('overflow-x:auto;overflow-y:hidden');
    expect(source).toContain("'data-collapsed': collapsed");
    expect(source).toContain("dock === 'bottom' ? 'Dock right' : 'Dock bottom'");
    expect(source).toContain(
      "React.createElement('style', undefined, previewInspectorDevtoolsCss)",
    );
    expect(source).not.toContain("React.createElement('div', undefined, children");
    expect(source).toContain('previewInspectorSession.devtoolsState');
    expect(source).toContain('() => previewInspectorDevtoolsSessionState.dock');
    expect(source).toContain('() => previewInspectorDevtoolsSessionState.activeTab');
    expect(source).toContain('() => previewInspectorDevtoolsSessionState.query');
  });

  /** Proves the composed Page Inspector entry uses this shell instead of the legacy floating form. */
  it('is integrated into the generated Page Inspector runtime', () => {
    const source = createPreviewPageInspectorRuntimeSource();

    expect(source).toContain('const previewInspectorDevtoolsCss');
    expect(source).toContain('function PreviewInspectorComponentsPane');
    expect(source).toContain('function PreviewInspectorDetailsPane');
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
    expect(source).toContain("'target'");
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
      treeNode('portal', 'portal', 'Portal', [treeNode('lazy', 'lazy', 'LazyDialog')]),
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
      'LazyDialog',
      'DashboardPage',
      'StaticWrapper',
      'ApplicationEntry',
    ]);
    expect(normalized[0]?.children.map((node) => node.name)).toEqual(['Panel']);
    expect(normalized.map((node) => node.name)).not.toEqual(
      expect.arrayContaining(['StrictMode', 'ReactRoot', 'Fragment', 'Portal', 'main', '#text']),
    );
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
    expect(source).toContain("status: typeof snapshot?.status === 'string'");
    expect(source).toContain('truncated: snapshot?.truncated === true');
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
  readonly normalize: (nodes: readonly DevtoolsUiTestNode[]) => DevtoolsUiTestNode[];
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
  normalize(nodes) {
    return normalizePreviewInspectorUiNodes(nodes, 0, { count: 0 });
  },
};`;
  vm.runInNewContext(source, context);
  if (context.__devtoolsUiRuntime === undefined) {
    throw new Error('DevTools UI runtime fixture did not load.');
  }
  return context.__devtoolsUiRuntime;
}
