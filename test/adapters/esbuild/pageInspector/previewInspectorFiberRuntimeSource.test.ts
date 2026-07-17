/** Verifies the generated read-only Fiber adapter without importing a project React runtime. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorFiberRuntimeSource,
  PREVIEW_INSPECTOR_FIBER_VISIT_LIMIT,
  PREVIEW_INSPECTOR_TREE_NODE_LIMIT,
} from '../../../../src/adapters/esbuild/pageInspector';

/** Minimal DOM-like host used to exercise Fiber-to-host ownership without requiring jsdom. */
interface FakeHostElement {
  readonly getAttribute: (name: string) => string | null;
  readonly getBoundingClientRect: () => Record<string, never>;
  isConnected: boolean;
  readonly nodeType: 1;
  parentElement?: FakeHostElement;
}

/** Private fields represented by the fixtures; production code deliberately accepts unknown Fiber. */
interface FakeFiber {
  _debugSource?: Record<string, unknown>;
  child?: FakeFiber;
  elementType?: unknown;
  memoizedProps?: unknown;
  memoizedState?: unknown;
  return?: FakeFiber;
  sibling?: FakeFiber;
  stateNode?: unknown;
  tag: number;
  type?: unknown;
}

/** Serializable source location exposed to the VS Code navigation protocol. */
interface FiberSourceSnapshot {
  readonly approximate: boolean;
  readonly column?: number;
  readonly line?: number;
  readonly occurrenceStart?: number;
  readonly origin: string;
  readonly sourcePath: string;
}

/** UI-facing component or host record emitted by the generated adapter. */
interface FiberTreeNode {
  readonly children: FiberTreeNode[];
  readonly exportName?: string;
  readonly hostElementCount: number;
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly props: unknown;
  readonly source?: FiberSourceSnapshot;
  readonly state: unknown;
}

/** Snapshot contract consumed by Page Inspector's separately generated UI adapter. */
interface FiberTreeSnapshot {
  readonly roots: FiberTreeNode[];
  readonly selectedId?: string;
  readonly status: 'available' | 'partial' | 'static' | 'unavailable';
  readonly truncated: boolean;
  readonly visitedCount: number;
}

/** Runtime selection result retains DOM objects outside the serializable node shape. */
interface FiberTreeSelection {
  readonly hostNodes: FakeHostElement[];
  readonly node: FiberTreeNode;
}

/** Functions installed by evaluating the generated browser source in an isolated VM realm. */
interface FiberRuntimeApi {
  readonly collect: (
    boundaries: unknown,
    selectedId?: string,
    options?: Record<string, unknown>,
  ) => FiberTreeSnapshot;
  readonly collectElements: (boundary: unknown) => FakeHostElement[];
  readonly findByHost: (
    snapshot: FiberTreeSnapshot,
    host: FakeHostElement,
  ) => FiberTreeSelection | undefined;
  readonly select: (snapshot: FiberTreeSnapshot, id: string) => FiberTreeSelection | undefined;
}

/** Complete authored page slice plus its selected boundary and DOM host identities. */
interface FiberFixture {
  readonly boundary: { readonly _reactInternals: FakeFiber };
  readonly getterReadCount: () => number;
  readonly inspectorPortalHost: FakeHostElement;
  readonly sideHost: FakeHostElement;
  readonly targetHost: FakeHostElement;
  readonly targetLeafHost: FakeHostElement;
}

describe('preview Inspector Fiber runtime source', () => {
  /** Collects parents, siblings, descendants, static source fallback, props, and hook state. */
  it('creates a bounded project tree with the exact target selected', () => {
    const runtime = evaluateFiberRuntime();
    const fixture = createFiberFixture();
    const snapshot = runtime.collect([fixture.boundary], undefined, {
      descriptor: {
        inspector: {
          renderChain: {
            paths: [
              {
                steps: [
                  {
                    label: 'SidePanel',
                    occurrenceStart: 83,
                    sourcePath: '/workspace/SidePanel.tsx',
                    wrapperNames: [],
                  },
                ],
              },
            ],
          },
          root: { exportName: 'DashboardPage', sourcePath: '/workspace/DashboardPage.tsx' },
          target: { exportName: 'SelectedCard', sourcePath: '/workspace/SelectedCard.tsx' },
        },
      },
    });

    expect(snapshot.status).toBe('available');
    expect(snapshot.truncated).toBe(false);
    expect(snapshot.roots).toHaveLength(1);
    expect(snapshot.roots[0]?.name).toBe('DashboardPage');
    expect(flattenTreeNames(snapshot.roots)).toEqual([
      'DashboardPage',
      'PageLayout',
      'SelectedCard',
      'section',
      'span',
      'SidePanel',
      'aside',
      'ModalContents',
      'dialog',
    ]);
    const selected = runtime.select(snapshot, snapshot.selectedId ?? '');
    expect(selected?.node.name).toBe('SelectedCard');
    expect(selected?.node.exportName).toBe('SelectedCard');
    expect(selected?.hostNodes).toEqual([fixture.targetHost]);
    expect(selected?.node.state).toEqual([{ enabled: true }]);
    expect(selected?.node.source).toMatchObject({
      column: 4,
      line: 17,
      origin: 'jsx-debug',
      sourcePath: '/workspace/SelectedCard.tsx',
    });
    const sidePanel = findTreeNode(snapshot.roots, 'SidePanel');
    expect(sidePanel?.source).toMatchObject({
      approximate: true,
      occurrenceStart: 83,
      origin: 'render-chain',
      sourcePath: '/workspace/SidePanel.tsx',
    });
    expect(flattenTreeNames(snapshot.roots)).not.toContain('PreviewInspectorToolbar');
    expect(snapshot.roots[0]?.hostElementCount).toBe(3);
    expect(snapshot.roots[0]?.exportName).toBe('@root:/workspace/DashboardPage.tsx:DashboardPage');
  });

  /** Reads accessor descriptors as labels instead of executing project getters while snapshotting. */
  it('copies props without invoking getters and terminates cycles and long values', () => {
    const runtime = evaluateFiberRuntime();
    const fixture = createFiberFixture();
    const snapshot = runtime.collect(fixture.boundary);
    const target = findTreeNode(snapshot.roots, 'SelectedCard');
    const props = target?.props as Record<string, unknown>;

    expect(fixture.getterReadCount()).toBe(0);
    expect(props.danger).toBe('[Getter]');
    expect(props.circular).toMatchObject({ self: '[Circular]' });
    expect(String(props.longText)).toHaveLength(240);
    expect(String(props.longText).endsWith('…')).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('_reactInternals');
    expect(JSON.stringify(snapshot)).not.toContain('queue');
  });

  /** Connects a picked nested DOM host to its nearest authored component and filters disconnects. */
  it('maps DOM hosts to components while keeping selection host roots connected', () => {
    const runtime = evaluateFiberRuntime();
    const fixture = createFiberFixture();
    const snapshot = runtime.collect(fixture.boundary);

    expect(runtime.findByHost(snapshot, fixture.targetLeafHost)?.node.name).toBe('SelectedCard');
    expect(runtime.collectElements(fixture.boundary)).toEqual([fixture.targetHost]);
    fixture.targetHost.isConnected = false;
    expect(runtime.select(snapshot, snapshot.selectedId ?? '')?.hostNodes).toEqual([]);
  });

  /** Fails closed for missing private pointers and caps large display forests at 512 nodes. */
  it('advertises unavailable and partial capabilities instead of assuming a Fiber shape', () => {
    const runtime = evaluateFiberRuntime();
    expect(runtime.collect({}).status).toBe('unavailable');

    const boundaryFiber = createFiber(1, namedComponent('PreviewInspectorTargetBoundary'));
    const exportBoundary = createFiber(1, namedComponent('PreviewPageInspectorExportBoundary'));
    connectChildren(exportBoundary, createSiblingFibers(PREVIEW_INSPECTOR_TREE_NODE_LIMIT + 4));
    boundaryFiber.return = exportBoundary;
    if (exportBoundary.child === undefined) throw new Error('Wide Fiber fixture has no child.');
    boundaryFiber.child = exportBoundary.child;
    const snapshot = runtime.collect({ _reactInternalFiber: boundaryFiber });

    expect(snapshot.status).toBe('partial');
    expect(snapshot.truncated).toBe(true);
    expect(flattenTreeNames(snapshot.roots)).toHaveLength(PREVIEW_INSPECTOR_TREE_NODE_LIMIT);
    expect(snapshot.visitedCount).toBeLessThanOrEqual(PREVIEW_INSPECTOR_FIBER_VISIT_LIMIT);
  });

  /** Uses inert entry-to-target evidence when a production React build exposes no boundary Fiber. */
  it('returns a component-only static render chain when the live tree is unavailable', () => {
    const runtime = evaluateFiberRuntime();
    const snapshot = runtime.collect([], undefined, {
      descriptor: {
        automaticProps: { route: '/dashboard' },
        inspector: {
          renderChain: {
            paths: [
              {
                steps: [
                  {
                    label: 'SelectedCard',
                    occurrenceStart: 14,
                    sourcePath: '/workspace/SelectedCard.tsx',
                    wrapperNames: [],
                  },
                  {
                    label: 'RouteFrame',
                    occurrenceStart: 32,
                    sourcePath: '/workspace/routes.tsx',
                    wrapperNames: ['AppProviders'],
                  },
                ],
              },
            ],
          },
          root: { exportName: 'DashboardPage', sourcePath: '/workspace/DashboardPage.tsx' },
          target: { exportName: 'SelectedCard', sourcePath: '/workspace/SelectedCard.tsx' },
          targetAutomaticProps: { title: 'static' },
        },
      },
      selectedExportName: 'SelectedCard',
      targetExportName: 'SelectedCard',
    });

    expect(snapshot.status).toBe('static');
    expect(flattenTreeNames(snapshot.roots)).toEqual([
      'RouteFrame',
      'AppProviders',
      'SelectedCard',
      'DashboardPage',
    ]);
    const selected = runtime.select(snapshot, snapshot.selectedId ?? '');
    expect(selected?.node).toMatchObject({
      exportName: 'SelectedCard',
      kind: 'target',
      props: { title: 'static' },
    });
    expect(selected?.hostNodes).toEqual([]);
    expect(snapshot.roots[0]?.kind).toBe('entry');
    expect(snapshot.roots[0]?.exportName).toBeUndefined();
    expect(snapshot.roots[1]).toMatchObject({
      exportName: '@root:/workspace/DashboardPage.tsx:DashboardPage',
      kind: 'root',
      props: { route: '/dashboard' },
    });

    const selectedRootSnapshot = runtime.collect([], snapshot.selectedId, {
      descriptor: {
        automaticProps: { route: '/dashboard' },
        inspector: {
          renderChain: {
            paths: [
              {
                steps: [
                  {
                    label: 'SelectedCard',
                    sourcePath: '/workspace/SelectedCard.tsx',
                    wrapperNames: [],
                  },
                  {
                    label: 'RouteFrame',
                    sourcePath: '/workspace/routes.tsx',
                    wrapperNames: [],
                  },
                ],
              },
            ],
          },
          root: { exportName: 'DashboardPage', sourcePath: '/workspace/DashboardPage.tsx' },
          target: { exportName: 'SelectedCard', sourcePath: '/workspace/SelectedCard.tsx' },
          targetAutomaticProps: { title: 'target' },
        },
      },
      selectedExportName: '@root:/workspace/DashboardPage.tsx:DashboardPage',
      targetExportName: 'SelectedCard',
    });
    const selectedRoot = runtime.select(
      selectedRootSnapshot,
      selectedRootSnapshot.selectedId ?? '',
    );
    expect(selectedRoot?.node).toMatchObject({
      exportName: '@root:/workspace/DashboardPage.tsx:DashboardPage',
      kind: 'root',
      props: { route: '/dashboard' },
    });
    expect(findTreeNode(selectedRootSnapshot.roots, 'SelectedCard')).toMatchObject({
      exportName: 'SelectedCard',
      props: { title: 'target' },
    });
  });

  /** Promotes an exact render-chain root node instead of adding a duplicate branch. */
  it('attaches editable root identity to the matching static component', () => {
    const runtime = evaluateFiberRuntime();
    const rootIdentity = '@root:/workspace/DashboardPage.tsx:DashboardPage';
    const snapshot = runtime.collect([], undefined, {
      descriptor: {
        automaticProps: { section: 'root' },
        inspector: {
          renderChain: {
            paths: [
              {
                steps: [
                  {
                    label: 'SelectedCard',
                    sourcePath: '/workspace/SelectedCard.tsx',
                    wrapperNames: [],
                  },
                  {
                    label: 'DashboardPage',
                    sourcePath: '/workspace/DashboardPage.tsx',
                    wrapperNames: [],
                  },
                  {
                    label: 'ApplicationEntry',
                    sourcePath: '/workspace/main.tsx',
                    wrapperNames: [],
                  },
                ],
              },
            ],
          },
          root: { exportName: 'DashboardPage', sourcePath: '/workspace/DashboardPage.tsx' },
          target: { exportName: 'SelectedCard', sourcePath: '/workspace/SelectedCard.tsx' },
          targetAutomaticProps: { title: 'target' },
        },
      },
      selectedExportName: rootIdentity,
      targetExportName: 'SelectedCard',
    });

    expect(snapshot.roots).toHaveLength(1);
    expect(flattenTreeNames(snapshot.roots)).toEqual([
      'ApplicationEntry',
      'DashboardPage',
      'SelectedCard',
    ]);
    expect(runtime.select(snapshot, snapshot.selectedId ?? '')?.node).toMatchObject({
      exportName: rootIdentity,
      kind: 'root',
      props: { section: 'root' },
    });
    expect(findTreeNode(snapshot.roots, 'SelectedCard')).toMatchObject({
      exportName: 'SelectedCard',
      kind: 'target',
      props: { title: 'target' },
    });
  });

  /** Uses the active caller candidate rather than the descriptor's compatibility-first root. */
  it('rebuilds the static component tree from the selected page candidate', () => {
    const runtime = evaluateFiberRuntime();
    const staffRootIdentity = '@root:/workspace/StaffPage.tsx:StaffPage';
    const pageCandidate = {
      id: 'staff-path',
      renderPath: {
        entryPoint: { sourcePath: '/workspace/staff-main.tsx' },
        steps: [
          {
            label: 'SelectedCard',
            sourcePath: '/workspace/SelectedCard.tsx',
            wrapperNames: [],
          },
          {
            label: 'StaffPage',
            sourcePath: '/workspace/StaffPage.tsx',
            wrapperNames: [],
          },
          {
            label: 'StaffEntry',
            sourcePath: '/workspace/staff-main.tsx',
            wrapperNames: [],
          },
        ],
      },
      root: { exportName: 'StaffPage', sourcePath: '/workspace/StaffPage.tsx' },
      rootAutomaticProps: { audience: 'staff' },
      targetAutomaticProps: { title: 'staff card' },
    };
    const snapshot = runtime.collect([], undefined, {
      descriptor: {
        automaticProps: { audience: 'public' },
        inspector: {
          renderChain: { paths: [] },
          root: { exportName: 'PublicPage', sourcePath: '/workspace/PublicPage.tsx' },
          target: { exportName: 'SelectedCard', sourcePath: '/workspace/SelectedCard.tsx' },
        },
      },
      pageCandidate,
      rootExportName: staffRootIdentity,
      selectedExportName: 'SelectedCard',
      targetExportName: 'SelectedCard',
    });

    expect(flattenTreeNames(snapshot.roots)).toEqual(['StaffEntry', 'StaffPage', 'SelectedCard']);
    expect(findTreeNode(snapshot.roots, 'StaffPage')).toMatchObject({
      exportName: staffRootIdentity,
      props: { audience: 'staff' },
    });
    expect(findTreeNode(snapshot.roots, 'SelectedCard')).toMatchObject({
      props: { title: 'staff card' },
    });
  });

  /** Selects a sibling export's own chain instead of reusing the instrumented target boundary. */
  it('uses export-specific static evidence for a render-chain sibling', () => {
    const runtime = evaluateFiberRuntime();
    const snapshot = runtime.collect([], undefined, {
      descriptor: {
        inspector: {
          renderChainsByExport: {
            SiblingPanel: {
              paths: [
                {
                  steps: [
                    {
                      label: 'SiblingPanel',
                      occurrenceStart: 91,
                      sourcePath: '/workspace/SiblingPanel.tsx',
                      wrapperNames: [],
                    },
                    {
                      label: 'ApplicationShell',
                      occurrenceStart: 12,
                      sourcePath: '/workspace/main.tsx',
                      wrapperNames: [],
                    },
                  ],
                },
              ],
              target: { exportName: 'SiblingPanel', sourcePath: '/workspace/SiblingPanel.tsx' },
            },
          },
          root: { exportName: 'DashboardPage', sourcePath: '/workspace/DashboardPage.tsx' },
          target: { exportName: 'SelectedCard', sourcePath: '/workspace/SelectedCard.tsx' },
        },
      },
      selectedExportName: 'SiblingPanel',
      targetExportName: 'SiblingPanel',
    });

    expect(flattenTreeNames(snapshot.roots)).toEqual([
      'ApplicationShell',
      'SiblingPanel',
      'DashboardPage',
    ]);
    expect(runtime.select(snapshot, snapshot.selectedId ?? '')?.node).toMatchObject({
      exportName: 'SiblingPanel',
      source: {
        origin: 'render-chain',
        sourcePath: '/workspace/SiblingPanel.tsx',
      },
    });
  });

  /** Keeps the compatibility adapter independent of React DevTools and private-field writes. */
  it('emits explicit limits and no Fiber mutation or DevTools hook dependency', () => {
    const source = createPreviewInspectorFiberRuntimeSource();

    expect(source).toContain(
      `PREVIEW_INSPECTOR_FIBER_VISIT_LIMIT = ${PREVIEW_INSPECTOR_FIBER_VISIT_LIMIT.toString()}`,
    );
    expect(source).toContain(
      `PREVIEW_INSPECTOR_TREE_NODE_LIMIT = ${PREVIEW_INSPECTOR_TREE_NODE_LIMIT.toString()}`,
    );
    expect(source).toContain('Object.getOwnPropertyDescriptor');
    expect(source).not.toContain('__REACT_DEVTOOLS_GLOBAL_HOOK__');
    expect(source).not.toMatch(/\.(?:child|return|sibling|memoizedProps|memoizedState)\s*=/u);
  });
});

/** Evaluates generated source and publishes only its intended helper surface to the test realm. */
function evaluateFiberRuntime(): FiberRuntimeApi {
  const context: { __fiberRuntime?: FiberRuntimeApi } = {};
  const source = `${createPreviewInspectorFiberRuntimeSource()}
function normalizePreviewInspectorHostElement(value) {
  if (value !== null && typeof value === 'object' && value.nodeType === 1 &&
      typeof value.getBoundingClientRect === 'function') return value;
  const parentElement = value?.parentElement;
  return parentElement?.nodeType === 1 && typeof parentElement.getBoundingClientRect === 'function'
    ? parentElement : undefined;
}
globalThis.__fiberRuntime = {
  collect: collectPreviewInspectorFiberTree,
  collectElements: collectPreviewInspectorFiberElements,
  findByHost: findPreviewInspectorFiberTreeNodeByHost,
  select: selectPreviewInspectorFiberTreeNode,
};`;
  vm.runInNewContext(source, context);
  if (context.__fiberRuntime === undefined) throw new Error('Fiber runtime fixture did not load.');
  return context.__fiberRuntime;
}

/** Creates a representative page tree containing target siblings and both portal ownership kinds. */
function createFiberFixture(): FiberFixture {
  const targetHost = createHostElement();
  const targetLeafHost = createHostElement(targetHost);
  const sideHost = createHostElement();
  const modalHost = createHostElement();
  const inspectorPortalHost = createHostElement(undefined, true);
  let getterReads = 0;
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const targetProps: Record<string, unknown> = {
    circular,
    longText: 'x'.repeat(400),
    title: 'selected',
  };
  Object.defineProperty(targetProps, 'danger', {
    enumerable: true,
    get() {
      getterReads += 1;
      return 'should-not-run';
    },
  });

  const targetHostFiber = createFiber(5, 'section', targetHost);
  connectChildren(targetHostFiber, [createFiber(5, 'span', targetLeafHost)]);
  const targetFiber = createFiber(0, namedComponent('SelectedCard'));
  targetFiber.memoizedProps = targetProps;
  targetFiber.memoizedState = { memoizedState: { enabled: true }, next: null };
  targetFiber._debugSource = {
    columnNumber: 4,
    fileName: '/workspace/SelectedCard.tsx',
    lineNumber: 17,
  };
  connectChildren(targetFiber, [targetHostFiber]);

  const targetBoundaryFiber = createFiber(1, namedComponent('PreviewInspectorTargetBoundary'));
  connectChildren(targetBoundaryFiber, [targetFiber]);
  const sideFiber = createFiber(0, namedComponent('SidePanel'));
  connectChildren(sideFiber, [createFiber(5, 'aside', sideHost)]);
  const inspectorPortal = createFiber(4);
  inspectorPortal.stateNode = { containerInfo: inspectorPortalHost };
  connectChildren(inspectorPortal, [createFiber(0, namedComponent('PreviewInspectorToolbar'))]);
  const authoredPortal = createFiber(4);
  authoredPortal.stateNode = { containerInfo: createHostElement() };
  const modalFiber = createFiber(0, namedComponent('ModalContents'));
  connectChildren(modalFiber, [createFiber(5, 'dialog', modalHost)]);
  connectChildren(authoredPortal, [modalFiber]);

  const pageLayout = createFiber(0, namedComponent('PageLayout'));
  connectChildren(pageLayout, [targetBoundaryFiber, sideFiber, inspectorPortal, authoredPortal]);
  const dashboardPage = createFiber(0, namedComponent('DashboardPage'));
  connectChildren(dashboardPage, [pageLayout]);
  const exportBoundary = createFiber(1, namedComponent('PreviewPageInspectorExportBoundary'));
  connectChildren(exportBoundary, [dashboardPage]);

  return {
    boundary: { _reactInternals: targetBoundaryFiber },
    getterReadCount: () => getterReads,
    inspectorPortalHost,
    sideHost,
    targetHost,
    targetLeafHost,
  };
}

/** Creates one Fiber-shaped data object whose links are connected by a separate fixture helper. */
function createFiber(tag: number, type?: unknown, stateNode?: unknown): FakeFiber {
  return { memoizedProps: {}, stateNode, tag, type };
}

/** Creates an own display name without relying on minifier-sensitive inferred function names. */
function namedComponent(displayName: string): () => undefined {
  const component = (): undefined => undefined;
  Object.defineProperty(component, 'displayName', { value: displayName });
  return component;
}

/** Connects parent, child, sibling, and return links exactly as React's child list is shaped. */
function connectChildren(parent: FakeFiber, children: FakeFiber[]): void {
  if (children[0] === undefined) {
    Reflect.deleteProperty(parent, 'child');
  } else {
    parent.child = children[0];
  }
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    if (child === undefined) continue;
    child.return = parent;
    const sibling = children[index + 1];
    if (sibling === undefined) {
      Reflect.deleteProperty(child, 'sibling');
    } else {
      child.sibling = sibling;
    }
  }
}

/** Creates a wide authored component list for deterministic display-limit coverage. */
function createSiblingFibers(count: number): FakeFiber[] {
  return Array.from({ length: count }, (_, index) =>
    createFiber(0, namedComponent(`Component${index.toString()}`)),
  );
}

/** Creates one DOM-like element, optionally nested or marked as Inspector-owned chrome. */
function createHostElement(
  parentElement?: FakeHostElement,
  inspectorOwned = false,
): FakeHostElement {
  return {
    getAttribute(name) {
      return inspectorOwned && name === 'data-react-preview-inspector-ui' ? '' : null;
    },
    getBoundingClientRect: () => ({}),
    isConnected: true,
    nodeType: 1,
    ...(parentElement === undefined ? {} : { parentElement }),
  };
}

/** Flattens UI records in render order for concise assertions about promoted wrapper children. */
function flattenTreeNames(nodes: readonly FiberTreeNode[]): string[] {
  return nodes.flatMap((node) => [node.name, ...flattenTreeNames(node.children)]);
}

/** Finds one uniquely named fixture node without coupling tests to generated structural IDs. */
function findTreeNode(nodes: readonly FiberTreeNode[], name: string): FiberTreeNode | undefined {
  for (const node of nodes) {
    if (node.name === name) return node;
    const child = findTreeNode(node.children, name);
    if (child !== undefined) return child;
  }
  return undefined;
}
