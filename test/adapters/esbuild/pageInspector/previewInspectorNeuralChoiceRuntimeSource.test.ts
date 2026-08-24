/** Verifies complete choice enumeration without mounting project React. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralChoiceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralChoiceRuntimeSource';

interface ChoiceRuntime {
  readonly applyAutomatic: (plan: unknown) => {
    readonly action: string;
    readonly changed: boolean;
  };
  readonly apply: (choice: unknown, selected: Record<string, number>) => boolean;
  readonly automaticChoices: () => readonly unknown[];
  readonly automaticPlan: () => unknown;
  readonly observeAutomatic: () => unknown;
  readonly availability: (status?: Record<string, unknown>) => {
    readonly automaticWorkAvailable: boolean;
    readonly userChoices: readonly unknown[];
  };
  readonly calls: {
    readonly conditions: unknown[];
    readonly guidedConditions: unknown[];
    readonly data: unknown[];
    readonly pageControls: string[];
    readonly pageContextFocus: boolean[];
    readonly paths: unknown[];
    readonly runtime: unknown[];
  };
  readonly choices: () => readonly unknown[];
  readonly derivePaths: () => unknown;
  readonly observePaths: () => unknown;
  readonly reveal: (choice: unknown) => boolean;
  readonly setNodes: (nodes: readonly unknown[]) => void;
  readonly setPageControls: (labels: readonly string[]) => void;
  readonly setReachability: (reachability: unknown) => void;
}

/** Evaluates the data-only choice bridge with DOM-like authored page controls. */
function createChoiceRuntime(): ChoiceRuntime {
  const context: { __runtime?: ChoiceRuntime } = {};
  vm.runInNewContext(
    `
      let nodes = [];
      let pageControls = [];
      let reachability;
      const neuralPathScores = new Map();
      const automaticRecord = { attemptsByBlocker: new Map() };
      const calls = { conditions: [], data: [], pageContextFocus: [], pageControls: [], paths: [], runtime: [] };
      calls.guidedConditions = [];
      const previewEntryRevision = 3;
      const previewInspectorSession = {
        automaticNeuralAssistanceByKey: new Map(),
        neuralAssistancePending: false,
      };
      globalThis.innerHeight = 800;
      globalThis.innerWidth = 1200;
      globalThis.getComputedStyle = () => ({
        display: 'block', pointerEvents: 'auto', visibility: 'visible',
      });
      globalThis.document = {
        elementFromPoint: () => null,
        getElementById: () => undefined,
        querySelectorAll: () => pageControls,
      };
      const readPreviewInspectorNeuralAssistanceBlockers = () => ({
        active: nodes,
        count: nodes.length,
      });
      const readPreviewInspectorNeuralAssistanceReachability = () => reachability;
      const recordPreviewInspectorNeuralSuccessfulPath = () => undefined;
      const readPreviewInspectorNeuralAssistanceCandidates = (summary) => summary.active;
      const readPreviewInspectorTargetFailurePropChoices = () => [];
      const readPreviewInspectorTargetFailurePropChoiceDomains = () => [];
      const readPreviewInspectorResolutionKind = (node) =>
        node?.blocker?.forceChoice === true ||
        node?.condition?.requiresAuthoredState === true ||
        node?.blocker?.requiresAuthoredState === true
          ? 'choice'
          : 'automatic';
      const readPreviewInspectorPageCandidates = () => [
        { id: 'page-a', root: { exportName: 'PageA' } },
        { id: 'page-a-local', root: { exportName: 'DetailBottomSheetSkeleton' } },
        { id: 'page-b', root: { exportName: 'PageB' } },
      ];
      const readPreviewInspectorPageContextPossibilities = () => [
        {
          active: true,
          candidateId: 'page-a-local',
          callerNames: ['ExplorePage', 'DetailBottomSheetSkeleton'],
          id: 'wrapper-path:sheet',
          index: 0,
          pathSegments: ['ExplorePage', 'Sheet', 'DetailBottomSheetSkeleton', 'Skeleton'],
          selectable: true,
          state: 'active',
          variantCount: 2,
          wrapperNames: ['Sheet', 'SheetContent'],
        },
        {
          active: false,
          candidateId: 'page-b',
          callerNames: ['Step3'],
          id: 'wrapper-path:step3',
          index: 1,
          pathSegments: ['Step3', 'Skeleton'],
          selectable: true,
          state: 'available',
          variantCount: 1,
          wrapperNames: [],
        },
      ];
      const readSelectedPreviewInspectorPageCandidate = () => ({ id: 'page-a' });
      const findSelectedPreviewInspectorDescriptor = () => ({});
      const formatPreviewInspectorPageCandidate = (candidate) => candidate.root.exportName;
      const focusPreviewInspectorPageChoice = () => calls.pageContextFocus.push(true);
      const createPreviewInspectorTargetReachabilityTreeNode = (blocker) => ({
        blocker,
        blockerKind: 'target-reachability',
        id: 'reachability:' + blocker.key,
      });
      const readPreviewInspectorNeuralLearningModelUpdates = () => 4;
      const setPreviewInspectorNeuralLearningStatus = () => undefined;
      const setPreviewInspectorRenderConditionOverride = (...args) => calls.conditions.push(args);
      const canPreviewInspectorTargetGuideCondition = () => true;
      const setPreviewInspectorTargetGuidedConditionOverride = (...args) =>
        (calls.guidedConditions.push(args), true);
      const resetPreviewInspectorRenderConditionOverride = (...args) => calls.conditions.push(args);
      const selectPreviewInspectorPageCandidate = (...args) => calls.paths.push(args);
      const applyPreviewInspectorPageCandidateChoice = (...args) => (calls.paths.push(args), true);
      const smartFillPreviewInspectorRuntimeFallback = (...args) => calls.runtime.push(args);
      const autoPassPreviewInspectorRuntimeFallback = (...args) => calls.runtime.push(args);
      const smartFillPreviewInspectorDataPayload = (...args) => calls.data.push(args);
      const resetPreviewInspectorDataPayload = (...args) => calls.data.push(args);
      const setPreviewInspectorDataAutoEnabled = (...args) => calls.data.push(args);
      const generatePreviewInspectorLoremPayload = (...args) => calls.data.push(args);
      const schedulePreviewInspectorNeuralAssistanceFrame = () => undefined;
      const createPreviewInspectorNeuralResidualDecision = (specification) => ({
        candidateId: specification.candidateId,
        consecutiveFailures: 0,
        score: neuralPathScores.get(specification.candidateId) ?? 0.5,
      });
      const comparePreviewInspectorNeuralResidualDecisions = (left, right) =>
        right.score - left.score;
      const trainPreviewInspectorNeuralResidualDecision = (decision, label) => {
        neuralPathScores.set(decision.candidateId, label);
        return { label };
      };
      ${createPreviewInspectorNeuralChoiceRuntimeSource()}
      globalThis.__runtime = {
        applyAutomatic: (plan) => {
          if (typeof plan?.attemptIdentity === 'string') {
            automaticRecord.attemptsByBlocker.set(plan.attemptIdentity, 1);
          }
          return applyPreviewInspectorNeuralPageGenerationPlan(plan);
        },
        apply: applyPreviewInspectorNeuralUserChoices,
        automaticChoices: readPreviewInspectorNeuralPageGenerationChoices,
        automaticPlan: () => createPreviewInspectorNeuralPageGenerationPlan(automaticRecord),
        availability: (status) => readPreviewInspectorNeuralChoiceAvailabilityState(
          { active: nodes, count: nodes.length },
          undefined,
          status,
        ),
        calls,
        choices: () => readPreviewInspectorNeuralUserChoices({ explicitOnly: true }),
        derivePaths: () => readPreviewInspectorNeuralDerivedChoicePaths(
          readPreviewInspectorNeuralUserChoices({ explicitOnly: true }),
        ),
        observePaths: () => observePreviewInspectorNeuralChoicePathState(
          readPreviewInspectorNeuralUserChoices({ explicitOnly: true }),
          true,
        ),
        observeAutomatic: () => observePreviewInspectorNeuralChoicePathState(
          readPreviewInspectorNeuralPageGenerationChoices(),
          true,
          'automatic',
        ),
        reveal: (choice) => revealPreviewInspectorNeuralUserChoice(choice),
        setNodes: (next) => { nodes = next; },
        setPageControls: (labels) => {
          const createControl = (label, index, options = {}) => ({
              checked: false,
              click: () => calls.pageControls.push(label),
              closest: () => null,
              contains: () => false,
              focus: () => undefined,
              getAttribute: (name) => name === 'role'
                ? options.role ?? null
                : name === 'class'
                  ? options.className ?? null
                  : null,
              getBoundingClientRect: () => ({
                bottom: 160 + index * 900,
                height: 64,
                left: 80,
                right: 380,
                top: 96 + index * 900,
                width: 300,
              }),
              isConnected: true,
              matches: () => false,
              querySelector: () => ({ textContent: label }),
              scrollIntoView: () => undefined,
              tagName: options.tagName ?? 'DIV',
              textContent: label,
            });
          pageControls = [
            createControl('서비스 의견 보내기', -0.08, {
              className: 'header-feedback',
              tagName: 'BUTTON',
            }),
            ...labels.map((label, index) => createControl(label, index, {
              className: 'signup-choice-card',
              role: 'button',
            })),
          ];
        },
        setReachability: (next) => { reachability = next; },
      };
    `,
    context,
  );
  if (context.__runtime === undefined) throw new Error('Choice runtime did not initialize.');
  return context.__runtime;
}

describe('Preview Inspector neural choice runtime source', () => {
  it('lists the complete authored choice family and activates an off-screen option', () => {
    const runtime = createChoiceRuntime();
    runtime.setNodes([
      {
        blocker: {
          effectiveEnabled: false,
          expression: '!target',
          id: 'signup-gate',
          requiresAuthoredState: true,
        },
        blockerKind: 'render-condition',
        condition: {
          effectiveEnabled: false,
          expression: '!target',
          id: 'signup-gate',
          requiresAuthoredState: true,
        },
        id: 'render-condition:signup-gate',
      },
    ]);
    runtime.setPageControls(['기업 등록', 'VC/AC/신기사 등록', '증권사 등록']);

    const choices = runtime.choices();
    expect(choices).toMatchObject([
      {
        choiceKind: 'render-condition',
        choiceRecords: [
          {
            candidates: [
              { actionKind: 'page-control', label: '기업 등록' },
              { actionKind: 'page-control', label: 'VC/AC/신기사 등록' },
              { actionKind: 'page-control', label: '증권사 등록' },
            ],
            kind: 'page-control',
            path: 'Page options',
          },
        ],
      },
    ]);
    expect(runtime.apply(choices[0], { 'Page options': 1 })).toBe(true);
    expect(runtime.calls.pageControls).toEqual(['VC/AC/신기사 등록']);
  });

  it('derives finite paths across states and closes a repeated page cycle', () => {
    const runtime = createChoiceRuntime();
    runtime.setNodes([
      {
        blocker: {
          effectiveEnabled: false,
          expression: '!target',
          id: 'signup-gate',
          requiresAuthoredState: true,
        },
        blockerKind: 'render-condition',
        condition: {
          effectiveEnabled: false,
          expression: '!target',
          id: 'signup-gate',
          requiresAuthoredState: true,
        },
        id: 'render-condition:signup-gate',
      },
    ]);
    runtime.setPageControls(['기업 등록', 'VC/AC/신기사 등록', '증권사 등록']);

    expect(runtime.derivePaths()).toMatchObject({
      pathCount: 3,
      paths: [{ label: '기업 등록' }, { label: 'VC/AC/신기사 등록' }, { label: '증권사 등록' }],
      recommendedPath: { label: '기업 등록' },
      stateCount: 1,
      truncated: false,
    });

    const firstStateChoices = runtime.choices();
    expect(runtime.apply(firstStateChoices[0], { 'Page options': 1 })).toBe(true);
    runtime.setPageControls(['직접 가입', '초대 코드']);
    runtime.observePaths();

    expect(runtime.derivePaths()).toMatchObject({
      pathCount: 2,
      paths: [
        { label: 'VC/AC/신기사 등록 → 직접 가입' },
        { label: 'VC/AC/신기사 등록 → 초대 코드' },
      ],
      stateCount: 2,
    });

    const secondStateChoices = runtime.choices();
    expect(runtime.apply(secondStateChoices[0], { 'Page options': 0 })).toBe(true);
    runtime.setPageControls(['기업 등록', 'VC/AC/신기사 등록', '증권사 등록']);
    runtime.observePaths();

    expect(runtime.derivePaths()).toMatchObject({
      cycle: { label: 'VC/AC/신기사 등록 → 직접 가입' },
      pathCount: 4,
      paths: [
        { label: '기업 등록' },
        {
          label: 'VC/AC/신기사 등록 → 초대 코드',
          steps: [
            { current: true, label: 'VC/AC/신기사 등록' },
            { current: false, label: '초대 코드' },
          ],
        },
        { label: '증권사 등록' },
        { cyclic: true, label: 'VC/AC/신기사 등록 → 직접 가입' },
      ],
      recommendedPath: { label: '기업 등록' },
      stateCount: 2,
    });
  });

  it('ranks a verified target path first when the same finite state returns', () => {
    const runtime = createChoiceRuntime();
    const routeNode = {
      blocker: { id: 'route', requiresAuthoredState: true },
      blockerKind: 'render-condition',
      condition: { id: 'route', requiresAuthoredState: true },
      id: 'render-condition:route',
    };
    runtime.setNodes([routeNode]);
    runtime.setPageControls(['A 경로', 'B 경로', 'C 경로']);
    const choices = runtime.choices();

    expect(runtime.apply(choices[0], { 'Page options': 1 })).toBe(true);
    runtime.setNodes([]);
    runtime.setPageControls([]);
    runtime.setReachability({ status: 'reached', targetHasOutput: true });
    expect(runtime.observePaths()).toMatchObject({
      awaitingStableTarget: true,
      reachedTarget: false,
    });
    runtime.setReachability({
      neuralStableOutputVerified: true,
      status: 'reached',
      targetHasOutput: true,
    });
    runtime.observePaths();

    runtime.setReachability(undefined);
    runtime.setNodes([routeNode]);
    runtime.setPageControls(['A 경로', 'B 경로', 'C 경로']);
    runtime.observePaths();
    expect(runtime.derivePaths()).toMatchObject({
      completedPaths: [{ label: 'B 경로' }],
      recommendedPath: { label: 'B 경로' },
    });
  });

  it('enumerates every supported blocker choice and leaves independent automatic work active', () => {
    const runtime = createChoiceRuntime();
    runtime.setNodes([
      {
        blocker: { effectiveEnabled: false, forceChoice: true, id: 'branch' },
        blockerKind: 'render-condition',
        condition: {
          effectiveEnabled: false,
          expression: 'mode === "full"',
          falsyLabel: 'compact',
          id: 'branch',
          truthyLabel: 'full',
        },
        id: 'render-condition:branch',
      },
      {
        blocker: { forceChoice: true, hookName: 'useFeed', id: 'hook' },
        blockerKind: 'runtime-fallback',
        id: 'runtime:hook',
      },
      {
        blocker: { forceChoice: true, id: 'request', label: 'Investor feed' },
        blockerKind: 'data-request',
        id: 'data:request',
      },
      {
        blocker: { forceChoice: true, key: 'page-path' },
        blockerKind: 'target-reachability',
      },
      {
        blocker: { id: 'other-hook' },
        blockerKind: 'runtime-fallback',
        id: 'runtime:other-hook',
      },
    ]);

    const choices = runtime.choices();
    expect(choices.map((choice) => (choice as { choiceKind: string }).choiceKind)).toEqual([
      'render-condition',
      'runtime-fallback',
      'data-request',
      'target-reachability',
    ]);
    expect(choices).toMatchObject([
      { choiceRecords: [{ candidates: [{ label: 'Show full' }, { label: 'Show compact' }] }] },
      {
        choiceRecords: [{ candidates: [{ label: 'Smart fill minimum' }, { label: 'Auto pass' }] }],
      },
      {
        choiceRecords: [
          {
            candidates: [
              { label: 'Smart fill minimum' },
              { label: 'Use Auto' },
              { label: 'Generate Lorem' },
            ],
          },
        ],
      },
      {
        choiceRecords: [],
        surface: 'page-context',
        title: 'Choose one of 2 ranked source-proven paths in Page context.',
      },
    ]);
    expect(runtime.reveal(choices[3])).toBe(true);
    expect(runtime.calls.pageContextFocus).toEqual([true]);
    expect(runtime.calls.paths).toEqual([]);
    expect(runtime.derivePaths()).toMatchObject({ pathCount: 12, truncated: false });
    const availability = runtime.availability();
    expect(availability.automaticWorkAvailable).toBe(true);
    expect(availability.userChoices).toEqual(
      expect.arrayContaining([expect.objectContaining({ choiceKind: 'data-request' })]),
    );
  });

  it('applies one model-ranked viewer branch without turning it into a user override', () => {
    const runtime = createChoiceRuntime();
    runtime.setNodes([
      {
        blocker: { effectiveEnabled: false, forceChoice: true, id: 'branch-a' },
        blockerKind: 'render-condition',
        condition: {
          effectiveEnabled: false,
          expression: 'showA',
          id: 'branch-a',
        },
        id: 'render-condition:branch-a',
      },
      {
        blocker: { effectiveEnabled: false, forceChoice: true, id: 'branch-b' },
        blockerKind: 'render-condition',
        condition: {
          effectiveEnabled: false,
          expression: 'showB',
          id: 'branch-b',
        },
        id: 'render-condition:branch-b',
      },
    ]);

    expect(runtime.automaticChoices()).toHaveLength(2);
    const plan = runtime.automaticPlan();
    expect(plan).toMatchObject({
      attemptLimit: 1,
      blockerKind: 'render-condition',
      pageGenerationChoice: true,
    });
    expect(runtime.applyAutomatic(plan)).toMatchObject({ changed: true });
    expect(runtime.calls.guidedConditions).toHaveLength(2);
    expect(runtime.calls.conditions).toEqual([]);
  });

  it('tests every non-baseline Cartesian combination from one retained viewer state', () => {
    const runtime = createChoiceRuntime();
    runtime.setNodes([
      {
        blocker: { effectiveEnabled: false, forceChoice: true, id: 'branch-a' },
        blockerKind: 'render-condition',
        condition: { effectiveEnabled: false, expression: 'showA', id: 'branch-a' },
        id: 'render-condition:branch-a',
      },
      {
        blocker: { effectiveEnabled: false, forceChoice: true, id: 'branch-b' },
        blockerKind: 'render-condition',
        condition: { effectiveEnabled: false, expression: 'showB', id: 'branch-b' },
        id: 'render-condition:branch-b',
      },
    ]);

    const pathIds = [];
    for (let index = 0; index < 3; index += 1) {
      const plan = runtime.automaticPlan() as { pathId?: string };
      pathIds.push(plan.pathId);
      expect(runtime.applyAutomatic(plan)).toMatchObject({
        action: 'neural-page-generation-combination',
        changed: true,
      });
    }

    expect(new Set(pathIds).size).toBe(3);
    expect(runtime.automaticPlan()).toBeUndefined();
    expect(runtime.calls.guidedConditions).toHaveLength(4);
  });

  it('leaves authored-state and explicit user branch choices out of automatic page generation', () => {
    const runtime = createChoiceRuntime();
    runtime.setNodes([
      {
        blocker: { forceChoice: true, id: 'page-control', requiresAuthoredState: true },
        blockerKind: 'render-condition',
        condition: { id: 'page-control', requiresAuthoredState: true },
        id: 'render-condition:page-control',
      },
      {
        blocker: { effectiveEnabled: false, forceChoice: true, id: 'manual-branch' },
        blockerKind: 'render-condition',
        condition: {
          effectiveEnabled: false,
          expression: 'manualBranch',
          id: 'manual-branch',
          override: false,
        },
        id: 'render-condition:manual-branch',
      },
    ]);

    expect(runtime.automaticChoices()).toEqual([]);
    expect(runtime.automaticPlan()).toBeUndefined();
  });

  it('does not toggle an automatic branch back to its already observed baseline', () => {
    const runtime = createChoiceRuntime();
    const createBranch = (effectiveEnabled: boolean): Record<string, unknown> => ({
      blocker: { effectiveEnabled, forceChoice: true, id: 'cycling-branch' },
      blockerKind: 'render-condition',
      condition: {
        effectiveEnabled,
        expression: 'cyclingBranch',
        id: 'cycling-branch',
      },
      id: 'render-condition:cycling-branch',
    });
    runtime.setNodes([createBranch(false)]);

    const truthyPlan = runtime.automaticPlan();
    expect(runtime.applyAutomatic(truthyPlan)).toMatchObject({ changed: true });
    runtime.setNodes([createBranch(true)]);
    runtime.observeAutomatic();

    expect(runtime.automaticPlan()).toBeUndefined();
    expect(runtime.calls.guidedConditions).toHaveLength(1);
  });
});
