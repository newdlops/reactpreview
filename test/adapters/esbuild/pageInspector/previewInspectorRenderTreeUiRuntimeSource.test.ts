/** Verifies inert workspace-root/render-path enrichment without evaluating an application entry. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorRenderTreeUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRenderTreeUiRuntimeSource';

/** Minimal serializable tree node used by the generated UI-side enrichment fixture. */
interface RenderTreeNode {
  readonly children: readonly RenderTreeNode[];
  readonly contextOnly?: boolean;
  readonly currentFileExport?: boolean;
  readonly edgeKind?: string;
  readonly expectedOutcomeActive?: boolean;
  readonly expectedOutput?: boolean;
  readonly exportName?: string;
  readonly id: string;
  readonly liveHostOutputMissing?: boolean;
  readonly mounted?: boolean;
  readonly name: string;
}

/** Snapshot subset returned by the generated enrichment function. */
interface RenderTreeSnapshot {
  readonly roots: readonly RenderTreeNode[];
}

/** Pure data helpers exposed from the generated enrichment source. */
interface RenderTreeRuntime {
  readonly enrich: (snapshot: Record<string, unknown>) => RenderTreeSnapshot;
  readonly readContext: (options?: { readonly preferShortest?: boolean }) => {
    readonly entries: readonly { readonly name: string }[];
  };
}

/** Runtime-only target visibility retained by the fixture's local Inspector session. */
interface RenderTreeRuntimeOptions {
  readonly selectedOutcomeId?: string;
  readonly targetHasAnyHostOutput?: boolean;
  readonly targetHasOutput?: boolean;
  readonly targetMounted?: boolean;
}

/** Proves entry/route context and missing exports remain visible around the mounted page Fiber. */
describe('Preview Inspector render-tree UI runtime source', () => {
  it('prepends the workspace render root and inventories unmounted current-file exports', () => {
    const descriptor = {
      inspector: {
        pageCandidates: [],
        renderChainsByExport: {
          CurrentCard: {
            paths: [],
            target: { exportName: 'CurrentCard', sourcePath: '/workspace/CurrentCard.tsx' },
          },
          SiblingDialog: {
            paths: [],
            target: { exportName: 'SiblingDialog', sourcePath: '/workspace/CurrentCard.tsx' },
          },
        },
        target: { exportName: 'CurrentCard', sourcePath: '/workspace/CurrentCard.tsx' },
      },
    };
    const candidate = {
      renderPath: {
        entryPoint: { sourcePath: '/workspace/main.tsx' },
        steps: [
          {
            certainty: 'confirmed',
            kind: 'component-render',
            label: 'CurrentCard',
            sourcePath: '/workspace/CurrentCard.tsx',
            wrapperNames: [],
          },
          {
            certainty: 'conditional',
            kind: 'route-branch',
            label: 'DashboardPage',
            sourcePath: '/workspace/DashboardPage.tsx',
            wrapperNames: ['AuthGuard'],
          },
          {
            certainty: 'confirmed',
            kind: 'entry-render',
            label: 'ApplicationEntry',
            sourcePath: '/workspace/main.tsx',
            wrapperNames: [],
          },
        ],
      },
      root: { exportName: 'DashboardPage', sourcePath: '/workspace/DashboardPage.tsx' },
    };
    const runtime = evaluateRenderTreeRuntime(descriptor, candidate);
    const snapshot = runtime.enrich({
      roots: [
        {
          children: [
            {
              children: [],
              exportName: 'CurrentCard',
              id: 'card',
              kind: 'function',
              name: 'CurrentCard',
              source: { path: '/workspace/CurrentCard.tsx' },
            },
          ],
          id: 'page',
          kind: 'function',
          name: 'DashboardPage',
          source: { path: '/workspace/DashboardPage.tsx' },
        },
      ],
      status: 'available',
    });

    expect(snapshot.roots[0]?.name).toBe('Workspace React render root');
    expect(flattenNames(snapshot.roots)).toEqual([
      'Workspace React render root',
      'ApplicationEntry',
      'DashboardPage',
      'CurrentCard',
      'Unmounted current-file exports',
      'SiblingDialog',
    ]);
    expect(findNode(snapshot.roots, 'CurrentCard')).toMatchObject({
      currentFileExport: true,
      mounted: true,
    });
    expect(findNode(snapshot.roots, 'SiblingDialog')).toMatchObject({
      currentFileExport: true,
      mounted: false,
    });
  });

  /** Expands HOC factories and component-valued props into visible inert render-path boundaries. */
  it('shows HOC and component-slot transport between the page root and current file', () => {
    const descriptor = {
      inspector: {
        pageCandidates: [],
        renderChainsByExport: {
          CurrentCard: {
            paths: [],
            target: { exportName: 'CurrentCard', sourcePath: '/workspace/CurrentCard.tsx' },
          },
        },
        target: { exportName: 'CurrentCard', sourcePath: '/workspace/CurrentCard.tsx' },
      },
    };
    const candidate = {
      renderPath: {
        entryPoint: { sourcePath: '/workspace/main.tsx' },
        steps: [
          {
            certainty: 'confirmed',
            invocation: {
              calleeName: 'Slot',
              factoryNames: ['memo'],
              mode: 'component-prop',
              slotName: 'component',
              sourcePath: '/workspace/SlotPage.tsx',
            },
            kind: 'value-flow',
            label: 'CurrentCard',
            sourcePath: '/workspace/CurrentCard.tsx',
            wrapperNames: [],
          },
          {
            certainty: 'confirmed',
            invocation: {
              calleeName: 'memo',
              factoryNames: ['forwardRef', 'memo'],
              mode: 'forward-ref',
              sourcePath: '/workspace/DecoratedPage.tsx',
            },
            kind: 'value-flow',
            label: 'SlotPage',
            sourcePath: '/workspace/SlotPage.tsx',
            wrapperNames: [],
          },
          {
            certainty: 'confirmed',
            kind: 'component-render',
            label: 'DecoratedPage',
            sourcePath: '/workspace/DecoratedPage.tsx',
            wrapperNames: [],
          },
          {
            certainty: 'confirmed',
            kind: 'entry-render',
            label: 'ApplicationEntry',
            sourcePath: '/workspace/main.tsx',
            wrapperNames: [],
          },
        ],
      },
      root: { exportName: 'DecoratedPage', sourcePath: '/workspace/DecoratedPage.tsx' },
    };
    const runtime = evaluateRenderTreeRuntime(descriptor, candidate);
    const snapshot = runtime.enrich({
      roots: [
        {
          children: [
            {
              children: [
                {
                  children: [],
                  exportName: 'CurrentCard',
                  id: 'card',
                  kind: 'function',
                  name: 'CurrentCard',
                  source: { path: '/workspace/CurrentCard.tsx' },
                },
              ],
              id: 'slot-page',
              kind: 'function',
              name: 'SlotPage',
              source: { path: '/workspace/SlotPage.tsx' },
            },
          ],
          id: 'decorated-page',
          kind: 'function',
          name: 'DecoratedPage',
          source: { path: '/workspace/DecoratedPage.tsx' },
        },
      ],
      status: 'available',
    });

    expect(flattenNames(snapshot.roots)).toEqual([
      'Workspace React render root',
      'ApplicationEntry',
      'DecoratedPage',
      'memo(…)',
      'forwardRef(…)',
      'SlotPage',
      'Slot.component',
      'memo(…)',
      'CurrentCard',
    ]);
    expect(findNode(snapshot.roots, 'memo(…)')).toMatchObject({ edgeKind: 'hoc-wrapper' });
    expect(findNode(snapshot.roots, 'Slot.component')).toMatchObject({
      edgeKind: 'component-slot',
    });
  });

  /** Keeps Main's application corridor independent from a longer selected page candidate. */
  it('reads the compiler-ranked shortest path when the caller requests it', () => {
    const shortestPath = {
      steps: [
        {
          kind: 'component-render',
          label: 'CurrentCard',
          sourcePath: '/workspace/CurrentCard.tsx',
        },
        { kind: 'entry-render', label: 'ShortEntry', sourcePath: '/workspace/main.tsx' },
      ],
    };
    const descriptor = {
      inspector: {
        renderChainsByExport: {
          CurrentCard: {
            paths: [shortestPath],
            target: { exportName: 'CurrentCard', sourcePath: '/workspace/CurrentCard.tsx' },
          },
        },
        target: { exportName: 'CurrentCard', sourcePath: '/workspace/CurrentCard.tsx' },
      },
    };
    const candidate = {
      renderPath: {
        steps: [
          {
            kind: 'component-render',
            label: 'CurrentCard',
            sourcePath: '/workspace/CurrentCard.tsx',
          },
          { kind: 'component-render', label: 'LongPage', sourcePath: '/workspace/LongPage.tsx' },
          { kind: 'entry-render', label: 'LongEntry', sourcePath: '/workspace/long-main.tsx' },
        ],
      },
    };
    const runtime = evaluateRenderTreeRuntime(descriptor, candidate);

    expect(runtime.readContext().entries.map((entry) => entry.name)).toEqual([
      'LongEntry',
      'LongPage',
      'CurrentCard',
    ]);
    expect(
      runtime.readContext({ preferShortest: true }).entries.map((entry) => entry.name),
    ).toEqual(['ShortEntry', 'CurrentCard']);
  });

  /**
   * Keeps the selected file's authored JSX visible when a mounted render-prop wrapper returns null.
   * Static rows are explicitly inert so they cannot be mistaken for the collector's live Fiber.
   */
  it('attaches expected JSX below a mounted current-file export with no live host output', () => {
    const descriptor = {
      inspector: {
        renderChainsByExport: {
          CurrentCard: {
            paths: [],
            target: { exportName: 'CurrentCard', sourcePath: '/workspace/CurrentCard.tsx' },
          },
        },
        renderOutcomesByExport: {
          CurrentCard: {
            exportName: 'CurrentCard',
            outcomes: [
              {
                column: 3,
                componentNames: ['QueryRenderer', 'Page', 'PageHeader'],
                componentTree: [
                  {
                    children: [
                      {
                        children: [
                          {
                            children: [],
                            column: 9,
                            line: 24,
                            name: 'PageHeader',
                            sourcePath: '/workspace/CurrentCard.tsx',
                          },
                        ],
                        column: 7,
                        line: 23,
                        name: 'Page',
                        sourcePath: '/workspace/CurrentCard.tsx',
                      },
                    ],
                    column: 5,
                    line: 20,
                    name: 'QueryRenderer',
                    sourcePath: '/workspace/CurrentCard.tsx',
                  },
                ],
                conditions: [],
                exportName: 'CurrentCard',
                id: 'current-card-main-outcome',
                kind: 'jsx',
                label: 'QueryRenderer → Page',
                line: 20,
                sourcePath: '/workspace/CurrentCard.tsx',
              },
            ],
            sourcePath: '/workspace/CurrentCard.tsx',
            truncated: false,
          },
        },
        target: { exportName: 'CurrentCard', sourcePath: '/workspace/CurrentCard.tsx' },
      },
    };
    const runtime = evaluateRenderTreeRuntime(
      descriptor,
      { root: { exportName: 'CurrentCard', sourcePath: '/workspace/CurrentCard.tsx' } },
      { targetHasOutput: false, targetMounted: true },
    );
    const snapshot = runtime.enrich({
      roots: [
        {
          children: [
            {
              children: [],
              id: 'live-query-renderer',
              kind: 'function',
              name: 'QueryRenderer',
              source: { path: '/workspace/QueryRenderer.tsx' },
            },
          ],
          exportName: 'CurrentCard',
          id: 'current-card',
          kind: 'function',
          name: 'CurrentCard',
          source: { path: '/workspace/CurrentCard.tsx' },
        },
      ],
    });

    expect(flattenNames(snapshot.roots)).toContain('Expected JSX · no live host output');
    expect(flattenNames(snapshot.roots)).toContain('Expected return · QueryRenderer → Page');
    expect(flattenNames(snapshot.roots)).toContain('PageHeader');
    const liveQueryRenderer = findNodeById(snapshot.roots, 'live-query-renderer');
    expect(liveQueryRenderer).toBeDefined();
    expect(liveQueryRenderer).not.toHaveProperty('contextOnly');
    expect(liveQueryRenderer).not.toHaveProperty('expectedOutput');
    expect(liveQueryRenderer).not.toHaveProperty('mounted');
    expect(
      findNodeById(snapshot.roots, 'expected-jsx:current-card-main-outcome:0.0'),
    ).toMatchObject({
      contextOnly: true,
      edgeKind: 'expected-jsx-component',
      expectedOutput: true,
      mounted: false,
      name: 'Page',
    });
    expect(findNodeById(snapshot.roots, 'expected-outcomes:CurrentCard')).toMatchObject({
      liveHostOutputMissing: true,
      mounted: false,
    });
    expect(
      findNodeById(snapshot.roots, 'current-card')?.children.map((child) => child.id),
    ).toContain('expected-outcomes:CurrentCard');

    const fallbackRuntime = evaluateRenderTreeRuntime(
      descriptor,
      { root: { exportName: 'CurrentCard', sourcePath: '/workspace/CurrentCard.tsx' } },
      { targetHasAnyHostOutput: true, targetHasOutput: false, targetMounted: true },
    );
    const fallbackSnapshot = fallbackRuntime.enrich({
      roots: [
        {
          children: [],
          exportName: 'CurrentCard',
          id: 'current-card-fallback',
          kind: 'function',
          name: 'CurrentCard',
          source: { path: '/workspace/CurrentCard.tsx' },
        },
      ],
    });
    expect(flattenNames(fallbackSnapshot.roots)).toContain(
      'Expected JSX · wrapper/fallback host only',
    );
    expect(findNodeById(fallbackSnapshot.roots, 'expected-outcomes:CurrentCard')).toMatchObject({
      authoredOutputMissing: true,
      liveHostOutputMissing: false,
    });
    expect(
      findNodeById(fallbackSnapshot.roots, 'expected-outcome:current-card-main-outcome'),
    ).toMatchObject({
      authoredOutputMissing: true,
      liveHostOutputMissing: false,
      props: { authoredOutput: false, liveHostOutput: true },
    });
  });

  /**
   * Shows non-logical return alternatives without cloning logical-AND branches already represented
   * by the component tree's Boolean switches or duplicating the selected live outcome.
   */
  it('keeps only non-logical authored alternatives when the selected return has live output', () => {
    const createOutcome = (
      id: string,
      label: string,
      componentName: string | undefined,
      conditions: readonly Record<string, unknown>[],
    ): Record<string, unknown> => ({
      column: 3,
      componentNames: componentName === undefined ? [] : [componentName],
      componentTree:
        componentName === undefined
          ? []
          : [{ children: [], column: 5, line: 10, name: componentName }],
      conditions,
      exportName: 'CurrentCard',
      id,
      kind: componentName === undefined ? 'empty' : 'jsx',
      label,
      line: 10,
      sourcePath: '/workspace/CurrentCard.tsx',
    });
    const ternary = (id: string, branch: string): Record<string, unknown> => ({
      branch,
      expression: 'ready',
      id,
      kind: 'ternary',
      label: branch,
      selectable: true,
      sourcePath: '/workspace/CurrentCard.tsx',
    });
    const logical = (id: string, branch: string): Record<string, unknown> => ({
      branch,
      expression: 'showHelp',
      id,
      kind: 'logical-and',
      label: branch,
      logicalAndGroupId: 'show-help-group',
      selectable: true,
      sourcePath: '/workspace/CurrentCard.tsx',
    });
    const descriptor = {
      inspector: {
        renderChainsByExport: {
          CurrentCard: {
            paths: [],
            target: { exportName: 'CurrentCard', sourcePath: '/workspace/CurrentCard.tsx' },
          },
        },
        renderOutcomesByExport: {
          CurrentCard: {
            exportName: 'CurrentCard',
            outcomes: [
              createOutcome('ready-outcome', 'ReadyPanel', 'ReadyPanel', [
                ternary('ready', 'truthy'),
              ]),
              createOutcome('help-visible', 'InlineHelp', 'InlineHelp', [
                logical('help-on', 'truthy'),
              ]),
              createOutcome('help-hidden', 'empty', undefined, [logical('help-off', 'falsy')]),
              createOutcome('loading-outcome', 'LoadingPanel', 'LoadingPanel', [
                ternary('loading', 'falsy'),
              ]),
            ],
            sourcePath: '/workspace/CurrentCard.tsx',
            truncated: false,
          },
        },
        target: { exportName: 'CurrentCard', sourcePath: '/workspace/CurrentCard.tsx' },
      },
    };
    const runtime = evaluateRenderTreeRuntime(
      descriptor,
      { root: { exportName: 'CurrentCard', sourcePath: '/workspace/CurrentCard.tsx' } },
      { selectedOutcomeId: 'ready-outcome', targetHasOutput: true, targetMounted: true },
    );
    const snapshot = runtime.enrich({
      roots: [
        {
          children: [{ children: [], id: 'ready-live', kind: 'function', name: 'ReadyPanel' }],
          exportName: 'CurrentCard',
          id: 'current-card',
          kind: 'function',
          name: 'CurrentCard',
          source: { path: '/workspace/CurrentCard.tsx' },
        },
      ],
    });
    const names = flattenNames(snapshot.roots);

    expect(names).toContain('Authored JSX alternatives');
    expect(names).toContain('Alternative return · LoadingPanel');
    expect(names).toContain('LoadingPanel');
    expect(names).not.toContain('Alternative return · ReadyPanel');
    expect(names).not.toContain('InlineHelp');
    expect(names).not.toContain('Return option · empty');
  });
});

/** Evaluates only data-oriented helpers against a deterministic descriptor and selected candidate. */
function evaluateRenderTreeRuntime(
  descriptor: Record<string, unknown>,
  candidate: Record<string, unknown>,
  options: RenderTreeRuntimeOptions = {},
): RenderTreeRuntime {
  const context: {
    __runtime?: RenderTreeRuntime;
    candidate: Record<string, unknown>;
    descriptor: Record<string, unknown>;
    options: RenderTreeRuntimeOptions;
  } = { candidate, descriptor, options };
  vm.runInNewContext(
    `
      const previewInspectorSession = {
        basePropsByExport: new Map(),
        devtoolsState: options.selectedOutcomeId === undefined
          ? {}
          : { renderOutcomeSelectionByExport: { CurrentCard: options.selectedOutcomeId } },
        selectedExportName: 'CurrentCard',
        targetReachabilityByKey: new Map([
          ['fixture:CurrentCard', {
            key: 'fixture:CurrentCard',
            targetExportName: 'CurrentCard',
            targetHasAnyHostOutput: options.targetHasAnyHostOutput === true,
            targetHasOutput: options.targetHasOutput === true,
            targetMounted: options.targetMounted === true,
          }],
        ]),
      };
      const findSelectedPreviewInspectorDescriptor = () => descriptor;
      const readSelectedPreviewInspectorPageCandidate = () => candidate;
      const normalizePreviewInspectorUiSource = (source) =>
        typeof source?.path === 'string' ? source : undefined;
      const normalizePreviewInspectorConditionSourcePath = (value) =>
        typeof value === 'string' ? value.replaceAll('\\\\', '/') : '';
      const matchesPreviewInspectorConditionSourcePath = (left, right) =>
        left === right || left.endsWith('/' + right) || right.endsWith('/' + left);
      ${createPreviewInspectorRenderTreeUiRuntimeSource()}
      globalThis.__runtime = {
        enrich: enrichPreviewInspectorRenderTreeSnapshot,
        readContext: (options) => readPreviewInspectorRenderContextEntries(descriptor, options),
      };
    `,
    context,
  );
  const runtime = context.__runtime;
  if (runtime === undefined) throw new Error('Render-tree UI fixture did not initialize.');
  return runtime;
}

/** Flattens node labels in visual preorder for concise path assertions. */
function flattenNames(nodes: readonly RenderTreeNode[]): string[] {
  return nodes.flatMap((node) => [node.name, ...flattenNames(node.children)]);
}

/** Finds one named node in a bounded serializable tree. */
function findNode(nodes: readonly RenderTreeNode[], name: string): RenderTreeNode | undefined {
  for (const node of nodes) {
    if (node.name === name) return node;
    const child = findNode(node.children, name);
    if (child !== undefined) return child;
  }
  return undefined;
}

/** Finds one stable static/live node identity without conflating equal component names. */
function findNodeById(nodes: readonly RenderTreeNode[], id: string): RenderTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = findNodeById(node.children, id);
    if (child !== undefined) return child;
  }
  return undefined;
}
