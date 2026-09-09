/** Exercises Page Inspector branch overrides and automatic-value state without mounting React. */
import { describe, expect, it, vi } from 'vitest';
import { createConditionRuntimeHarness } from './support/previewInspectorConditionRuntimeFixture';

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

  /** Queues a manual branch before short-circuiting allows the authored expression to execute. */
  it('controls a compiler-registered condition before its first runtime evaluation', () => {
    const persist = vi.fn();
    const harness = createConditionRuntimeHarness({}, persist);
    const metadata = {
      authoredExpression: 'rows.length > 0',
      column: 8,
      expression: 'rows.length > 0',
      expressionFingerprint: 'b'.repeat(64),
      falsyLabel: 'hidden <Rows>',
      kind: 'logical-and',
      line: 42,
      sourcePath: '/workspace/MappingCard.tsx',
      truthyLabel: '<Rows>',
    };

    expect(
      harness.registerDefinitions('/workspace/MappingCard.tsx', [{ id: 'rows-visible', metadata }]),
    ).toBe(true);
    expect(harness.readConditions()).toEqual([]);
    expect(harness.readControllableConditions()[0]).toMatchObject({
      effectiveEnabled: false,
      id: 'rows-visible',
      reached: false,
    });

    harness.setCondition('rows-visible', true);
    expect(harness.readControllableConditions()[0]).toMatchObject({
      effectiveEnabled: true,
      override: true,
      reached: false,
    });
    expect(harness.resolveCondition('rows-visible', false, metadata)).toBe(true);
    expect(harness.readControllableConditions()[0]).toMatchObject({
      effectiveEnabled: true,
      override: true,
      reached: true,
    });
    expect(harness.getRevision()).toBe(1);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  /** A hot source batch removes definitions that disappeared without touching another module. */
  it('replaces one source definition batch and drops stale scenario controls', () => {
    const harness = createConditionRuntimeHarness({}, vi.fn());
    const createCandidate = (id: string, line: number): Record<string, unknown> => ({
      id,
      metadata: {
        authoredExpression: id,
        expression: id,
        kind: 'logical-and',
        line,
        sourcePath: '/workspace/MappingCard.tsx',
      },
    });

    expect(
      harness.registerDefinitions('/workspace/MappingCard.tsx', [
        createCandidate('first', 10),
        createCandidate('removed', 20),
      ]),
    ).toBe(true);
    expect(harness.readControllableConditions().map((condition) => condition.id)).toEqual([
      'first',
      'removed',
    ]);

    expect(
      harness.registerDefinitions('/workspace/MappingCard.tsx', [createCandidate('first', 10)]),
    ).toBe(true);
    expect(harness.readControllableConditions().map((condition) => condition.id)).toEqual([
      'first',
    ]);
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

  /** Reuses static-member values observed by the authored case evaluation on the next render. */
  it('selects an observed static-member switch branch without eager project evaluation', () => {
    const harness = createConditionRuntimeHarness({}, vi.fn(), { fallbackValuesEnabled: true });
    const reachabilityKey = 'candidate:CeoAddressChangeField';
    harness.session.activeTargetReachabilityKey = reachabilityKey;
    harness.session.targetReachabilityByKey = new Map([
      [
        reachabilityKey,
        {
          applicationPath: ['MeetingFormSteps', 'AgendaField', 'CeoAddressChangeField'],
          directTarget: false,
          targetExportName: 'CeoAddressChangeField',
        },
      ],
    ]);
    const metadata = {
      branches: [
        {
          calls: ['SummaryPanel'],
          id: 'summary',
          label: 'case AGENDA.SUMMARY',
          observedValueKey: 'summary-key',
          selectable: true,
        },
        {
          calls: ['CeoAddressChangeField'],
          id: 'ceo',
          label: 'case AgendaCeoAddressChange.type',
          observedValueKey: 'ceo-key',
          selectable: true,
        },
      ],
      expression: 'agenda',
      kind: 'switch',
      sourcePath: '/workspace/AgendaField.tsx',
    };

    expect(harness.resolveChoice('agenda-choice', 'authored', metadata)).toBe('authored');
    expect(harness.setChoice('agenda-choice', 'ceo')).toBe(false);
    expect(
      harness.observeChoice('agenda-choice', 'summary', 'summary-key', 'financialStatements'),
    ).toBe('financialStatements');
    expect(harness.observeChoice('agenda-choice', 'ceo', 'ceo-key', 'ceoAddressChange')).toBe(
      'ceoAddressChange',
    );

    expect(harness.resolveChoice('agenda-choice', 'financialStatements', metadata)).toBe(
      'ceoAddressChange',
    );
    expect(harness.readChoices()[0]).toMatchObject({ targetGuidedBranchId: 'ceo' });
    expect(harness.setChoice('agenda-choice', 'ceo')).toBe(true);
    expect(harness.resolveChoice('agenda-choice', 'financialStatements', metadata)).toBe(
      'ceoAddressChange',
    );
    expect(harness.readChoices()[0]).toMatchObject({
      authoredBranchId: 'summary',
      effectiveBranchId: 'ceo',
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

  /** The verified checkpoint owns automatic gates until its rendered output is re-observed. */
  it('does not let target-guided DFS overwrite an active neural success restoration', () => {
    const harness = createConditionRuntimeHarness({}, vi.fn(), {
      neuralSuccessfulPathRestorationActive: true,
    });
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
    expect(harness.setAutoCondition('login-gate', false)).toBe(false);
    expect(harness.resolveCondition('login-gate', true, metadata)).toBe(true);
    expect(harness.readConditions()[0]).toMatchObject({
      autoOverride: undefined,
      effectiveEnabled: true,
    });
  });

  /** Lets a valid finite prop drive its authored branches after stale DFS overrides are removed. */
  it('reconciles automatic conditions with a source-proven prop choice', () => {
    const harness = createConditionRuntimeHarness({}, vi.fn(), {
      selectedExportName: 'TaxTypeBadge',
    });
    const metadata = {
      expression: '<TaxTypeBadge> gate: taxType === "heavy_tax"',
      fallbackBranch: 'truthy',
      falsyLabel: 'continue <TaxTypeBadge>',
      kind: 'early-return',
      ownerName: 'TaxTypeBadge',
      scalarExpression: {
        kind: 'comparison',
        operator: '===',
        path: 'taxType',
        value: 'heavy_tax',
      },
      sourcePath: '/workspace/tax-type-badge.tsx',
      targetBranch: 'falsy',
      truthyLabel: '<Badge>',
    };

    expect(harness.resolveCondition('heavy-tax', true, metadata)).toBe(true);
    expect(harness.setAutoCondition('heavy-tax', false)).toBe(true);
    expect(harness.resolveCondition('heavy-tax', true, metadata)).toBe(false);

    expect(
      harness.registerSourceProvenPropChoice('TaxTypeBadge', 'taxType', 'heavy_tax', {
        ownerName: 'TaxTypeBadge',
        sourcePath: '/workspace/tax-type-badge.tsx',
      }),
    ).toBe(true);
    expect(harness.resolveCondition('heavy-tax', true, metadata)).toBe(true);
    expect(harness.readConditions()[0]).toMatchObject({
      autoOverride: undefined,
      effectiveEnabled: true,
      override: undefined,
    });
    expect(harness.setAutoCondition('heavy-tax', false)).toBe(false);

    // A deliberate user branch decision remains authoritative over the selected prop.
    harness.setCondition('heavy-tax', false);
    expect(harness.resolveCondition('heavy-tax', true, metadata)).toBe(false);
    expect(harness.readConditions()[0]).toMatchObject({ override: false });
  });

  /** Never substitutes a Boolean for state that the continuation passes into a child component. */
  it('keeps an authored-state gate read-only for automatic and manual branch controls', () => {
    const harness = createConditionRuntimeHarness({}, vi.fn());
    const metadata = {
      expression: '<SignupPage> gate: !target',
      fallbackBranch: 'truthy',
      falsyLabel: 'continue <SignupPage>',
      kind: 'early-return',
      ownerName: 'SignupPage',
      requiresAuthoredState: true,
      sourcePath: '/workspace/SignupPage.tsx',
      targetBranch: 'falsy',
      truthyLabel: '<SelectionStep>',
    };

    harness.session.activeTargetReachabilityKey = 'signup-page:SignupForm';
    expect(harness.resolveCondition('signup-target-gate', true, metadata)).toBe(true);
    expect(harness.setAutoCondition('signup-target-gate', false)).toBe(false);
    harness.setCondition('signup-target-gate', false);
    expect(harness.resolveCondition('signup-target-gate', true, metadata)).toBe(true);
    expect(harness.readConditions()[0]).toMatchObject({
      autoOverride: undefined,
      effectiveEnabled: true,
      override: undefined,
      requiresAuthoredState: true,
    });
  });

  /**
   * Opens only the compiler-selected layout's continuation branch before asynchronous DFS begins.
   * This preserves the authored shell around a VirtualPage body without weakening unrelated page
   * guards or taking precedence over a user's explicit branch choice.
   */
  it('continues through an exact VirtualPage shell early-return guard immediately', () => {
    const harness = createConditionRuntimeHarness({}, vi.fn(), {
      descriptors: [{ inspector: {} }],
      fallbackValuesEnabled: true,
      selectedPageCandidate: {
        virtualPage: {
          shells: [
            {
              root: {
                exportName: 'ApplicationLayout',
                sourcePath: '/workspace/ApplicationLayout.tsx',
              },
            },
          ],
        },
      },
    });
    const shellMetadata = {
      expression: '<ApplicationLayout> gate: !session',
      kind: 'early-return',
      ownerName: 'ApplicationLayout',
      sourcePath: '/workspace/ApplicationLayout.tsx',
      targetBranch: 'falsy',
    };

    expect(harness.resolveCondition('shell-session', true, shellMetadata)).toBe(false);
    expect(harness.readConditions()[0]).toMatchObject({
      authoredEnabled: true,
      autoOverride: false,
      effectiveEnabled: false,
    });
    expect(
      harness.resolveCondition('page-session', true, {
        ...shellMetadata,
        sourcePath: '/workspace/FeaturePage.tsx',
      }),
    ).toBe(true);

    harness.setCondition('shell-session', true);
    expect(harness.resolveCondition('shell-session', false, shellMetadata)).toBe(true);
  });

  /** Extends deterministic guard continuation through every compiler-reached JSX descendant. */
  it('continues registered transitive VirtualPage component guards without a hop limit', () => {
    const sourcePath = '/workspace/deep/Layer18.tsx';
    const harness = createConditionRuntimeHarness({}, vi.fn(), {
      descriptors: [{ inspector: {} }],
      fallbackValuesEnabled: true,
      selectedPageCandidate: {
        id: 'candidate-a',
        virtualPage: { shells: [] },
      },
    });
    const metadata = {
      expression: 'if (!payload) return null',
      kind: 'early-return',
      sourcePath,
      targetBranch: 'falsy',
    };

    expect(harness.registerVirtualPageSource(sourcePath)).toBe(true);
    expect(harness.registerVirtualPageSource(sourcePath)).toBe(false);
    expect(harness.resolveCondition('deep-payload-gate', true, metadata)).toBe(false);

    harness.session.selectedPageCandidate = {
      id: 'candidate-b',
      virtualPage: { shells: [] },
    };
    expect(harness.resolveCondition('other-candidate-gate', true, metadata)).toBe(true);
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

  /**
   * Continues an exact authored-page Navigate guard on its first evaluation, before its component
   * can commit a redirect that removes the selected panel from the current router location.
   */
  it('synchronously preserves the selected page corridor across a proven Navigate return', () => {
    const key = 'candidate:InvestmentContractUploadPanel';
    const harness = createConditionRuntimeHarness({}, vi.fn(), {
      activeTargetReachabilityKey: key,
      descriptors: [{ exportName: 'InvestmentContractUploadPanel', inspector: {} }],
      fallbackValuesEnabled: true,
      selectedExportName: 'InvestmentContractUploadPanel',
      selectedPageCandidate: { id: 'authored-page' },
    });
    const state = {
      appliedConditions: [],
      directTarget: false,
      key,
      synchronousEvidencePaths: ['/workspace/src/GuardedPage.tsx'],
      targetExportName: 'InvestmentContractUploadPanel',
    };
    harness.session.targetReachabilityByKey = new Map([[key, state]]);
    const metadata = {
      expression: '<GuardedPage> gate: !isStaffMode',
      fallbackBranch: 'truthy',
      falsyLabel: 'continue <GuardedPage>',
      kind: 'early-return',
      ownerName: 'GuardedPage',
      role: 'navigation',
      sourcePath: '/workspace/src/GuardedPage.tsx',
      targetBranch: 'falsy',
      truthyLabel: '<Navigate>',
    };
    let routerPath = '/investment-contracts';

    const condition = harness.resolveCondition('staff-gate', true, metadata);
    if (condition) routerPath = '/login';

    expect(condition).toBe(false);
    expect(routerPath).toBe('/investment-contracts');
    expect(harness.readConditions()[0]).toMatchObject({
      autoOverride: false,
      effectiveEnabled: false,
      reachabilityKey: key,
      role: 'navigation',
    });
    expect(state.appliedConditions).toEqual([
      expect.objectContaining({ enabled: false, id: 'staff-gate', synchronous: true }),
    ]);

    expect(
      harness.resolveCondition('unrelated-gate', true, {
        ...metadata,
        sourcePath: '/workspace/src/UnrelatedHeader.tsx',
      }),
    ).toBe(true);
  });

  /**
   * Preserves a lazy route whose public facade and implementation are different source files.
   * The exact compiler facade must be rendering; an owner-name match by itself is insufficient.
   */
  it('synchronously continues a lazy facade implementation navigation guard', () => {
    const key = 'candidate:HrmTrialSignupCompletePage';
    const facadeSourcePath = '/workspace/src/pages/hrm-trial-signup-complete-page/index.ts';
    const harness = createConditionRuntimeHarness({}, vi.fn(), {
      activeTargetReachabilityKey: key,
      descriptors: [{ exportName: 'HrmTrialSignupCompletePage', inspector: {} }],
      fallbackValuesEnabled: true,
      selectedExportName: 'HrmTrialSignupCompletePage',
      selectedPageCandidate: { id: 'authored-page' },
    });
    const state = {
      appliedConditions: [],
      directTarget: false,
      key,
      synchronousEvidencePaths: [facadeSourcePath],
      targetExportName: 'HrmTrialSignupCompletePage',
      targetSourcePath: facadeSourcePath,
    };
    harness.session.targetReachabilityByKey = new Map([[key, state]]);
    harness.session.targetOwnershipPhasesByIdentity = new Map([
      [
        facadeSourcePath + '\0HrmTrialSignupCompletePage',
        {
          phases: new Set([
            'compiler-export-evidence',
            'facade-resolution',
            'facade-evaluation',
            'wrapper-render',
          ]),
        },
      ],
    ]);
    const metadata = {
      expression: '<HrmTrialSignupCompletePage> gate: companies.length > 0',
      fallbackBranch: 'truthy',
      falsyLabel: 'continue <HrmTrialSignupCompletePage>',
      kind: 'early-return',
      ownerName: 'HrmTrialSignupCompletePage',
      role: 'navigation',
      sourcePath:
        '/workspace/src/pages/hrm-trial-signup-complete-page/hrm-trial-signup-complete-page.tsx',
      targetBranch: 'falsy',
      truthyLabel: '<Navigate>',
    };

    expect(harness.resolveCondition('companies-gate', true, metadata)).toBe(false);
    expect(state.appliedConditions).toEqual([
      expect.objectContaining({ enabled: false, id: 'companies-gate', synchronous: true }),
    ]);
    expect(
      harness.resolveCondition('same-source-sibling', true, {
        ...metadata,
        ownerName: 'SiblingPanel',
      }),
    ).toBe(true);

    const unprovenHarness = createConditionRuntimeHarness({}, vi.fn(), {
      activeTargetReachabilityKey: key,
      descriptors: [{ exportName: 'HrmTrialSignupCompletePage', inspector: {} }],
      fallbackValuesEnabled: true,
      selectedExportName: 'HrmTrialSignupCompletePage',
      selectedPageCandidate: { id: 'authored-page' },
    });
    unprovenHarness.session.targetReachabilityByKey = new Map([[key, { ...state }]]);
    expect(unprovenHarness.resolveCondition('unproven-facade', true, metadata)).toBe(true);
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
