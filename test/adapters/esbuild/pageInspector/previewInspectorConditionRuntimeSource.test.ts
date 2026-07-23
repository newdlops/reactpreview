/** Exercises Page Inspector branch overrides and automatic-value state without mounting React. */
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { createPreviewInspectorConditionRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorConditionRuntimeSource';

interface ConditionRuntimeHarness {
  readonly getRevision: () => number;
  readonly rememberDirectOwner: (exportName: string, ownerName: string) => void;
  readonly readChoices: () => readonly Record<string, unknown>[];
  readonly readConditions: () => readonly Record<string, unknown>[];
  readonly readConsoleEntries: () => readonly Record<string, unknown>[];
  readonly readFallbackValuesEnabled: () => boolean;
  readonly isAutoConditionRejected: (conditionId: string, reachabilityKey: string) => boolean;
  readonly resetCondition: (conditionId: string) => void;
  readonly resetChoice: (choiceId: string) => boolean;
  readonly resolveChoice: (
    choiceId: string,
    authoredValue: unknown,
    metadata: Record<string, unknown>,
  ) => unknown;
  readonly resolveCondition: (
    conditionId: string,
    authoredValue: unknown,
    metadata: Record<string, unknown>,
  ) => unknown;
  readonly resolveConditionLazy: (
    conditionId: string,
    evaluateAuthoredValue: () => unknown,
    metadata: Record<string, unknown>,
  ) => unknown;
  readonly session: Record<string, unknown>;
  readonly setAutoCondition: (conditionId: string, enabled: boolean) => boolean;
  readonly setChoice: (choiceId: string, branchId: string) => boolean;
  readonly setCondition: (conditionId: string, enabled: boolean) => void;
  readonly setFallbackValuesEnabled: (enabled: boolean) => void;
  readonly serializeChoiceOverrides: () => Record<string, string>;
  readonly rollbackAutoDecision: (traceId: string) => boolean;
  readonly rollbackNoProgressAutoDecision: (traceId: string) => boolean;
}

describe('Preview Inspector condition runtime source', () => {
  /** Preserves authored values until an explicit branch override is selected. */
  it('resolves authored, forced false, forced true, and reset states', async () => {
    const persist = vi.fn();
    const harness = createConditionRuntimeHarness({}, persist);
    const truthyValue = { loaded: true };
    const metadata = {
      expression: 'data',
      expressionFingerprint: 'a'.repeat(64),
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
      expressionFingerprint: 'a'.repeat(64),
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

  /** Presents logical JSX guards as switches without coercing their authored JavaScript values. */
  it('preserves object identity and exact falsy values behind logical-and switches', () => {
    const harness = createConditionRuntimeHarness({}, vi.fn());
    const authoredObject = { permission: 'granted' };
    const metadata = {
      expression: 'permission',
      falsyLabel: 'hidden',
      kind: 'logical-and',
      sourcePath: '/workspace/Page.tsx',
      truthyLabel: '<PrivatePanel>',
    };

    expect(harness.resolveCondition('logical-object', authoredObject, metadata)).toBe(
      authoredObject,
    );
    expect(harness.resolveCondition('logical-zero', 0, metadata)).toBe(0);

    harness.setCondition('logical-object', false);
    expect(harness.resolveCondition('logical-object', authoredObject, metadata)).toBe(false);

    harness.setCondition('logical-zero', true);
    expect(harness.resolveCondition('logical-zero', 0, metadata)).toBe(true);
    harness.resetCondition('logical-zero');
    expect(harness.resolveCondition('logical-zero', 0, metadata)).toBe(0);
  });

  /** Converts newly exposed dependent-property failures into another controllable render gate. */
  it('lazily catches dependent guard errors while preserving authored values and short circuiting', () => {
    const harness = createConditionRuntimeHarness({}, vi.fn());
    const metadata = {
      authoredExpression: 'session',
      column: 10,
      expression: 'session',
      falsyLabel: 'hidden',
      kind: 'logical-and',
      line: 4,
      sourcePath: '/workspace/Page.tsx',
      truthyLabel: '<Panel>',
    };
    const authoredObject = { user: { id: 1 } };

    expect(
      harness.resolveConditionLazy('logical-object-lazy', () => authoredObject, metadata),
    ).toBe(authoredObject);
    expect(harness.resolveConditionLazy('logical-zero-lazy', () => 0, metadata)).toBe(0);

    const session: { user: unknown } | null = null;
    let dependentEvaluations = 0;
    const renderDependentChain = (): unknown =>
      harness.resolveConditionLazy('session-gate', () => session, metadata) &&
      harness.resolveConditionLazy(
        'user-gate',
        () => {
          dependentEvaluations += 1;
          return (session as unknown as { user: unknown }).user;
        },
        { ...metadata, authoredExpression: 'session.user', column: 21, expression: 'session.user' },
      ) &&
      'panel-rendered';

    expect(renderDependentChain()).toBe(null);
    expect(dependentEvaluations).toBe(0);

    harness.setCondition('session-gate', true);
    expect(renderDependentChain()).toBe(false);
    expect(dependentEvaluations).toBe(1);
    expect(harness.readConditions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ authoredEnabled: false, id: 'user-gate' }),
      ]),
    );
    expect(harness.readConsoleEntries()).toEqual([
      expect.objectContaining({
        level: 'warn',
        location: '/workspace/Page.tsx:4:21',
        phase: 'evaluate-render-condition',
        source: 'render-condition',
      }),
    ]);

    harness.setCondition('user-gate', true);
    expect(renderDependentChain()).toBe('panel-rendered');
    expect(dependentEvaluations).toBe(2);
  });

  /** Keeps multi-way choices separate and forces only compiler-proven literal/default branches. */
  it('resolves, persists, and resets safe switch choices without changing authored identity', async () => {
    const persist = vi.fn();
    const harness = createConditionRuntimeHarness({}, persist);
    const metadata = {
      branches: [
        { id: 'case-summary', label: 'case summary', selectable: true, value: 'summary' },
        { id: 'case-detail', label: 'case detail', selectable: true, value: 2 },
        { default: true, id: 'case-default', label: 'default', selectable: true },
      ],
      expression: 'mode',
      kind: 'switch',
      ownerName: 'Dashboard',
      sourcePath: '/workspace/Dashboard.tsx',
    };
    const authoredObject = { mode: 'project-owned' };

    expect(harness.resolveChoice('choice-1', authoredObject, metadata)).toBe(authoredObject);
    await Promise.resolve();
    expect(harness.readChoices()[0]).toMatchObject({
      authoredBranchId: 'case-default',
      effectiveBranchId: 'case-default',
      kind: 'switch',
      override: undefined,
    });

    expect(harness.setChoice('choice-1', 'case-summary')).toBe(true);
    expect(harness.resolveChoice('choice-1', 2, metadata)).toBe('summary');
    expect(harness.readChoices()[0]).toMatchObject({
      authoredBranchId: 'case-detail',
      effectiveBranchId: 'case-summary',
      override: 'case-summary',
    });
    expect(harness.serializeChoiceOverrides()).toEqual({ 'choice-1': 'case-summary' });

    expect(harness.setChoice('choice-1', 'case-default')).toBe(true);
    expect(typeof harness.resolveChoice('choice-1', 'summary', metadata)).toBe('symbol');
    expect(harness.resetChoice('choice-1')).toBe(true);
    expect(harness.resolveChoice('choice-1', 2, metadata)).toBe(2);
    expect(harness.serializeChoiceOverrides()).toEqual({});
    expect(harness.readConditions()).toEqual([]);
    expect(harness.getRevision()).toBe(3);
    expect(persist).toHaveBeenCalledTimes(3);
  });

  /** Rejects dynamic cases/defaults even when external metadata incorrectly marks them selectable. */
  it('retains dynamic switch branches as read-only records', () => {
    const harness = createConditionRuntimeHarness({}, vi.fn());
    const metadata = {
      branches: [
        { id: 'dynamic', label: 'case resolveMode()', selectable: true },
        { id: 'literal', label: 'case ready', selectable: true, value: 'ready' },
        { default: true, id: 'default', label: 'default', selectable: true },
      ],
      expression: 'mode',
      kind: 'switch',
      sourcePath: '/workspace/Page.tsx',
    };

    expect(harness.resolveChoice('choice-dynamic', 'ready', metadata)).toBe('ready');
    expect(harness.setChoice('choice-dynamic', 'dynamic')).toBe(false);
    expect(harness.setChoice('choice-dynamic', 'literal')).toBe(false);
    expect(harness.setChoice('choice-dynamic', 'default')).toBe(false);
    expect(harness.readChoices()[0]).toMatchObject({
      authoredBranchId: undefined,
      effectiveBranchId: undefined,
    });
  });

  /** Restores a persisted switch override through its dedicated non-boolean state map. */
  it('restores bounded persisted render choice overrides', () => {
    const harness = createConditionRuntimeHarness(
      { renderChoiceOverrides: { 'choice-persisted': 'case-b' } },
      vi.fn(),
    );
    const metadata = {
      branches: [
        { id: 'case-a', label: 'case a', selectable: true, value: 'a' },
        { id: 'case-b', label: 'case b', selectable: true, value: 'b' },
      ],
      expression: 'mode',
      kind: 'switch',
      sourcePath: '/workspace/Page.tsx',
    };

    expect(harness.resolveChoice('choice-persisted', 'a', metadata)).toBe('b');
    expect(harness.serializeChoiceOverrides()).toEqual({ 'choice-persisted': 'case-b' });
  });

  /** Selects the sole JSX-array item whose component occurs on the active root-to-file path. */
  it('automatically selects a dynamic JSX array index for the current file corridor', () => {
    const harness = createConditionRuntimeHarness({}, vi.fn(), { fallbackValuesEnabled: true });
    const key = 'candidate:Step2';
    harness.session.activeTargetReachabilityKey = key;
    harness.session.targetReachabilityByKey = new Map([
      [
        key,
        {
          applicationPath: ['Application', 'OnboardingPage', 'Step2 (default)', 'default'],
          directTarget: false,
          targetExportName: 'default',
        },
      ],
    ]);
    const metadata = {
      branches: [
        { calls: ['Step0'], id: 'index-0', label: 'index 0', selectable: true, value: 0 },
        { calls: ['Step1'], id: 'index-1', label: 'index 1', selectable: true, value: 1 },
        { calls: ['Step2'], id: 'index-2', label: 'index 2', selectable: true, value: 2 },
      ],
      expression: 'step',
      kind: 'array-index',
      ownerName: 'OnboardingPage',
      sourcePath: '/workspace/OnboardingPage.tsx',
    };

    expect(harness.resolveChoice('onboarding-step', null, metadata)).toBe(2);
    expect(harness.readChoices()[0]).toMatchObject({
      effectiveBranchId: 'index-2',
      kind: 'array-index',
      targetGuidedBranchId: 'index-2',
    });

    expect(harness.setChoice('onboarding-step', 'index-1')).toBe(true);
    expect(harness.resolveChoice('onboarding-step', null, metadata)).toBe(1);
    expect(harness.serializeChoiceOverrides()).toEqual({ 'onboarding-step': 'index-1' });
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
      expression: '<GuardedPage> gate: !session',
      kind: 'early-return',
      ownerName: 'GuardedPage',
      sourcePath: '/workspace/guarded-page.tsx',
      targetBranch: 'falsy',
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

  /** Marks an inert committed branch separately so bounded DFS can select another candidate gate. */
  it('session-rejects a target-guided condition that committed without target progress', () => {
    const harness = createConditionRuntimeHarness({}, vi.fn());
    const metadata = {
      expression: '<GuardedPage> gate: !permission',
      kind: 'early-return',
      ownerName: 'GuardedPage',
      sourcePath: '/workspace/guarded-page.tsx',
      targetBranch: 'falsy',
    };
    harness.session.activeTargetReachabilityKey = 'candidate:SelectedPanel';
    harness.session.targetReachabilityByKey = new Map([
      [
        'candidate:SelectedPanel',
        {
          appliedConditions: [{ expression: metadata.expression, id: 'permission-gate' }],
          status: 'advancing',
        },
      ],
    ]);
    harness.resolveCondition('permission-gate', true, metadata);
    expect(harness.setAutoCondition('permission-gate', false)).toBe(true);

    expect(harness.rollbackNoProgressAutoDecision('condition-trace-1')).toBe(true);
    expect(harness.resolveCondition('permission-gate', true, metadata)).toBe(true);
    expect(
      (harness.session.targetReachabilityByKey as Map<string, Record<string, unknown>>).get(
        'candidate:SelectedPanel',
      ),
    ).toMatchObject({
      appliedConditions: [],
      rejectedConditions: [
        {
          id: 'permission-gate',
          reason: 'no-target-progress',
          traceId: 'condition-trace-1',
        },
      ],
      status: 'recovering-after-rejected-gate',
    });
  });

  /** Keeps a revealed modal mounted when its child exposes a new data/runtime failure. */
  it('does not roll back an overlay visibility decision after a descendant error', () => {
    const harness = createConditionRuntimeHarness({}, vi.fn());
    const metadata = {
      expression: '<DocumentPreviewModal>.open: open',
      kind: 'overlay-visibility',
      ownerName: 'DocumentPreviewModal',
      role: 'overlay',
      sourcePath: '/workspace/document-preview-modal.tsx',
    };
    harness.session.activeTargetReachabilityKey = 'candidate:DocumentPreviewModal';

    expect(harness.resolveCondition('modal-open', false, metadata)).toBe(false);
    expect(harness.setAutoCondition('modal-open', true)).toBe(true);
    expect(harness.rollbackAutoDecision('condition-trace-1')).toBe(false);
    expect(harness.resolveCondition('modal-open', false, metadata)).toBe(true);
    expect(harness.isAutoConditionRejected('modal-open', 'candidate:DocumentPreviewModal')).toBe(
      false,
    );
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
      const recordedConsoleEntries = [];
      const recordPreviewInspectorConsoleEntry = (candidate) => {
        recordedConsoleEntries.push(candidate);
        return candidate;
      };
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
        readChoices: readPreviewInspectorRenderChoices,
        readConditions: readPreviewInspectorRenderConditions,
        readConsoleEntries: () => recordedConsoleEntries.slice(),
        readFallbackValuesEnabled: readPreviewInspectorFallbackValuesEnabled,
        isAutoConditionRejected: isPreviewInspectorTargetGuidedConditionRejected,
        resetCondition: resetPreviewInspectorRenderConditionOverride,
        resetChoice: resetPreviewInspectorRenderChoiceOverride,
        resolveChoice: resolvePreviewInspectorRenderChoice,
        resolveCondition: resolvePreviewInspectorRenderCondition,
        resolveConditionLazy: resolvePreviewInspectorRenderConditionLazy,
        rollbackAutoDecision: rollbackPreviewInspectorFailedAutoDecision,
        rollbackNoProgressAutoDecision: rollbackPreviewInspectorNoProgressAutoDecision,
        session: previewInspectorSession,
        setAutoCondition: setPreviewInspectorTargetGuidedConditionOverride,
        setChoice: setPreviewInspectorRenderChoiceOverride,
        setCondition: setPreviewInspectorRenderConditionOverride,
        setFallbackValuesEnabled: setPreviewInspectorFallbackValuesEnabled,
        serializeChoiceOverrides: serializePreviewInspectorRenderChoiceOverrides,
      };
    `,
    context,
  );
  if (context.__conditionRuntime === undefined) {
    throw new Error('Condition runtime fixture did not initialize.');
  }
  return context.__conditionRuntime;
}
