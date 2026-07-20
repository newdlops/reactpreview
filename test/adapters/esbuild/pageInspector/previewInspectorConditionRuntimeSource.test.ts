/** Exercises Page Inspector branch overrides and automatic-value state without mounting React. */
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { createPreviewInspectorConditionRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorConditionRuntimeSource';

interface ConditionRuntimeHarness {
  readonly getRevision: () => number;
  readonly rememberDirectOwner: (exportName: string, ownerName: string) => void;
  readonly readConditions: () => readonly Record<string, unknown>[];
  readonly readFallbackValuesEnabled: () => boolean;
  readonly isAutoConditionRejected: (conditionId: string, reachabilityKey: string) => boolean;
  readonly resetCondition: (conditionId: string) => void;
  readonly resolveCondition: (
    conditionId: string,
    authoredValue: unknown,
    metadata: Record<string, unknown>,
  ) => unknown;
  readonly session: Record<string, unknown>;
  readonly setAutoCondition: (conditionId: string, enabled: boolean) => boolean;
  readonly setCondition: (conditionId: string, enabled: boolean) => void;
  readonly setFallbackValuesEnabled: (enabled: boolean) => void;
  readonly rollbackAutoDecision: (traceId: string) => boolean;
}

describe('Preview Inspector condition runtime source', () => {
  /** Preserves authored values until an explicit branch override is selected. */
  it('resolves authored, forced false, forced true, and reset states', async () => {
    const persist = vi.fn();
    const harness = createConditionRuntimeHarness({}, persist);
    const truthyValue = { loaded: true };
    const metadata = {
      expression: 'data',
      falsyLabel: '<LoadingFallback>',
      kind: 'ternary',
      sourcePath: '/workspace/Page.tsx',
      truthyLabel: '<Content>',
    };

    expect(harness.resolveCondition('condition-1', truthyValue, metadata)).toBe(truthyValue);
    await Promise.resolve();
    expect(harness.readConditions()[0]).toMatchObject({
      authoredEnabled: true,
      effectiveEnabled: true,
      override: undefined,
    });

    harness.setCondition('condition-1', false);
    expect(harness.resolveCondition('condition-1', truthyValue, metadata)).toBe(false);
    expect(harness.readConditions()[0]).toMatchObject({ effectiveEnabled: false, override: false });

    harness.setCondition('condition-1', true);
    expect(harness.resolveCondition('condition-1', false, metadata)).toBe(true);
    expect(harness.readConditions()[0]).toMatchObject({ effectiveEnabled: true, override: true });

    harness.resetCondition('condition-1');
    expect(harness.resolveCondition('condition-1', false, metadata)).toBe(false);
    expect(harness.readConditions()[0]).toMatchObject({
      authoredEnabled: false,
      effectiveEnabled: false,
      override: undefined,
    });
    expect(harness.getRevision()).toBe(3);
    expect(persist).toHaveBeenCalledTimes(3);
  });

  /** Restores the persisted automatic-value preference and advances the shared remount revision. */
  it('toggles preview-generated fallback values independently from branch overrides', () => {
    const harness = createConditionRuntimeHarness({ fallbackValuesEnabled: false }, vi.fn());

    expect(harness.readFallbackValuesEnabled()).toBe(false);
    harness.setFallbackValuesEnabled(true);

    expect(harness.readFallbackValuesEnabled()).toBe(true);
    expect(harness.getRevision()).toBe(1);
  });

  /** Preserves compiler-proven overlay role metadata for the component-tree presentation layer. */
  it('retains bounded overlay visibility metadata', async () => {
    const harness = createConditionRuntimeHarness({}, vi.fn());

    harness.resolveCondition('overlay-condition', false, {
      expression: '<DeleteModal>.open: open',
      falsyLabel: 'hidden <DeleteModal> overlay',
      kind: 'overlay-visibility',
      role: 'overlay',
      sourcePath: '/workspace/Page.tsx',
      truthyLabel: 'visible <DeleteModal> overlay',
    });
    await Promise.resolve();

    expect(harness.readConditions()[0]).toMatchObject({
      kind: 'overlay-visibility',
      role: 'overlay',
    });
  });

  /** Applies ephemeral target-guided gates while preserving explicit user precedence. */
  it('lets manual choices override and reset target-guided DFS branches', () => {
    const harness = createConditionRuntimeHarness({}, vi.fn());
    const metadata = {
      expression: '<Application> gate: !session',
      fallbackBranch: 'truthy',
      falsyLabel: 'continue <Application>',
      kind: 'early-return',
      ownerName: 'Application',
      sourcePath: '/workspace/Application.tsx',
      targetBranch: 'falsy',
      truthyLabel: '<LoginPage>',
    };

    harness.session.activeTargetReachabilityKey = 'candidate:Target';
    expect(harness.resolveCondition('login-gate', true, metadata)).toBe(true);
    expect(harness.setAutoCondition('login-gate', false)).toBe(true);
    expect(harness.resolveCondition('login-gate', true, metadata)).toBe(false);
    expect(harness.readConditions()[0]).toMatchObject({
      autoOverride: false,
      effectiveEnabled: false,
      reachabilityKey: 'candidate:Target',
      targetBranch: 'falsy',
    });
    harness.setCondition('login-gate', true);
    expect(harness.resolveCondition('login-gate', false, metadata)).toBe(true);
    expect(harness.readConditions()[0]).toMatchObject({ autoOverride: undefined, override: true });
    harness.resetCondition('login-gate');
    expect(harness.resolveCondition('login-gate', false, metadata)).toBe(false);
    expect(harness.readConditions()[0]).toMatchObject({
      autoOverride: undefined,
      override: undefined,
    });
  });

  /** Reverts only the automatic gate that causally introduced a fatal page-render failure. */
  it('rolls back and rejects a failed target-guided condition without touching user state', () => {
    const harness = createConditionRuntimeHarness({}, vi.fn());
    const metadata = {
      expression: '<DocumentPreviewModal>.open: open',
      kind: 'overlay-visibility',
      ownerName: 'Modal',
      role: 'overlay',
      sourcePath: '/workspace/document-preview-modal.tsx',
    };
    harness.session.activeTargetReachabilityKey = 'candidate:SelectedField';
    harness.session.targetReachabilityByKey = new Map([
      [
        'candidate:SelectedField',
        {
          appliedConditions: [{ expression: metadata.expression, id: 'unrelated-modal' }],
          status: 'advancing',
        },
      ],
    ]);
    expect(harness.resolveCondition('unrelated-modal', false, metadata)).toBe(false);
    expect(harness.setAutoCondition('unrelated-modal', true)).toBe(true);
    expect(harness.resolveCondition('unrelated-modal', false, metadata)).toBe(true);

    expect(harness.rollbackAutoDecision('condition-trace-1')).toBe(true);
    expect(harness.resolveCondition('unrelated-modal', false, metadata)).toBe(false);
    expect(harness.isAutoConditionRejected('unrelated-modal', 'candidate:SelectedField')).toBe(
      true,
    );
    expect(harness.readConditions()[0]).toMatchObject({
      autoOverride: undefined,
      effectiveEnabled: false,
      override: undefined,
    });
    expect(
      (harness.session.targetReachabilityByKey as Map<string, Record<string, unknown>>).get(
        'candidate:SelectedField',
      ),
    ).toMatchObject({
      appliedConditions: [],
      rejectedConditions: [
        { id: 'unrelated-modal', reason: 'runtime-error', traceId: 'condition-trace-1' },
      ],
      status: 'recovering-after-rejected-gate',
    });
  });

  /** Bypasses one proven direct-target guard before expensive reverse page discovery completes. */
  it('automatically chooses a cold direct target early-return continuation', () => {
    const harness = createConditionRuntimeHarness({}, vi.fn(), {
      descriptors: [{ exportName: 'default' }],
      selectedExportName: 'default',
    });
    const metadata = {
      expression: '<GuardedPage> gate: !isStaffMode',
      fallbackBranch: 'truthy',
      falsyLabel: 'continue <GuardedPage>',
      kind: 'early-return',
      ownerName: 'GuardedPage',
      sourcePath: '/workspace/GuardedPage.tsx',
      targetBranch: 'falsy',
      truthyLabel: '<Navigate>',
    };

    harness.rememberDirectOwner('default', 'GuardedPage');
    expect(harness.resolveCondition('staff-gate', true, metadata)).toBe(false);
    expect(harness.readConditions()[0]).toMatchObject({
      authoredEnabled: true,
      autoOverride: false,
      effectiveEnabled: false,
      targetBranch: 'falsy',
    });
    const retainedConditions = harness.session.directTargetConditionIdsByExport as Map<
      string,
      Set<string>
    >;
    expect([...(retainedConditions.get('default') ?? [])]).toEqual(['staff-gate']);

    const siblingHarness = createConditionRuntimeHarness({}, vi.fn(), {
      descriptors: [{ exportName: 'default' }],
      selectedExportName: 'default',
    });
    siblingHarness.rememberDirectOwner('default', 'GuardedPage');
    expect(
      siblingHarness.resolveCondition('text-gate', true, {
        ...metadata,
        expression: '<TruncatableParagraph> gate: typeof content === "string"',
        ownerName: 'TruncatableParagraph',
      }),
    ).toBe(true);

    // Once a full authored-page traversal owns the decision, the condition keeps authored
    // semantics until that DFS explicitly advances the path-local gate.
    const fullHarness = createConditionRuntimeHarness({}, vi.fn(), {
      activeTargetReachabilityKey: 'candidate:default',
      descriptors: [{ exportName: 'default', inspector: {} }],
      selectedExportName: 'default',
    });
    expect(fullHarness.resolveCondition('staff-gate', true, metadata)).toBe(true);
  });

  /** Opens a directly selected Modal whose authored hidden guard would otherwise return no DOM. */
  it('automatically reveals a cold direct target overlay', () => {
    const harness = createConditionRuntimeHarness({}, vi.fn(), {
      descriptors: [{ exportName: 'CompanyRegisterModal' }],
      selectedExportName: 'CompanyRegisterModal',
    });
    const metadata = {
      expression: '<CompanyRegisterModal> visibility: !open',
      falsyLabel: 'hidden <CompanyRegisterModal> overlay',
      kind: 'overlay-visibility',
      ownerName: 'CompanyRegisterModal',
      role: 'overlay',
      sourcePath: '/workspace/CompanyRegisterModal.tsx',
      truthyLabel: 'visible <CompanyRegisterModal> overlay',
    };

    harness.rememberDirectOwner('CompanyRegisterModal', 'CompanyRegisterModal');
    expect(harness.resolveCondition('modal-visibility', false, metadata)).toBe(true);
    expect(harness.readConditions()[0]).toMatchObject({
      authoredEnabled: false,
      autoOverride: true,
      effectiveEnabled: true,
      role: 'overlay',
    });
  });
});

/** Evaluates the generated lexical runtime against inert persistence and notification adapters. */
function createConditionRuntimeHarness(
  persistedState: Record<string, unknown>,
  persistPreviewInspectorState: () => void,
  initialSession: Record<string, unknown> = {},
): ConditionRuntimeHarness {
  const source = createPreviewInspectorConditionRuntimeSource();
  const context: {
    __conditionRuntime?: ConditionRuntimeHarness;
    persistedState: Record<string, unknown>;
    persistPreviewInspectorState: () => void;
    initialSession: Record<string, unknown>;
  } = { initialSession, persistedState, persistPreviewInspectorState };
  vm.runInNewContext(
    `
      const previewInspectorSession = { ...initialSession };
      const readPersistedPreviewInspectorState = () => persistedState;
      const notifyPreviewInspector = () => undefined;
      const schedulePreviewInspectorCommitRefresh = () => undefined;
      const schedulePreviewInspectorHighlight = () => undefined;
      const schedulePreviewInspectorTreeRefresh = () => undefined;
      let automaticTraceSequence = 0;
      const recordPreviewInspectorBlockerAutoDecision = (candidate) => {
        if (candidate?.startsRenderAttempt !== true) return undefined;
        automaticTraceSequence += 1;
        return 'condition-trace-' + String(automaticTraceSequence);
      };
      ${source}
      globalThis.__conditionRuntime = {
        getRevision: readPreviewInspectorRenderConditionRevision,
        rememberDirectOwner: (exportName, ownerName) => {
          previewInspectorSession.directTargetRuntimeOwnerNamesByExport = new Map([
            [exportName, new Set([ownerName])],
          ]);
        },
        readConditions: readPreviewInspectorRenderConditions,
        readFallbackValuesEnabled: readPreviewInspectorFallbackValuesEnabled,
        isAutoConditionRejected: isPreviewInspectorTargetGuidedConditionRejected,
        resetCondition: resetPreviewInspectorRenderConditionOverride,
        resolveCondition: resolvePreviewInspectorRenderCondition,
        rollbackAutoDecision: rollbackPreviewInspectorFailedAutoDecision,
        session: previewInspectorSession,
        setAutoCondition: setPreviewInspectorTargetGuidedConditionOverride,
        setCondition: setPreviewInspectorRenderConditionOverride,
        setFallbackValuesEnabled: setPreviewInspectorFallbackValuesEnabled,
      };
    `,
    context,
  );
  if (context.__conditionRuntime === undefined) {
    throw new Error('Condition runtime fixture did not initialize.');
  }
  return context.__conditionRuntime;
}
