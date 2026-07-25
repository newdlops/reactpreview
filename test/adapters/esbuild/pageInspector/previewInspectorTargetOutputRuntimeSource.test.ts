/** Verifies that wrapper fallback DOM cannot masquerade as the selected file's authored JSX. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorTargetOutputRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetOutputRuntimeSource';

/** Minimal synthetic Fiber used to express component ownership without mounting React. */
interface TestFiber {
  readonly child?: TestFiber;
  readonly elementType?: object;
  readonly kind: string;
  readonly name: string;
  readonly sibling?: TestFiber;
  readonly type?: object;
}

/** Observable reachability state retained after one target-output evaluation. */
interface TestTargetOutputState {
  readonly targetDeferredCallbackPending?: boolean;
  readonly targetExportName: string;
  readonly targetOutputError?: { readonly message: string; readonly ownerName?: string };
  readonly targetOutputKind?: string;
}

/** Result and diagnostic state produced by one selected-outcome evaluation. */
interface TestTargetOutputEvaluation {
  readonly clearedErrors: number;
  readonly resolved: boolean;
  readonly scheduledRecoveryMs: number | undefined;
  readonly state: TestTargetOutputState;
}

/** Evaluates one selected outcome and exposes both its readiness and pending-callback evidence. */
function evaluateResolvedOutput(
  componentTree: readonly Record<string, unknown>[],
  liveChild: TestFiber | undefined,
  options: {
    readonly activeError?: {
      readonly eventId?: string;
      readonly message: string;
      readonly ownerName?: string;
      readonly timestamp: number;
    };
    readonly exactOwnership?: boolean;
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
    __activeError:
      | {
          readonly eventId?: string;
          readonly message: string;
          readonly ownerName?: string;
          readonly timestamp: number;
        }
      | undefined;
    __cleared: number;
    __exactOwnership: boolean;
    __outcome: typeof outcome;
    __result?: boolean;
    __scheduled?: { readonly delay: number };
    __selected: boolean;
    __state?: TestTargetOutputState;
  } = {
    __activeError: options.activeError,
    __cleared: 0,
    __exactOwnership: options.exactOwnership !== false,
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
      const targetType = {};
      const targetFiber = liveChild === undefined ? undefined : {
        ...liveChild,
        elementType: globalThis.__exactOwnership ? targetType : {},
        type: globalThis.__exactOwnership ? targetType : {},
      };
      const descriptor = { inspector: { renderOutcomesByExport: {
        default: globalThis.__includePlan ? { outcomes: [outcome] } : undefined,
      } } };
      const findSelectedPreviewInspectorDescriptor = () => descriptor;
      const readPreviewInspectorSelectedRenderOutcome = () =>
        globalThis.__selected ? outcome : undefined;
      const readPreviewInspectorBoundaryFiber = (boundary) => boundary.fiber;
      const readPreviewInspectorFiberLink = (fiber, name) => fiber?.[name];
      const readPreviewInspectorOwnData = (value, key) => value?.[key];
      const classifyPreviewInspectorFiber = (fiber) => fiber?.kind ?? 'other';
      const namePreviewInspectorFiber = (fiber) => fiber?.name ?? 'Anonymous';
      const isPreviewInspectorOwnedFiber = () => false;
      const collectPreviewInspectorFiberElements = (boundary) => boundary.host ? [{}] : [];
      const readPreviewInspectorRuntimeHealthTargetError = () => globalThis.__activeError;
      const clearPreviewInspectorRuntimeHealthTargetError = () => {
        globalThis.__activeError = undefined;
        globalThis.__cleared += 1;
      };
      const schedulePreviewInspectorCommitRefresh = () => undefined;
      const schedulePreviewInspectorTreeRefresh = () => undefined;
      const setTimeout = (_callback, delay) => {
        globalThis.__scheduled = { delay };
        return 1;
      };
      const clearTimeout = () => undefined;
      ${createPreviewInspectorTargetOutputRuntimeSource()}
      const state = { targetExportName: 'default' };
      globalThis.__result = hasPreviewInspectorResolvedTargetOutput(
        {
          fiber: { child: targetFiber },
          host: globalThis.__host,
          props: { children: { type: targetType } },
        },
        state,
      );
      globalThis.__state = state;
    `,
    context,
  );
  if (context.__state === undefined) throw new Error('Target output state was not captured.');
  return {
    clearedErrors: context.__cleared,
    resolved: context.__result === true,
    scheduledRecoveryMs: context.__scheduled?.delay,
    state: context.__state,
  };
}

/** Evaluates one selected outcome when a test needs only its ready/not-ready decision. */
function hasResolvedOutput(
  componentTree: readonly Record<string, unknown>[],
  liveChild: TestFiber | undefined,
  options: {
    readonly activeError?: {
      readonly eventId?: string;
      readonly message: string;
      readonly ownerName?: string;
      readonly timestamp: number;
    };
    readonly exactOwnership?: boolean;
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

  /** Older descriptors still require exact selected-boundary Fiber ownership before host success. */
  it('accepts connected host output without a plan only for the exact target Fiber', () => {
    const live = { kind: 'function', name: 'Target' };
    expect(hasResolvedOutput([], live, { includePlan: false })).toBe(true);
    expect(
      hasResolvedOutput([], live, {
        exactOwnership: false,
        includePlan: false,
      }),
    ).toBe(false);
    expect(hasResolvedOutput([], undefined, { host: false, includePlan: false })).toBe(false);
  });

  /** A committed application error page cannot turn target reachability green as its DOM grows. */
  it('classifies error fallback DOM separately and retains its original owner', () => {
    const error = {
      eventId: 'runtime-health-1',
      message: 'Error: Unreachable',
      ownerName: 'FiStaManagementApp',
      timestamp: Date.now() - 1_000,
    };
    const evaluation = evaluateResolvedOutput(
      [{ children: [], name: 'MainPanel' }],
      {
        child: { kind: 'function', name: 'ErrorStatus' },
        kind: 'function',
        name: 'FiStaManagementApp',
      },
      { activeError: error },
    );

    expect(evaluation.resolved).toBe(false);
    expect(evaluation.state.targetOutputKind).toBe('fallback-output');
    expect(evaluation.state.targetOutputError).toMatchObject({
      message: 'Error: Unreachable',
      ownerName: 'FiStaManagementApp',
    });
    expect(evaluation.clearedErrors).toBe(0);
  });

  /** A new healthy exact commit is rechecked after the short error settlement grace. */
  it('schedules a bounded recovery check for exact healthy output after a fresh error', () => {
    const evaluation = evaluateResolvedOutput(
      [{ children: [], name: 'MainPanel' }],
      {
        child: { kind: 'function', name: 'MainPanel' },
        kind: 'function',
        name: 'FiStaManagementApp',
      },
      {
        activeError: {
          eventId: 'runtime-health-2',
          message: 'Error: transient',
          timestamp: Date.now(),
        },
      },
    );

    expect(evaluation.resolved).toBe(false);
    expect(evaluation.state.targetOutputKind).toBe('fallback-output');
    expect(evaluation.scheduledRecoveryMs).toBeGreaterThan(0);
    expect(evaluation.scheduledRecoveryMs).toBeLessThanOrEqual(321);
  });

  /** Exact authored output clears a settled root error only after fallback components disappear. */
  it('promotes late exact target Fiber output and clears the stale root error', () => {
    const evaluation = evaluateResolvedOutput(
      [{ children: [], name: 'MainPanel' }],
      {
        child: { kind: 'function', name: 'MainPanel' },
        kind: 'function',
        name: 'FiStaManagementApp',
      },
      {
        activeError: {
          eventId: 'runtime-health-3',
          message: 'Error: recovered',
          timestamp: Date.now() - 1_000,
        },
      },
    );

    expect(evaluation.resolved).toBe(true);
    expect(evaluation.state.targetOutputKind).toBe('target-output');
    expect(evaluation.clearedErrors).toBe(1);
  });
});
