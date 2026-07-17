/** Verifies inert workspace-root/render-path enrichment without evaluating an application entry. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorRenderTreeUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRenderTreeUiRuntimeSource';

/** Minimal serializable tree node used by the generated UI-side enrichment fixture. */
interface RenderTreeNode {
  readonly children: readonly RenderTreeNode[];
  readonly currentFileExport?: boolean;
  readonly exportName?: string;
  readonly id: string;
  readonly mounted?: boolean;
  readonly name: string;
}

/** Snapshot subset returned by the generated enrichment function. */
interface RenderTreeSnapshot {
  readonly roots: readonly RenderTreeNode[];
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
    const snapshot = runtime({
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
});

/** Evaluates only data-oriented helpers against a deterministic descriptor and selected candidate. */
function evaluateRenderTreeRuntime(
  descriptor: Record<string, unknown>,
  candidate: Record<string, unknown>,
): (snapshot: Record<string, unknown>) => RenderTreeSnapshot {
  const context: {
    __enrich?: (snapshot: Record<string, unknown>) => RenderTreeSnapshot;
    candidate: Record<string, unknown>;
    descriptor: Record<string, unknown>;
  } = { candidate, descriptor };
  vm.runInNewContext(
    `
      const previewInspectorSession = {
        basePropsByExport: new Map(),
        selectedExportName: 'CurrentCard',
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
      globalThis.__enrich = enrichPreviewInspectorRenderTreeSnapshot;
    `,
    context,
  );
  const runtime = context.__enrich;
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
