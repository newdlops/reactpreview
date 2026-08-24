/** Exercises the tiny local neural residual without mounting React or project code. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralModelSharingRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralModelSharingRuntimeSource';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';
import { readPreviewInspectorNeuralModel } from '../../../../src/presentation/previewInspectorNeuralModelProtocol';

interface NeuralDecision {
  readonly blockerKind: string;
  readonly candidateId?: string;
  readonly consecutiveFailures: number;
  readonly featureVector: readonly number[];
  readonly headKey: string;
  readonly headEvidence: number;
  readonly headUpdates: number;
  readonly holeKind: string;
  readonly modelUpdates: number;
  readonly outcomeAttempts: number;
  readonly score: number;
  readonly selectionScore: number;
  readonly version: number;
}

interface NeuralDecisionSummary {
  readonly consecutiveFailures: number;
  readonly headEvidence: number;
  readonly headUpdates: number;
  readonly modelUpdates: number;
  readonly outcomeAttempts: number;
  readonly score: number;
  readonly selectionScore: number;
}

interface NeuralModelFixture {
  readonly assessAttempt: (
    attempt: unknown,
    result: unknown,
    deadlineReached?: boolean,
  ) =>
    | {
        readonly confidence?: number;
        readonly label?: number;
        readonly pending: boolean;
        readonly reason: string;
      }
    | undefined;
  readonly createDecision: (specification: unknown) => NeuralDecision;
  readonly compare: (left: NeuralDecision, right: NeuralDecision) => number;
  readonly handleHostMessage: (message: unknown) => boolean;
  readonly messages: readonly unknown[];
  readonly notified: () => number;
  readonly observeAttempt: (attempt: unknown, result: unknown) => unknown;
  readonly serialize: () => {
    readonly candidateOutcomes: Readonly<
      Record<
        string,
        {
          readonly attempts: number;
          readonly consecutiveFailures: number;
          readonly evidence: number;
          readonly lastConfidence: number;
          readonly lastLabel: number;
          readonly rewardSum: number;
          readonly sequence: number;
        }
      >
    >;
    readonly heads: Readonly<
      Record<
        string,
        {
          readonly evidence: number;
          readonly outputBias: number;
          readonly outputWeights: readonly number[];
          readonly updates: number;
        }
      >
    >;
    readonly outcomeSequence: number;
    readonly updates: number;
    readonly version: number;
  };
  readonly selectCandidate: (
    specification: unknown,
    candidates: readonly unknown[],
  ) =>
    | {
        readonly branchRetained: boolean;
        readonly candidateId: string;
        readonly decision: NeuralDecision;
        readonly selectionPolicy: string;
      }
    | undefined;
  readonly setExploration: (policy?: {
    readonly excludedCandidateIds?: readonly string[];
    readonly mode: string;
    readonly ordinal: number;
  }) => void;
  readonly session: {
    activeTargetReachabilityKey?: string;
    minimumRequirementSearchByKey: Map<string, unknown>;
    neuralAssistanceExplorationPolicy?: unknown;
    neuralResidualModel?: unknown;
    targetReachabilityByKey: Map<string, unknown>;
  };
  readonly summarize: (decision: NeuralDecision) => NeuralDecisionSummary | undefined;
  readonly train: (decision: NeuralDecision, label: number, confidence?: number) => unknown;
}

/** Evaluates the generated model with only its local session and persistence capability. */
function createNeuralModelFixture(): NeuralModelFixture & { readonly persisted: () => number } {
  const context = vm.createContext({});
  vm.runInContext(
    `
      let persistenceCount = 0;
      let notificationCount = 0;
      const messages = [];
      const previewEntryRevision = 9;
      const previewInspectorPostHostMessage = (message) => {
        messages.push(message);
        return Promise.resolve(true);
      };
      const previewInspectorSession = {
        minimumRequirementSearchByKey: new Map(),
        targetReachabilityByKey: new Map(),
      };
      const persistPreviewInspectorState = () => { persistenceCount += 1; };
      const notifyPreviewInspector = () => { notificationCount += 1; };
      ${createPreviewInspectorNeuralResidualRuntimeSource()}
      ${createPreviewInspectorNeuralModelSharingRuntimeSource()}
      globalThis.__fixture = {
        assessAttempt: assessPreviewInspectorNeuralResidualAttempt,
        compare: comparePreviewInspectorNeuralResidualDecisions,
        createDecision: createPreviewInspectorNeuralResidualDecision,
        handleHostMessage: handlePreviewInspectorNeuralResidualHostMessage,
        messages,
        notified: () => notificationCount,
        observeAttempt: observePreviewInspectorNeuralResidualAttempt,
        persisted: () => persistenceCount,
        selectCandidate: selectPreviewInspectorNeuralResidualCandidate,
        serialize: serializePreviewInspectorNeuralResidualModel,
        session: previewInspectorSession,
        setExploration: (policy) => {
          const key = 'page:target';
          previewInspectorSession.minimumRequirementSearchByKey.delete(key);
          previewInspectorSession.activeTargetReachabilityKey = undefined;
          if (policy === undefined) return;
          previewInspectorSession.activeTargetReachabilityKey = key;
          previewInspectorSession.minimumRequirementSearchByKey.set(key, {
            excludedCandidateIds: [...(policy.excludedCandidateIds ?? [])],
            explorationMode: policy.mode,
            explorationOrdinal: policy.ordinal,
            origin: 'automatic-neural',
          });
        },
        summarize: summarizePreviewInspectorNeuralResidualDecision,
        train: trainPreviewInspectorNeuralResidualDecision,
      };
    `,
    context,
  );
  return (context as { __fixture: NeuralModelFixture & { readonly persisted: () => number } })
    .__fixture;
}

/** Creates one condition-hole feature record without retaining authored project objects. */
function conditionSpecification(owner: string): Record<string, unknown> {
  return {
    blockerKind: 'render-condition',
    holeKind: 'condition-activation-order',
    numbers: { exactTarget: owner === 'UsefulGate' ? 1 : 0 },
    texts: [owner + ' && ready', owner, '/workspace/page.tsx'],
    tokens: ['desired:true', 'role:continuation', 'owner:' + owner],
  };
}

describe('Preview Inspector neural residual runtime source', () => {
  /** Starts as an exact tie so adding the model cannot perturb the deterministic resolver order. */
  it('is neutral before verified local learning', () => {
    const fixture = createNeuralModelFixture();
    const useful = fixture.createDecision(conditionSpecification('UsefulGate'));
    const unrelated = fixture.createDecision(conditionSpecification('UnrelatedGate'));

    expect(useful.score).toBe(0.5);
    expect(unrelated.score).toBe(0.5);
    expect(useful.featureVector).toHaveLength(64);
    expect(fixture.serialize()).toEqual({
      candidateOutcomes: {},
      heads: {},
      outcomeSequence: 0,
      updates: 0,
      version: 4,
    });
  });

  /** Fails closed when a stale webview or malformed persisted value corrupts the tiny head. */
  it('resets non-finite hot-retained weights to the neutral model', () => {
    const fixture = createNeuralModelFixture();
    fixture.session.neuralResidualModel = {
      heads: {
        condition: {
          outputBias: Number.NaN,
          outputWeights: Array(16).fill(Number.POSITIVE_INFINITY),
          updates: 99,
        },
      },
      updates: 99,
      version: 3,
    };

    const decision = fixture.createDecision(conditionSpecification('UsefulGate'));

    expect(decision.score).toBe(0.5);
    expect(fixture.serialize().updates).toBe(0);
  });

  /** Adds result memory to the prior schema without discarding already learned family weights. */
  it('upgrades existing version-three heads without resetting collected learning', () => {
    const fixture = createNeuralModelFixture();
    fixture.session.neuralResidualModel = {
      heads: {
        condition: {
          outputBias: 0.75,
          outputWeights: Array(16).fill(0.1),
          updates: 17,
        },
      },
      updates: 17,
      version: 3,
    };

    const decision = fixture.createDecision(conditionSpecification('UsefulGate'));
    const persisted = fixture.serialize();

    expect(decision.score).toBeGreaterThan(0.5);
    expect(persisted.heads.condition?.updates).toBe(17);
    expect(persisted.heads.condition?.evidence).toBeCloseTo(11.05);
    expect(persisted.updates).toBe(17);
    expect(persisted.candidateOutcomes).toEqual({});
    expect(persisted.outcomeSequence).toBe(0);
  });

  /** Browser and host must produce the same one-time refinement before sharing model snapshots. */
  it('matches host refinement for legacy page-choice and singleton evidence', () => {
    const fixture = createNeuralModelFixture();
    const legacy = {
      candidateOutcomes: {
        'page-choice:0123abcd': {
          attempts: 1,
          consecutiveFailures: 1,
          lastLabel: 0.05,
          rewardSum: 0.05,
          sequence: 1,
        },
      },
      heads: {
        'page-choice': {
          outputBias: -0.8,
          outputWeights: Array(16).fill(-0.2),
          updates: 1,
        },
      },
      outcomeSequence: 1,
      version: 3,
    };
    fixture.session.neuralResidualModel = legacy;

    const browserModel = JSON.parse(JSON.stringify(fixture.serialize())) as unknown;
    const hostModel = readPreviewInspectorNeuralModel(legacy);

    expect(browserModel).toEqual(hostModel);
    expect(hostModel?.heads['page-choice']).toMatchObject({
      evidence: 0.35,
    });
    expect(hostModel?.heads['page-choice']?.outputBias).toBeCloseTo(-0.32);
  });

  /** Separates exact candidate avoidance from low-confidence cross-candidate generalization. */
  it('downweights one-off provisional labels while retaining their failure memory', () => {
    const fixture = createNeuralModelFixture();
    const decision = fixture.createDecision({
      blockerKind: 'target-reachability',
      candidateId: 'one-off-page-shell',
      holeKind: 'rendered-without-output',
      tokens: ['candidate:one-off-page-shell'],
    });

    fixture.train(decision, 0.05, 0.2);

    const persisted = fixture.serialize();
    const summary = fixture.summarize(decision);
    expect(persisted.heads['rendered-empty']).toMatchObject({
      evidence: 0.2,
      updates: 1,
    });
    expect(Object.values(persisted.candidateOutcomes)[0]).toMatchObject({
      attempts: 1,
      consecutiveFailures: 1,
      evidence: 0.2,
      lastConfidence: 0.2,
    });
    expect(Object.values(persisted.candidateOutcomes)[0]?.rewardSum).toBeCloseTo(0.01);
    expect(summary).toMatchObject({
      consecutiveFailures: 1,
      headEvidence: 0.2,
      outcomeAttempts: 1,
    });
  });

  /** Publishes local learning and accepts another panel's stronger independent family. */
  it('synchronizes bounded learning between live preview panels', () => {
    const fixture = createNeuralModelFixture();
    const local = fixture.createDecision({
      blockerKind: 'render-condition',
      candidateId: 'branch-opening',
      holeKind: 'condition-activation-order',
      tokens: ['candidate:branch-opening'],
    });
    fixture.train(local, 1);

    expect(fixture.messages).toHaveLength(1);
    expect(fixture.messages[0]).toMatchObject({
      model: { updates: 1, version: 4 },
      runtimeRevision: 9,
      type: 'react-preview-neural-model-sync',
    });
    const persistenceBeforeSnapshot = fixture.persisted();

    expect(
      fixture.handleHostMessage({
        model: {
          heads: {
            unrendered: {
              outputBias: -0.5,
              outputWeights: Array(16).fill(-0.1),
              updates: 4,
            },
          },
          updates: 4,
          version: 3,
        },
        runtimeRevision: 9,
        type: 'react-preview-neural-model-snapshot',
      }),
    ).toBe(true);
    expect(fixture.serialize().heads.condition?.updates).toBe(1);
    expect(fixture.serialize().heads.unrendered?.updates).toBe(4);
    expect(fixture.serialize().updates).toBe(5);
    expect(fixture.persisted()).toBe(persistenceBeforeSnapshot + 1);
    expect(fixture.notified()).toBe(0);
  });

  /** Learns opposite verified outcomes while persisting only the thirteen-number output head. */
  it('ranks a repeatedly successful blocker hole above a rolled-back exception', () => {
    const fixture = createNeuralModelFixture();
    const useful = fixture.createDecision(conditionSpecification('UsefulGate'));
    const unrelated = fixture.createDecision(conditionSpecification('UnrelatedGate'));

    for (let index = 0; index < 24; index += 1) {
      fixture.train(useful, 1);
      fixture.train(unrelated, 0);
    }

    const usefulAfterLearning = fixture.createDecision(conditionSpecification('UsefulGate'));
    const unrelatedAfterLearning = fixture.createDecision(conditionSpecification('UnrelatedGate'));
    const persisted = fixture.serialize();

    expect(usefulAfterLearning.score).toBeGreaterThan(unrelatedAfterLearning.score);
    expect(persisted.heads.condition?.outputWeights).toHaveLength(16);
    expect(persisted.heads.condition?.updates).toBe(48);
    expect(persisted.updates).toBe(48);
    expect(Object.keys(persisted).sort()).toEqual([
      'candidateOutcomes',
      'heads',
      'outcomeSequence',
      'updates',
      'version',
    ]);
    expect(fixture.persisted()).toBe(48);
  });

  /** A request must apply weights learned after an earlier candidate decision was retained. */
  it('re-scores retained decisions with the latest persisted head', () => {
    const fixture = createNeuralModelFixture();
    const usefulBeforeLearning = fixture.createDecision(conditionSpecification('UsefulGate'));
    const unrelatedBeforeLearning = fixture.createDecision(conditionSpecification('UnrelatedGate'));

    for (let index = 0; index < 24; index += 1) {
      fixture.train(usefulBeforeLearning, 1);
      fixture.train(unrelatedBeforeLearning, 0);
    }

    expect(usefulBeforeLearning.score).toBe(0.5);
    expect(unrelatedBeforeLearning.score).toBe(0.5);
    expect(fixture.compare(usefulBeforeLearning, unrelatedBeforeLearning)).toBeLessThan(0);
    const usefulSummary = fixture.summarize(usefulBeforeLearning);
    const unrelatedSummary = fixture.summarize(unrelatedBeforeLearning);
    expect(usefulSummary).toMatchObject({
      headUpdates: 48,
      modelUpdates: 48,
    });
    expect(usefulSummary?.score).toBeGreaterThan(unrelatedSummary?.score ?? 1);
    expect(usefulSummary?.score).not.toBe(usefulBeforeLearning.score);
  });

  /** Uses only settled target and blocker evidence; superseded attempts never become labels. */
  it('learns from the existing verifier instead of declaring its own success', () => {
    const fixture = createNeuralModelFixture();
    const decision = fixture.createDecision(conditionSpecification('UsefulGate'));
    const attempt = {
      neuralResidualDecision: decision,
      targetReachabilityKey: 'page:target',
      traceId: 'trace-1',
    };
    fixture.session.targetReachabilityByKey.set('page:target', {
      status: 'probing',
      targetHasOutput: false,
    });

    fixture.observeAttempt(attempt, {
      changedBlockerIds: [],
      discoveredBlockerIds: [],
      outcome: 'superseded',
      resolvedBlockerIds: [],
    });
    expect(fixture.serialize().updates).toBe(0);

    fixture.observeAttempt(attempt, {
      changedBlockerIds: [],
      discoveredBlockerIds: [],
      outcome: 'committed',
      resolvedBlockerIds: [],
    });
    expect(fixture.serialize().updates).toBe(1);

    fixture.session.targetReachabilityByKey.set('page:target', {
      status: 'reached',
      targetHasOutput: true,
    });
    fixture.observeAttempt(attempt, {
      changedBlockerIds: [],
      discoveredBlockerIds: [],
      outcome: 'committed',
      resolvedBlockerIds: [],
    });
    expect(fixture.serialize().updates).toBe(2);
  });

  /** Keeps typed value generation outside the model and preserves the safest neutral candidate. */
  it('ranks caller-admitted automatic values without retaining their payloads', () => {
    const fixture = createNeuralModelFixture();
    const specification = {
      blockerKind: 'runtime-fallback',
      holeKind: 'blocker-exception-runtime-value',
      texts: ["Cannot read properties of undefined (reading 'status')"],
      tokens: ['required:state.status', 'nested-generated-fallback:true'],
    };
    const candidates = [
      {
        deterministicRank: 0,
        id: 'shape-only',
        tokens: ['strategy:shape-only', 'value-kind:object'],
      },
      {
        deterministicRank: 1,
        id: 'branch-opening',
        tokens: ['strategy:branch-opening', 'value-kind:object'],
      },
    ];

    const neutral = fixture.selectCandidate(specification, candidates);
    expect(neutral?.candidateId).toBe('shape-only');
    expect(neutral?.decision.score).toBe(0.5);

    const shapeDecision = fixture.createDecision({
      ...specification,
      candidateId: 'shape-only',
      numbers: { deterministicRank: 0 },
      tokens: [
        ...specification.tokens,
        'strategy:shape-only',
        'value-kind:object',
        'candidate:shape-only',
      ],
    });
    const branchDecision = fixture.createDecision({
      ...specification,
      candidateId: 'branch-opening',
      numbers: { deterministicRank: 1 },
      tokens: [
        ...specification.tokens,
        'strategy:branch-opening',
        'value-kind:object',
        'candidate:branch-opening',
      ],
    });
    for (let index = 0; index < 24; index += 1) {
      fixture.train(shapeDecision, 0);
      fixture.train(branchDecision, 1);
    }

    expect(fixture.selectCandidate(specification, candidates)?.candidateId).toBe('branch-opening');
    expect(Object.keys(fixture.serialize())).not.toContain('candidates');
  });

  /** Makes one verified failure change the next choice while persisting only an opaque key. */
  it('remembers repeated candidate outcomes instead of retrying the same failed direction', () => {
    const fixture = createNeuralModelFixture();
    const specification = {
      blockerKind: 'runtime-fallback',
      holeKind: 'blocker-exception-runtime-value',
      tokens: ['required:state.status'],
    };
    const candidates = [
      { deterministicRank: 0, id: 'shape-only', tokens: ['strategy:shape-only'] },
      { deterministicRank: 1, id: 'branch-opening', tokens: ['strategy:branch-opening'] },
    ];
    const first = fixture.selectCandidate(specification, candidates);
    expect(first?.candidateId).toBe('shape-only');
    if (first === undefined) throw new Error('Expected a neutral candidate.');

    fixture.train(first.decision, 0);
    const second = fixture.selectCandidate(specification, candidates);
    const persisted = fixture.serialize();

    expect(second?.candidateId).toBe('branch-opening');
    expect(fixture.summarize(first.decision)).toMatchObject({
      consecutiveFailures: 1,
      outcomeAttempts: 1,
    });
    expect(Object.keys(persisted.candidateOutcomes)).toHaveLength(1);
    expect(Object.keys(persisted.candidateOutcomes)[0]).toMatch(/^blocker-exception:[a-f0-9]{8}$/u);
    expect(JSON.stringify(persisted)).not.toContain('shape-only');
  });

  /** A branch remains stable across exploration passes and advances only after verified failure. */
  it('leases one candidate until verifier evidence rejects that direction', () => {
    const fixture = createNeuralModelFixture();
    const specification = {
      blockerKind: 'runtime-fallback',
      holeKind: 'blocker-exception-runtime-value',
      tokens: ['required:state.status'],
    };
    const candidates = [
      { deterministicRank: 0, id: 'shape-only', tokens: ['strategy:shape-only'] },
      { deterministicRank: 1, id: 'branch-opening', tokens: ['strategy:branch-opening'] },
      { deterministicRank: 2, id: 'collection-carrier', tokens: ['strategy:collection'] },
    ];

    fixture.setExploration({
      excludedCandidateIds: [],
      mode: 'novel-candidate',
      ordinal: 1,
    });
    const first = fixture.selectCandidate(specification, candidates);
    expect(first).toMatchObject({
      branchRetained: false,
      candidateId: 'shape-only',
      selectionPolicy: 'sticky-until-verified-failure',
    });

    fixture.setExploration({
      excludedCandidateIds: ['a-requirement-id'],
      mode: 'novel-candidate',
      ordinal: 2,
    });
    expect(fixture.selectCandidate(specification, candidates)).toMatchObject({
      branchRetained: true,
      candidateId: 'shape-only',
    });

    if (first === undefined) throw new Error('Expected one leased candidate.');
    fixture.train(first.decision, 0);

    fixture.setExploration({
      excludedCandidateIds: [],
      mode: 'novel-candidate',
      ordinal: 3,
    });
    expect(fixture.selectCandidate(specification, candidates)?.candidateId).toBe('branch-opening');

    fixture.setExploration();
    fixture.session.neuralAssistanceExplorationPolicy = {
      excludedCandidateIds: ['shape-only'],
      mode: 'novel-candidate',
      ordinal: 4,
      origin: 'user-neural',
    };
    expect(fixture.selectCandidate(specification, candidates)?.candidateId).toBe('branch-opening');
  });

  /** Prevents repeated unrendered failures from globally suppressing exception-value candidates. */
  it('isolates learning between blocker-hole families', () => {
    const fixture = createNeuralModelFixture();
    const unrendered = fixture.createDecision({
      blockerKind: 'target-reachability',
      holeKind: 'unrendered-runtime-value',
      tokens: ['candidate:page-shell-hook'],
    });
    for (let index = 0; index < 12; index += 1) fixture.train(unrendered, 0);

    const unrenderedAfter = fixture.createDecision({
      blockerKind: 'target-reachability',
      holeKind: 'unrendered-runtime-value',
      tokens: ['candidate:page-shell-hook'],
    });
    const exceptionAfter = fixture.createDecision({
      blockerKind: 'runtime-fallback',
      holeKind: 'blocker-exception-runtime-value',
      tokens: ['candidate:branch-opening'],
    });
    const pageChoice = fixture.createDecision({
      blockerKind: 'render-condition',
      holeKind: 'page-choice-path',
      tokens: ['choice-step:investor'],
    });
    for (let index = 0; index < 6; index += 1) fixture.train(pageChoice, 1);
    const pageChoiceAfter = fixture.createDecision({
      blockerKind: 'render-condition',
      holeKind: 'page-choice-path',
      tokens: ['choice-step:investor'],
    });

    expect(unrenderedAfter.score).toBeLessThan(0.5);
    expect(exceptionAfter.score).toBe(0.5);
    expect(pageChoiceAfter.headKey).toBe('page-choice');
    expect(pageChoiceAfter.score).toBeGreaterThan(0.5);
    expect(fixture.serialize().heads.unrendered?.updates).toBe(12);
    expect(fixture.serialize().heads['page-choice']?.updates).toBe(6);
    expect(fixture.serialize().heads['blocker-exception']).toBeUndefined();
  });

  /** Gives intermediate blocker removal only small credit while the selected target remains absent. */
  it('aligns labels with final target output instead of one resolved blocker', () => {
    const fixture = createNeuralModelFixture();
    fixture.session.targetReachabilityByKey.set('page:target', {
      status: 'retrying-page-execution',
      targetHasOutput: false,
    });
    const assessment = fixture.assessAttempt(
      {
        blocker: { id: 'target-error:Panel' },
        targetReachabilityKey: 'page:target',
      },
      {
        changedBlockerIds: [],
        discoveredBlockerIds: [],
        outcome: 'committed',
        remainingBlockerIds: ['target-reachability:page:target'],
        resolvedBlockerIds: ['target-error:Panel'],
      },
      true,
    );

    expect(assessment).toMatchObject({
      label: 0,
      pending: false,
      reason: 'target-failed',
    });
  });

  /** Does not reward an empty-state render when a generated predicate discarded every row. */
  it('uses observed collection flow ahead of generic target output as its label', () => {
    const fixture = createNeuralModelFixture();
    fixture.session.targetReachabilityByKey.set('page:target', {
      status: 'reached',
      targetHasOutput: true,
    });

    const dropped = fixture.assessAttempt(
      {
        neuralDataFlowSignal: { calls: 3, truthyReturns: 0 },
        targetReachabilityKey: 'page:target',
      },
      {
        changedBlockerIds: [],
        discoveredBlockerIds: [],
        outcome: 'committed',
        remainingBlockerIds: [],
        resolvedBlockerIds: [],
      },
      true,
    );
    const retained = fixture.assessAttempt(
      {
        neuralDataFlowSignal: { calls: 3, truthyReturns: 3 },
        targetReachabilityKey: 'page:target',
      },
      {
        changedBlockerIds: [],
        discoveredBlockerIds: [],
        outcome: 'committed',
        remainingBlockerIds: [],
        resolvedBlockerIds: [],
      },
      true,
    );

    expect(dropped).toMatchObject({ label: 0, reason: 'generated-data-flow-dropped' });
    expect(retained).toMatchObject({
      label: 1,
      reason: 'generated-data-flow-and-target-output-verified',
    });
  });
});
