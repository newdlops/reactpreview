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

/** Observable reachability state retained after one target-output evaluation. */
interface TestTargetOutputState {
  readonly targetDeferredCallbackPending?: boolean;
  readonly targetExportName: string;
}

/** Result and diagnostic state produced by one selected-outcome evaluation. */
interface TestTargetOutputEvaluation {
  readonly resolved: boolean;
  readonly state: TestTargetOutputState;
}

/** Evaluates one selected outcome and exposes both its readiness and pending-callback evidence. */
function evaluateResolvedOutput(
  componentTree: readonly Record<string, unknown>[],
  liveChild: TestFiber | undefined,
  options: {
    readonly host?: boolean;
    readonly includePlan?: boolean;
    readonly kind?: 'empty' | 'jsx';
    readonly selected?: boolean;
  } = {},
): TestTargetOutputEvaluation {
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
    __state?: TestTargetOutputState;
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
      const state = { targetExportName: 'default' };
      globalThis.__result = hasPreviewInspectorResolvedTargetOutput(
        { fiber: { child: liveChild }, host: globalThis.__host },
        state,
      );
      globalThis.__state = state;
    `,
    context,
  );
  if (context.__state === undefined) throw new Error('Target output state was not captured.');
  return { resolved: context.__result === true, state: context.__state };
}

/** Evaluates one selected outcome when a test needs only its ready/not-ready decision. */
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
  return evaluateResolvedOutput(componentTree, liveChild, options).resolved;
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

  /** Generated structural UI keeps the authored export identity for target-output verification. */
  it('matches a generated UI placeholder to its missing authored component', () => {
    const expected = [{ children: [], name: 'Card' }];
    const live = { kind: 'function', name: 'PreviewGenerated(Card)' };

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

    const loadingEvaluation = evaluateResolvedOutput(expected, loading);
    const readyEvaluation = evaluateResolvedOutput(expected, ready);

    expect(loadingEvaluation.resolved).toBe(false);
    expect(loadingEvaluation.state.targetDeferredCallbackPending).toBe(true);
    expect(readyEvaluation.resolved).toBe(true);
    expect(readyEvaluation.state.targetDeferredCallbackPending).toBe(false);
  });

  /** A callback below an absent modal receiver is unresolved output, not a live callback wait. */
  it('classifies a deep deferred callback as pending only after its receiver mounts', () => {
    const expected = [
      {
        children: [{ children: [], name: 'ModalBody', renderMode: 'deferred-callback' }],
        name: 'Modal',
      },
    ];
    const absentReceiver = evaluateResolvedOutput(expected, {
      kind: 'function',
      name: 'ErrorFallback',
    });
    const liveReceiver = evaluateResolvedOutput(expected, {
      kind: 'function',
      name: 'Modal',
    });

    expect(absentReceiver.resolved).toBe(false);
    expect(absentReceiver.state.targetDeferredCallbackPending).not.toBe(true);
    expect(liveReceiver.resolved).toBe(false);
    expect(liveReceiver.state.targetDeferredCallbackPending).toBe(true);
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
