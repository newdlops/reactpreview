/** Verifies component geometry and failed-subtree placement without mounting project React code. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorWireframeUiRuntimeSource,
  PREVIEW_INSPECTOR_WIREFRAME_ITEM_LIMIT,
  PREVIEW_INSPECTOR_WIREFRAME_VISIT_LIMIT,
} from '../../../../src/adapters/esbuild/pageInspector/previewInspectorWireframeUiRuntimeSource';

/** Minimal tree record consumed by the generated layout collector. */
interface WireframeNode {
  readonly blocker?: { readonly mode?: string };
  readonly blockerKind?: string;
  readonly blockedOwner?: boolean;
  readonly children: readonly WireframeNode[];
  readonly condition?: { readonly effectiveEnabled?: boolean };
  readonly contextOnly?: boolean;
  readonly currentFileExport?: boolean;
  readonly edgeKind?: string;
  readonly id: string;
  readonly kind: string;
  readonly mounted?: boolean;
  readonly name: string;
}

/** Rectangle emitted for a mounted or inferred component placement. */
interface WireframeBox {
  readonly node: WireframeNode;
  readonly placeholder: boolean;
  readonly rect: {
    readonly height: number;
    readonly left: number;
    readonly top: number;
    readonly width: number;
  };
}

/** Serializable result exposed from the generated runtime fixture. */
interface WireframeLayout {
  readonly blockers: readonly {
    readonly anchor: WireframeBox['rect'];
    readonly node: WireframeNode;
  }[];
  readonly boxes: readonly WireframeBox[];
  readonly context: readonly { readonly name: string }[];
}

/** Pure helper surface published by the VM fixture. */
interface WireframeRuntime {
  readonly collect: (
    snapshot: Record<string, unknown>,
    viewport: { readonly height: number; readonly width: number },
  ) => WireframeLayout;
  readonly copyIndexes: (
    source: Record<string, unknown>,
    target: Record<string, unknown>,
  ) => Record<string, unknown>;
  readonly consumeReveal: (nodeId: string) => boolean;
  readonly revealBlocker: (node: WireframeNode, setCollapsed: (value: boolean) => void) => void;
  readonly readCompanion: () => Record<string, unknown>;
  readonly readSession: () => Record<string, unknown>;
}

/** DOM-like host sufficient for the geometry collector's defensive element checks. */
function hostRect(left: number, top: number, width: number, height: number): object {
  return {
    closest: () => null,
    getBoundingClientRect: () => ({
      bottom: top + height,
      height,
      left,
      right: left + width,
      top,
      width,
    }),
    isConnected: true,
  };
}

describe('Preview Inspector wireframe UI runtime source', () => {
  /** Uses live host bounds while leaving a visible inferred slot for an uncommitted failed child. */
  it('places mounted components and anchors a blocker to its failed component placeholder', () => {
    const runtime = evaluateWireframeRuntime();
    const pageHost = hostRect(10, 20, 600, 500);
    const cardHost = hostRect(40, 90, 220, 120);
    const snapshot = {
      hostNodesById: new Map<string, readonly object[]>([
        ['page', [pageHost]],
        ['card', [cardHost]],
      ]),
      roots: [
        {
          children: [
            { children: [], id: 'card', kind: 'function', name: 'SummaryCard' },
            {
              blockedOwner: true,
              children: [
                {
                  blockerKind: 'target-error',
                  children: [],
                  id: 'failure:chart',
                  kind: 'blocker',
                  name: 'Render blocked · RevenueChart',
                },
              ],
              id: 'blocked:chart',
              kind: 'component',
              mounted: false,
              name: 'RevenueChart',
            },
          ],
          id: 'page',
          kind: 'function',
          name: 'DashboardPage',
        },
      ],
    };

    const layout = runtime.collect(snapshot, { height: 720, width: 900 });

    expect(layout.boxes.map((item) => [item.node.id, item.placeholder])).toEqual([
      ['page', false],
      ['card', false],
      ['blocked:chart', true],
    ]);
    const failedBox = layout.boxes.find((item) => item.node.id === 'blocked:chart');
    expect(failedBox?.rect.left).toBeGreaterThan(10);
    expect(layout.blockers[0]).toMatchObject({
      node: { id: 'failure:chart' },
      anchor: failedBox?.rect,
    });
  });

  /** Keeps authored branch toggles in the Inspector without mislabeling dormant JSX as failures. */
  it('does not mark ordinary enabled or disabled conditions as runtime blockers', () => {
    const runtime = evaluateWireframeRuntime();
    const layout = runtime.collect(
      {
        roots: [
          {
            children: [
              {
                children: [],
                condition: { effectiveEnabled: false },
                id: 'condition:off',
                kind: 'condition',
                name: 'showDetails && Details',
              },
              {
                children: [],
                condition: { effectiveEnabled: true },
                id: 'condition:on',
                kind: 'condition',
                name: 'showHeader && Header',
              },
            ],
            contextOnly: true,
            edgeKind: 'workspace-render-root',
            id: 'workspace',
            kind: 'entry',
            name: 'Workspace React render root',
          },
        ],
      },
      { height: 600, width: 800 },
    );

    expect(layout.blockers).toEqual([]);
    expect(layout.context.map((item) => item.name)).toContain('Workspace React render root');
  });

  /** Does not paint successful Auto substitutions as failures or synthesize their hook owners. */
  it('omits assisted runtime values from blocker markers and failed-owner placeholders', () => {
    const runtime = evaluateWireframeRuntime();
    const layout = runtime.collect(
      {
        roots: [
          {
            blockedOwner: true,
            children: [
              {
                blocker: { mode: 'auto' },
                blockerKind: 'runtime-fallback',
                children: [],
                id: 'fallback:query',
                kind: 'blocker',
                name: 'Missing hook value · useQuery',
              },
            ],
            id: 'synthetic:useQuery',
            kind: 'component',
            mounted: false,
            name: 'useQuery',
          },
        ],
      },
      { height: 600, width: 800 },
    );

    expect(layout.blockers).toEqual([]);
    expect(layout.boxes).toEqual([]);
  });

  /** Coalesces identical visual ownership and keeps the current-file component as representative. */
  it('deduplicates shared component rectangles without retaining generic styled wrappers', () => {
    const runtime = evaluateWireframeRuntime();
    const sharedHost = hostRect(20, 30, 500, 240);
    const snapshot = {
      hostNodesById: new Map<string, readonly object[]>([
        ['layout', [sharedHost]],
        ['target', [sharedHost]],
        ['styled', [sharedHost]],
      ]),
      roots: [
        { children: [], id: 'layout', kind: 'function', name: 'DashboardLayout' },
        {
          children: [],
          currentFileExport: true,
          id: 'target',
          kind: 'function',
          name: 'InvestmentAnalysisPage',
        },
        { children: [], id: 'styled', kind: 'forward-ref', name: 'Styled(Component)' },
      ],
    };

    const layout = runtime.collect(snapshot, { height: 720, width: 900 });

    expect(layout.boxes.map((item) => item.node.id)).toEqual(['target']);
  });

  /** Preserves live maps as hidden runtime-only fields through serializable tree enrichment. */
  it('copies collector indexes without making DOM references enumerable', () => {
    const runtime = evaluateWireframeRuntime();
    const hostNodesById = new Map([['page', [hostRect(0, 0, 10, 10)]]]);
    const source: Record<string, unknown> = {};
    Object.defineProperty(source, 'hostNodesById', { value: hostNodesById });
    const target = runtime.copyIndexes(source, { roots: [] });

    expect(target.hostNodesById).toBe(hostNodesById);
    expect(Object.keys(target)).toEqual(['roots']);
  });

  /** Selects a wireframe blocker and requests an owner-relative reveal in the component tree. */
  it('routes a wireframe marker to its component-tree blocker row', () => {
    const selected: WireframeNode[] = [];
    const collapsedValues: boolean[] = [];
    const hostMessages: unknown[] = [];
    const runtime = evaluateWireframeRuntime(selected, hostMessages);
    const blocker: WireframeNode = {
      children: [],
      id: 'blocker:query',
      kind: 'blocker',
      name: 'Data · Query dashboard',
    };

    runtime.revealBlocker(blocker, (value) => collapsedValues.push(value));

    expect(selected).toEqual([blocker]);
    expect(collapsedValues).toEqual([false]);
    expect(runtime.readSession()).toMatchObject({
      collapsed: false,
      treeRevealRevision: 1,
    });
    expect(runtime.readSession()).not.toHaveProperty('navigationTab');
    expect(runtime.readSession()).not.toHaveProperty('selectedBlockerFlowNodeId');
    expect(hostMessages).toEqual([{ type: 'react-preview-inspector-companion-reveal' }]);
    expect(runtime.consumeReveal(blocker.id)).toBe(true);
    expect(runtime.readCompanion()).toMatchObject({ pendingTreeReveal: blocker.id });
  });

  /** Keeps emitted limits explicit and the interaction surface constrained to blocker buttons. */
  it('emits bounded, pointer-safe page wireframe controls', () => {
    const source = createPreviewInspectorWireframeUiRuntimeSource();

    expect(PREVIEW_INSPECTOR_WIREFRAME_ITEM_LIMIT).toBe(160);
    expect(PREVIEW_INSPECTOR_WIREFRAME_VISIT_LIMIT).toBe(768);
    expect(source).toContain('function PreviewInspectorWireframeLayer');
    expect(source).toContain("'data-react-preview-wireframe-blocker': item.node.id");
    expect(source).toContain('onSelectBlocker(item.node)');
    expect(source).toContain("'!',");
    expect(source).not.toContain("React.createElement('span', { 'aria-hidden': true }, '⚠')");
    expect(source).toContain('requestAnimationFrame');
    expect(source).not.toContain('setInterval');
  });
});

/** Evaluates only the wireframe's data helpers in a deterministic browser-neutral realm. */
function evaluateWireframeRuntime(
  selected: WireframeNode[] = [],
  hostMessages: unknown[] = [],
): WireframeRuntime {
  const context: {
    __wireframe?: WireframeRuntime;
    hostMessages: unknown[];
    selected: WireframeNode[];
  } = { hostMessages, selected };
  vm.runInNewContext(
    `
      const previewInspectorDevtoolsSessionState = { collapsed: true };
      const previewInspectorCompanionState = {};
      const notifyPreviewInspector = () => undefined;
      const persistPreviewInspectorState = () => undefined;
      const selectPreviewInspectorUiNode = (node) => selected.push(node);
      const previewInspectorPostHostMessage = (message) => hostMessages.push(message);
      const isPreviewInspectorBlockerNode = (node) =>
        node?.kind === 'blocker' || node?.kind === 'condition';
      const isPreviewInspectorBlockingNode = (node) =>
        node?.kind !== 'condition' &&
        (node?.blockerKind !== 'runtime-fallback' || node?.blocker?.mode === 'disabled');
      const findSelectedPreviewInspectorDescriptor = () => undefined;
      const readSelectedPreviewInspectorPageCandidate = () => undefined;
      ${createPreviewInspectorWireframeUiRuntimeSource()}
      globalThis.__wireframe = {
        collect: collectPreviewInspectorWireframeLayout,
        consumeReveal: consumePreviewInspectorTreeReveal,
        copyIndexes: copyPreviewInspectorSnapshotRuntimeIndexes,
        readCompanion: () => ({ ...previewInspectorCompanionState }),
        readSession: () => ({ ...previewInspectorDevtoolsSessionState }),
        revealBlocker: revealPreviewInspectorWireframeBlocker,
      };
    `,
    context,
  );
  if (context.__wireframe === undefined)
    throw new Error('Wireframe runtime fixture did not initialize.');
  return context.__wireframe;
}
