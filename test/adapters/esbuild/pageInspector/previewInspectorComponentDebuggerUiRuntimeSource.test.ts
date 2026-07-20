/** Verifies component-scoped debugger ownership and safe render-state controls. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorComponentDebuggerUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorComponentDebuggerUiRuntimeSource';
import { createPreviewInspectorLayoutRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorLayoutRuntimeSource';

/** Minimal selected component and blocker shape consumed by the generated pure scope helper. */
interface ComponentDebuggerNode {
  readonly blockerId?: string;
  readonly blockerKind?: string;
  readonly children: readonly ComponentDebuggerNode[];
  readonly conditionId?: string;
  readonly exportName?: string;
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly source?: { readonly path?: string };
}

/** Runtime record metadata sufficient for exact owner/source correlation. */
interface ComponentDebuggerRecord {
  readonly id: string;
  readonly ownerName?: string;
  readonly sourcePath?: string;
}

/** Pure generated helpers exposed from the VM without mounting React. */
interface ComponentDebuggerRuntime {
  readonly matchesOwner: (record: ComponentDebuggerRecord, node: ComponentDebuggerNode) => boolean;
  readonly scope: (
    node: ComponentDebuggerNode,
    requests: readonly ComponentDebuggerRecord[],
    fallbacks: readonly ComponentDebuggerRecord[],
  ) => {
    readonly conditions: readonly ComponentDebuggerNode[];
    readonly fallbacks: readonly ComponentDebuggerRecord[];
    readonly requests: readonly ComponentDebuggerRecord[];
  };
}

describe('Preview Inspector component debugger UI runtime source', () => {
  /** Keeps the generated browser module syntactically valid without requiring project React. */
  it('emits a standalone component debugger module', () => {
    expect(
      () => new vm.Script(createPreviewInspectorComponentDebuggerUiRuntimeSource()),
    ).not.toThrow();
  });

  /** Admits exact owners/direct tree assignments and rejects same-file sibling component records. */
  it('scopes render conditions, backend requests, and hook fallbacks to the selected component', () => {
    const runtime = evaluateComponentDebuggerRuntime();
    const condition: ComponentDebuggerNode = {
      children: [],
      conditionId: 'condition:visible',
      id: 'render-condition:visible',
      kind: 'condition',
      name: 'visible && Panel',
    };
    const node: ComponentDebuggerNode = {
      children: [
        condition,
        {
          blockerId: 'direct-request',
          blockerKind: 'data-request',
          children: [],
          id: 'data-blocker:direct-request',
          kind: 'blocker',
          name: 'Direct request',
        },
        {
          blockerId: 'direct-fallback',
          blockerKind: 'runtime-fallback',
          children: [],
          id: 'runtime-blocker:direct-fallback',
          kind: 'blocker',
          name: 'Direct fallback',
        },
      ],
      exportName: 'default',
      id: 'fiber:dashboard',
      kind: 'component',
      name: 'ReactPreviewInspector(Dashboard)',
      source: { path: '/workspace/src/pages/Dashboard.tsx' },
    };
    const requests: ComponentDebuggerRecord[] = [
      { id: 'direct-request' },
      {
        id: 'owned-request',
        ownerName: 'Dashboard',
        sourcePath: './src/pages/Dashboard.tsx',
      },
      {
        id: 'sibling-request',
        ownerName: 'DashboardSidebar',
        sourcePath: '/workspace/src/pages/Dashboard.tsx',
      },
      {
        id: 'wrong-file-request',
        ownerName: 'Dashboard',
        sourcePath: '/workspace/src/pages/Other.tsx',
      },
    ];
    const fallbacks: ComponentDebuggerRecord[] = [
      { id: 'direct-fallback' },
      {
        id: 'owned-fallback',
        ownerName: 'Dashboard',
        sourcePath: '/workspace/src/pages/Dashboard.tsx',
      },
      {
        id: 'source-only-fallback',
        sourcePath: '/workspace/src/pages/Dashboard.tsx',
      },
    ];

    const scope = runtime.scope(node, requests, fallbacks);

    expect(scope.conditions.map((item) => item.id)).toEqual(['render-condition:visible']);
    expect(scope.requests.map((item) => item.id)).toEqual(['direct-request', 'owned-request']);
    expect(scope.fallbacks.map((item) => item.id)).toEqual(['direct-fallback', 'owned-fallback']);
    expect(runtime.matchesOwner(requests[1] ?? { id: 'missing' }, node)).toBe(true);
    expect(runtime.matchesOwner(requests[2] ?? { id: 'missing' }, node)).toBe(false);
    expect(runtime.matchesOwner(fallbacks[2] ?? { id: 'missing' }, node)).toBe(false);
  });

  /** Exposes four responsive views and only public-safe state adjustment operations. */
  it('renders Props, Render State, Source, and scoped Payload controls', () => {
    const source = createPreviewInspectorComponentDebuggerUiRuntimeSource();
    const layoutSource = createPreviewInspectorLayoutRuntimeSource();

    expect(source).toContain("['props', 'Props']");
    expect(source).toContain("['state', 'State']");
    expect(source).toContain("['source', 'Source']");
    expect(source).toContain("['payload', 'Payload']");
    expect(source).toContain('PreviewInspectorPropsDetail, { node }');
    expect(source).toContain('PreviewInspectorComponentRenderStateDetail');
    expect(source).toContain('setPreviewInspectorRenderConditionOverride(condition.id, true)');
    expect(source).toContain('setPreviewInspectorRenderConditionOverride(condition.id, false)');
    expect(source).toContain('resetPreviewInspectorRenderConditionOverride(condition.id)');
    expect(source).toContain('PreviewInspectorSourceDetail, { node }');
    expect(source).toContain('requestIds: scope.requests.map');
    expect(source).toContain('PreviewInspectorRuntimeBlockerDetail');
    expect(source).toContain('restorePreviewInspectorHiddenElement(summary.id)');
    expect(source).toContain("className: 'rpi-tabs'");
    expect(source).toContain("className: 'rpi-detail-content'");
    expect(source).toContain('}, [node?.id, fallbackIdentity]);');
    expect(source).toContain("role: 'tabpanel'");
    expect(layoutSource).toContain(
      '.rpi-component-debugger{display:grid;gap:1px;max-width:100%;min-height:0;min-width:0}',
    );
    expect(layoutSource).toContain(
      '.rpi-component-debugger-panel{max-width:100%;min-height:0;min-width:0}',
    );
    expect(source).toContain('React has no stable public API for rewriting arbitrary hook slots');
    expect(source).not.toContain('memoizedState =');
    expect(source).not.toContain('scrollIntoView');
    expect(source).not.toContain('scrollTop =');
  });
});

/** Evaluates only deterministic ownership helpers in a browser-neutral VM realm. */
function evaluateComponentDebuggerRuntime(): ComponentDebuggerRuntime {
  const context: { __runtime?: ComponentDebuggerRuntime } = {};
  vm.runInNewContext(
    `
      const isPreviewInspectorConditionNode = (node) =>
        node?.kind === 'condition' && typeof node?.conditionId === 'string';
      ${createPreviewInspectorComponentDebuggerUiRuntimeSource()}
      globalThis.__runtime = {
        matchesOwner: isPreviewInspectorRecordOwnedByComponent,
        scope: createPreviewInspectorComponentDebuggerScope,
      };
    `,
    context,
  );
  if (context.__runtime === undefined) throw new Error('Component debugger runtime did not load.');
  return context.__runtime;
}
