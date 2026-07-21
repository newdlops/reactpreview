/** Verifies that wrapper fallback DOM cannot masquerade as the selected file's authored JSX. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorTargetOutputRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetOutputRuntimeSource';

/** Minimal synthetic Fiber used to express component ownership without mounting React. */
interface TestFiber {
  readonly child?: TestFiber;
  readonly kind: string;
  readonly name: string;
  readonly sibling?: TestFiber;
}

/** Evaluates one selected outcome against a live boundary-shaped component tree. */
function hasResolvedOutput(
  componentTree: readonly Record<string, unknown>[],
  liveChild: TestFiber | undefined,
  options: {
    readonly host?: boolean;
    readonly includePlan?: boolean;
    readonly kind?: 'empty' | 'jsx';
    readonly selected?: boolean;
  } = {},
): boolean {
  const outcome = {
    componentTree,
    exportName: 'default',
    id: 'selected-outcome',
    kind: options.kind ?? 'jsx',
    ...(options.selected === false
      ? { conditions: [{ branch: 'truthy', expression: 'hidden', kind: 'if' }] }
      : {}),
  };
  const context: {
    __host: boolean;
    __includePlan: boolean;
    __liveChild: TestFiber | undefined;
    __outcome: typeof outcome;
    __result?: boolean;
    __selected: boolean;
  } = {
    __host: options.host !== false,
    __includePlan: options.includePlan !== false,
    __liveChild: liveChild,
    __outcome: outcome,
    __selected: options.selected !== false,
  };
  vm.runInNewContext(
    `
      const outcome = globalThis.__outcome;
      const liveChild = globalThis.__liveChild;
      const descriptor = { inspector: { renderOutcomesByExport: {
        default: globalThis.__includePlan ? { outcomes: [outcome] } : undefined,
      } } };
      const findSelectedPreviewInspectorDescriptor = () => descriptor;
      const readPreviewInspectorSelectedRenderOutcome = () =>
        globalThis.__selected ? outcome : undefined;
      const readPreviewInspectorBoundaryFiber = (boundary) => boundary.fiber;
      const readPreviewInspectorFiberLink = (fiber, name) => fiber?.[name];
      const classifyPreviewInspectorFiber = (fiber) => fiber?.kind ?? 'other';
      const namePreviewInspectorFiber = (fiber) => fiber?.name ?? 'Anonymous';
      const isPreviewInspectorOwnedFiber = () => false;
      const collectPreviewInspectorFiberElements = (boundary) => boundary.host ? [{}] : [];
      ${createPreviewInspectorTargetOutputRuntimeSource()}
      globalThis.__result = hasPreviewInspectorResolvedTargetOutput(
        { fiber: { child: liveChild }, host: globalThis.__host },
        { targetExportName: 'default' },
      );
    `,
    context,
  );
  return context.__result === true;
}

describe('Preview Inspector target output runtime source', () => {
  /** A loader host below QueryRenderer is not the Page subtree authored by the current file. */
  it('rejects wrapper fallback DOM when the expected nested page components are absent', () => {
    const expected = [
      {
        children: [
          {
            children: [{ children: [], name: 'PageHeader' }],
            name: 'Page',
          },
        ],
        name: 'QueryRenderer',
      },
    ];
    const live = {
      child: { kind: 'function', name: 'Loader' },
      kind: 'function',
      name: 'QueryRenderer',
    };

    expect(hasResolvedOutput(expected, live)).toBe(false);
  });

  /** The same boundary becomes ready after a nested authored component reaches the live Fiber. */
  it('accepts host output after the expected page descendant mounts', () => {
    const expected = [
      {
        children: [{ children: [{ children: [], name: 'PageHeader' }], name: 'Page' }],
        name: 'QueryRenderer',
      },
    ];
    const live = {
      child: { child: { kind: 'function', name: 'PageHeader' }, kind: 'function', name: 'Page' },
      kind: 'function',
      name: 'QueryRenderer',
    };

    expect(hasResolvedOutput(expected, live)).toBe(true);
  });

  /** A receiver-owned loader is not proof that its function child has been invoked. */
  it('requires a deferred render-prop root instead of accepting wrapper fallback output', () => {
    const expected = [
      {
        children: [
          { children: [], name: 'SectionLoader' },
          { children: [], name: 'Page', renderMode: 'deferred-callback' },
        ],
        name: 'QueryRenderer',
      },
    ];
    const loading = {
      child: { kind: 'function', name: 'SectionLoader' },
      kind: 'function',
      name: 'QueryRenderer',
    };
    const ready = {
      child: { kind: 'function', name: 'Page' },
      kind: 'function',
      name: 'QueryRenderer',
    };

    expect(hasResolvedOutput(expected, loading)).toBe(false);
    expect(hasResolvedOutput(expected, ready)).toBe(true);
  });

  /** Distinguishes an intrinsic callback result from a named receiver-owned loading component. */
  it('keeps intrinsic render callbacks pending until their fallback component leaves', () => {
    const expected = [
      {
        children: [
          { children: [], name: 'SectionLoader' },
          { children: [], name: '#deferred-host-output', renderMode: 'deferred-callback' },
        ],
        name: 'QueryRenderer',
      },
    ];
    const loading = {
      child: { kind: 'function', name: 'SectionLoader' },
      kind: 'function',
      name: 'QueryRenderer',
    };
    const ready = {
      child: { kind: 'host', name: 'div' },
      kind: 'function',
      name: 'QueryRenderer',
    };

    expect(hasResolvedOutput(expected, loading)).toBe(false);
    expect(hasResolvedOutput(expected, ready)).toBe(true);
  });

  /** A dormant optional modal callback cannot hide an independently mounted page subtree. */
  it('accepts independent page output while an optional deferred slot remains dormant', () => {
    const expected = [
      { children: [], name: 'MainContent' },
      {
        children: [{ children: [], name: 'Modal', renderMode: 'deferred-callback' }],
        name: 'ModalController',
      },
    ];
    const live = {
      kind: 'function',
      name: 'MainContent',
      sibling: { kind: 'function', name: 'ModalController' },
    };

    expect(hasResolvedOutput(expected, live)).toBe(true);
  });

  /** An explicitly selected empty return is a completed render contract, not a DFS failure. */
  it('accepts an intentional empty outcome without manufacturing a host node', () => {
    expect(hasResolvedOutput([], undefined, { host: false, kind: 'empty' })).toBe(true);
    expect(hasResolvedOutput([], undefined, { host: false, kind: 'empty', selected: false })).toBe(
      false,
    );
  });

  /** Preserves ordinary host semantics when older descriptors contain no outcome evidence. */
  it('falls back to connected host output when no static outcome plan exists', () => {
    expect(hasResolvedOutput([], undefined, { includePlan: false })).toBe(true);
    expect(hasResolvedOutput([], undefined, { host: false, includePlan: false })).toBe(false);
  });
});
