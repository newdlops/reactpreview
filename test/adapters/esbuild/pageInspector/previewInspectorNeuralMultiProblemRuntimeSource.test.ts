/** Exercises contradictory problem contexts, family retention, and browser/host model parity. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralModelSharingRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralModelSharingRuntimeSource';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';
import {
  createEmptyPreviewInspectorNeuralModel,
  mergePreviewInspectorNeuralModels,
  readPreviewInspectorNeuralModel,
  type PreviewInspectorNeuralCandidateOutcome,
  type PreviewInspectorNeuralModel,
} from '../../../../src/presentation/previewInspectorNeuralModelProtocol';

interface Decision {
  readonly candidateId?: string;
  readonly consecutiveFailures: number;
  readonly contextKey: string;
  readonly featureVector: readonly number[];
  readonly headKey: string;
  readonly headUpdates: number;
  readonly outcomeAttempts: number;
  readonly score: number;
  readonly selectionScore: number;
}

interface Fixture {
  readonly create: (specification: unknown) => Decision;
  readonly merge: (
    current: PreviewInspectorNeuralModel,
    incoming: PreviewInspectorNeuralModel,
  ) => PreviewInspectorNeuralModel;
  readonly refresh: (decision: Decision) => Decision;
  readonly select: (
    specification: unknown,
    candidates: readonly unknown[],
  ) => { readonly candidateId: string; readonly decision: Decision };
  readonly serialize: () => PreviewInspectorNeuralModel;
  readonly setModel: (model: unknown) => void;
  readonly train: (decision: Decision, label: number, confidence?: number) => unknown;
}

/** Runs the production generated source without React, DOM, timers, or project-owned values. */
function createFixture(): Fixture {
  const context = vm.createContext({});
  vm.runInContext(
    `
      const previewInspectorSession = {};
      ${createPreviewInspectorNeuralResidualRuntimeSource()}
      ${createPreviewInspectorNeuralModelSharingRuntimeSource()}
      globalThis.fixture = {
        create: createPreviewInspectorNeuralResidualDecision,
        merge: mergePreviewInspectorNeuralResidualModels,
        refresh: refreshPreviewInspectorNeuralResidualDecision,
        select: selectPreviewInspectorNeuralResidualCandidate,
        serialize: serializePreviewInspectorNeuralResidualModel,
        setModel: (model) => { previewInspectorSession.neuralResidualModel = model; },
        train: trainPreviewInspectorNeuralResidualDecision,
      };
    `,
    context,
  );
  return (context as { fixture: Fixture }).fixture;
}

const PROBLEMS = [
  ['runtime-fallback', 'blocker-exception-runtime-value', 'blocker-exception'],
  ['render-condition', 'condition-activation-order', 'condition'],
  ['data-request', 'rendered-empty-collection-data', 'data-collection'],
  ['target-reachability', 'authored-local-state-transition', 'local-ui'],
  ['page-context', 'page-choice-context', 'page-choice'],
  ['page-context', 'page-execution-context', 'page-execution'],
  ['target-reachability', 'rendered-without-output-value', 'rendered-empty'],
  ['runtime-fallback', 'render-state-scalar', 'render-state'],
  ['target-reachability', 'unrendered-runtime-value', 'unrendered'],
  ['runtime-global', 'unknown', 'general'],
] as const;

describe('Preview Inspector neural learning across problems', () => {
  it.each(PROBLEMS)(
    'keeps opposite outcomes separate for %s / %s',
    (blockerKind, holeKind, headKey) => {
      const fixture = createFixture();
      const candidates = [
        { id: 'shape-only', deterministicRank: 0 },
        { id: 'branch-opening', deterministicRank: 1 },
      ];
      const firstProblem = { blockerKind, holeKind, tokens: ['required:account.status'] };
      const secondProblem = { blockerKind, holeKind, tokens: ['required:cart.items'] };
      const first = fixture.select(firstProblem, candidates);
      const second = fixture.select(secondProblem, candidates);
      expect(first.candidateId).toBe('shape-only');
      expect(second.candidateId).toBe('shape-only');
      expect(first.decision.headKey).toBe(headKey);

      for (let index = 0; index < 6; index += 1) {
        fixture.train(first.decision, 0);
        fixture.train(second.decision, 1);
      }

      expect(fixture.refresh(first.decision)).toMatchObject({
        consecutiveFailures: 6,
        outcomeAttempts: 6,
      });
      expect(fixture.refresh(second.decision)).toMatchObject({
        consecutiveFailures: 0,
        outcomeAttempts: 6,
      });
      expect(fixture.select(firstProblem, candidates).candidateId).toBe('branch-opening');
      expect(fixture.select(secondProblem, candidates).candidateId).toBe('shape-only');
      expect(Object.keys(fixture.serialize().candidateOutcomes)).toHaveLength(2);

      const restored = createFixture();
      restored.setModel(readPreviewInspectorNeuralModel(fixture.serialize()));
      expect(restored.select(firstProblem, candidates).candidateId).toBe('branch-opening');
      expect(restored.select(secondProblem, candidates).candidateId).toBe('shape-only');
      expect(JSON.stringify(fixture.serialize())).not.toMatch(
        /account|cart|shape-only|featureVector/u,
      );
    },
  );

  it('isolates page execution, local UI transitions, and previously learned general outcomes', () => {
    const fixture = createFixture();
    const general = fixture.create({ holeKind: 'unknown', candidateId: 'fallback' });
    for (let index = 0; index < 12; index += 1) fixture.train(general, 0);
    const execution = fixture.create({ holeKind: 'page-execution-context', candidateId: 'page' });
    const localUi = fixture.create({
      holeKind: 'authored-local-state-transition',
      candidateId: 'open',
    });
    expect(execution).toMatchObject({ headKey: 'page-execution', headUpdates: 0, score: 0.5 });
    expect(localUi).toMatchObject({ headKey: 'local-ui', headUpdates: 0, score: 0.5 });

    for (let index = 0; index < 8; index += 1) {
      fixture.train(execution, 0);
      fixture.train(localUi, 1);
    }

    expect(fixture.refresh(execution).score).toBeLessThan(0.5);
    expect(fixture.refresh(localUi).score).toBeGreaterThan(0.5);
    expect(fixture.refresh(general).headUpdates).toBe(12);
    const persisted = fixture.serialize();
    expect(readPreviewInspectorNeuralModel(persisted)).toEqual(persisted);
    expect(Object.keys(persisted.heads)).toHaveLength(3);
  });

  it('retains context identity across feature order changes and copied asynchronous decisions', () => {
    const fixture = createFixture();
    const specification = {
      candidateId: 'shape-only',
      holeKind: 'blocker-exception-runtime-value',
    };
    const first = fixture.create({
      ...specification,
      numbers: { requiredPaths: 2, exactTarget: 1 },
      texts: ['account status'],
      tokens: ['required:account.status', 'strategy:shape-only'],
    });
    fixture.train(first, 0);
    const reordered = fixture.create({
      ...specification,
      numbers: { exactTarget: 1, requiredPaths: 2 },
      texts: ['status account'],
      tokens: ['strategy:shape-only', 'required:account.status'],
    });

    expect(reordered.contextKey).toBe(first.contextKey);
    expect(reordered.consecutiveFailures).toBe(1);
    const copied = { ...first, contextKey: '00000000' };
    fixture.train(copied, 0);
    expect(fixture.refresh(first).outcomeAttempts).toBe(2);
    expect(Object.keys(fixture.serialize().candidateOutcomes)).toHaveLength(1);
  });

  it('includes the final feature cells in context identity', () => {
    const fixture = createFixture();
    const decision = fixture.create({ candidateId: 'shared-strategy', holeKind: 'condition' });
    const first = { ...decision, featureVector: Array<number>(64).fill(0) };
    const secondVector = Array<number>(64).fill(0);
    secondVector[63] = 1;
    const second = { ...decision, featureVector: secondVector };
    fixture.train(first, 0);
    fixture.train(second, 1);

    expect(fixture.refresh(first)).toMatchObject({ consecutiveFailures: 1, outcomeAttempts: 1 });
    expect(fixture.refresh(second)).toMatchObject({ consecutiveFailures: 0, outcomeAttempts: 1 });
    expect(Object.keys(fixture.serialize().candidateOutcomes)).toHaveLength(2);
  });

  it('bounds lexical input before processing long error messages', () => {
    const fixture = createFixture();
    const prefix = ' '.repeat(192);
    const short = fixture.create({ holeKind: 'blocker-exception', texts: [prefix] });
    const long = fixture.create({
      holeKind: 'blocker-exception',
      texts: [prefix + ' detail'.repeat(50_000)],
    });

    expect(long.featureVector).toEqual(short.featureVector);
    expect(long.contextKey).toBe(short.contextKey);
    expect(long.featureVector.every(Number.isFinite)).toBe(true);
  });

  it('keeps rare family outcomes after a long burst of another problem type', () => {
    const fixture = createFixture();
    const rare = PROBLEMS.filter((problem) => problem[2] !== 'condition').map(
      ([blockerKind, holeKind]) =>
        fixture.create({ blockerKind, holeKind, candidateId: 'rare-repair' }),
    );
    for (const decision of rare) fixture.train(decision, 0);
    for (let index = 0; index < 220; index += 1) {
      fixture.train(
        fixture.create({ holeKind: 'condition', candidateId: 'gate-' + String(index) }),
        1,
      );
    }

    expect(Object.keys(fixture.serialize().candidateOutcomes)).toHaveLength(192);
    for (const decision of rare) {
      expect(fixture.refresh(decision)).toMatchObject({
        consecutiveFailures: 1,
        outcomeAttempts: 1,
      });
    }
    expect(fixture.create({ holeKind: 'condition', candidateId: 'gate-219' }).outcomeAttempts).toBe(
      1,
    );
    expect(fixture.create({ holeKind: 'condition', candidateId: 'gate-0' }).outcomeAttempts).toBe(
      0,
    );
  });

  it('preserves the same family quotas during host merge, browser merge, and hot-state repair', () => {
    const fixture = createFixture();
    const current = createOutcomeModel(
      PROBLEMS.flatMap(([, , family], familyIndex) =>
        Array.from({ length: 19 }, (_, index): [string, PreviewInspectorNeuralCandidateOutcome] => [
          family + ':' + index.toString(16).padStart(8, '0'),
          createOutcome(familyIndex * 19 + index + 1),
        ]),
      ),
    );
    const incoming = createOutcomeModel(
      Array.from({ length: 192 }, (_, index): [string, PreviewInspectorNeuralCandidateOutcome] => [
        'condition:' + (index + 1000).toString(16).padStart(8, '0'),
        createOutcome(index + 1000),
      ]),
    );
    const host = mergePreviewInspectorNeuralModels(current, incoming);
    const browser = fixture.merge(current, incoming);
    fixture.setModel({
      ...incoming,
      candidateOutcomes: { ...current.candidateOutcomes, ...incoming.candidateOutcomes },
    });

    expect(browser).toEqual(host);
    expect(fixture.serialize()).toEqual(host);
    expect(Object.keys(host.candidateOutcomes)).toHaveLength(192);
    for (const [, , family] of PROBLEMS) {
      expect(
        Object.keys(host.candidateOutcomes).filter((key) => key.startsWith(family + ':')),
      ).toHaveLength(family === 'condition' ? 21 : 19);
    }
    expect(mergePreviewInspectorNeuralModels(host, host)).toEqual(host);
  });
});

/** Creates one finite verified result for deterministic retention tests. */
function createOutcome(sequence: number): PreviewInspectorNeuralCandidateOutcome {
  return {
    attempts: 1,
    consecutiveFailures: 0,
    evidence: 1,
    lastConfidence: 1,
    lastLabel: 1,
    rewardSum: 1,
    sequence,
  };
}

/** Builds a validated current-version snapshot with distinct anonymous result entries. */
function createOutcomeModel(
  entries: readonly [string, PreviewInspectorNeuralCandidateOutcome][],
): PreviewInspectorNeuralModel {
  const model = readPreviewInspectorNeuralModel({
    ...createEmptyPreviewInspectorNeuralModel(),
    candidateOutcomes: Object.fromEntries(entries),
    outcomeSequence: Math.max(...entries.map((entry) => entry[1].sequence)),
  });
  if (model === undefined) throw new Error('Invalid neural outcome model fixture.');
  return model;
}
