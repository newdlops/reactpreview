/** Verifies exact inference/SGD parity, cold-start work, and context-local failure diversification. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';

const REFERENCE_PROJECTION = String.raw`
function referenceProjection(vector) {
  return Array.from({ length: 16 }, (_, hiddenIndex) => {
    let activation = ((hiddenIndex % 3) - 1) * 0.025;
    for (let inputIndex = 0; inputIndex < vector.length; inputIndex += 1) {
      const mixed = (Math.imul(hiddenIndex + 1, 0x45d9f3b) ^
        Math.imul(inputIndex + 3, 0x27d4eb2d)) >>> 0;
      const weight = (((mixed % 2001) / 1000) - 1) * 0.34;
      activation += vector[inputIndex] * weight;
    }
    return Math.tanh(activation);
  });
}
`;

/** Evaluates production model code with an independent reference and no renderer or persistence. */
function scenario(body: string): unknown {
  return vm.runInNewContext(
    `
    const previewEntryRevision = 1;
    const previewInspectorSession = {};
    ${createPreviewInspectorNeuralResidualRuntimeSource()}
    ${REFERENCE_PROJECTION}
    let weights = 0;
    const weight = readPreviewInspectorNeuralResidualProjectionWeight;
    readPreviewInspectorNeuralResidualProjectionWeight = (...args) => { weights++; return weight(...args); };
    const problem = { blockerKind: 'runtime-fallback', holeKind: 'blocker-exception-value',
      texts: ['Checkout', 'Missing payment state'], tokens: ['required:status'] };
    const candidates = [{ id: 'familiar', deterministicRank: 0 }, { id: 'alternate', deterministicRank: 1 }];
    ${body}
  `,
    {},
    { timeout: 5_000 },
  );
}

describe('neural projection startup and parity', () => {
  it('performs no projection or head allocation for cold score-only decisions and refreshes', () => {
    expect(
      scenario(`
      const selected = selectPreviewInspectorNeuralResidualCandidate(problem, candidates);
      const refreshed = refreshPreviewInspectorNeuralResidualDecision(selected.decision);
      ({ weights, allocated: previewInspectorNeuralResidualProjection !== undefined,
        heads: Object.keys(serializePreviewInspectorNeuralResidualModel().heads),
        score: refreshed.score, candidate: selected.candidateId });
    `),
    ).toEqual({ weights: 0, allocated: false, heads: [], score: 0.5, candidate: 'familiar' });
  });

  it.each(['zero', 'sparse', 'dense', 'signed'])('preserves exact %s projection values', (kind) => {
    expect(
      scenario(`
      const vector = Array.from({ length: 64 }, (_, index) => ${
        kind === 'zero'
          ? '0'
          : kind === 'sparse'
            ? 'index % 11 === 0 ? 0.125 : 0'
            : kind === 'signed'
              ? '(index % 2 === 0 ? -1 : 1) * index / 64'
              : '(index + 1) / 65'
      });
      const expected = referenceProjection(vector);
      const actual = projectPreviewInspectorNeuralResidualFeatures(vector);
      ({ identical: actual.every((value, index) => Object.is(value, expected[index])), weights });
    `),
    ).toEqual({ identical: true, weights: 1024 });
  });

  it('initializes fixed weights once while retaining fresh mutable hidden vectors', () => {
    expect(
      scenario(`
      const vector = Array(64).fill(0.1);
      const first = projectPreviewInspectorNeuralResidualFeatures(vector);
      first[0] = 999;
      vector[0] = -0.9;
      const second = projectPreviewInspectorNeuralResidualFeatures(vector);
      ({ weights, fresh: second[0] !== 999,
        frozen: Object.isFrozen(previewInspectorNeuralResidualProjection) &&
          previewInspectorNeuralResidualProjection.every(Object.isFrozen),
        identical: second.every((value, index) => Object.is(value, referenceProjection(vector)[index])) });
    `),
    ).toEqual({ weights: 1024, fresh: true, frozen: true, identical: true });
  });

  it('preserves every SGD update, score, and serialized weight across ten blocker families', () => {
    expect(
      scenario(`
      const optimized = projectPreviewInspectorNeuralResidualFeatures;
      const holes = ['blocker-exception', 'condition', 'data', 'local-state-transition', 'page-choice',
        'page-execution', 'rendered-without-output', 'render-state', 'unrendered', 'unknown'];
      const exercise = () => {
        previewInspectorSession.neuralResidualModel = createPreviewInspectorNeuralResidualModel();
        const observations = [];
        for (let index = 0; index < 80; index++) {
          const decision = createPreviewInspectorNeuralResidualDecision({ ...problem,
            candidateId: 'candidate-' + index % 3, holeKind: holes[index % holes.length],
            numbers: { progress: index / 17 }, tokens: ['required:' + index % 5] });
          observations.push(decision, trainPreviewInspectorNeuralResidualDecision(
            decision, index % 3 === 0 ? 0 : 1, index % 2 === 0 ? 0.35 : 1));
        }
        return JSON.stringify({ model: serializePreviewInspectorNeuralResidualModel(), observations });
      };
      const actual = exercise();
      projectPreviewInspectorNeuralResidualFeatures = referenceProjection;
      const expected = exercise();
      projectPreviewInspectorNeuralResidualFeatures = optimized;
      ({ identical: actual === expected, weights });
    `),
    ).toEqual({ identical: true, weights: 1024 });
  });

  it('skips malformed learning without allocating projection state', () => {
    expect(
      scenario(`
      const decision = createPreviewInspectorNeuralResidualDecision(problem);
      const rejected = [NaN, -1, 2].map((label) => trainPreviewInspectorNeuralResidualDecision(decision, label));
      ({ weights, rejected: rejected.every((value) => value === undefined),
        updates: serializePreviewInspectorNeuralResidualModel().updates });
    `),
    ).toEqual({ weights: 0, rejected: true, updates: 0 });
  });
});

describe('neural response to repeated verified failures', () => {
  it('tries the less-failed admitted direction even when historical success favors another', () => {
    expect(
      scenario(`
      const model = initializePreviewInspectorNeuralResidualModel();
      model.heads['blocker-exception'] = { evidence: 100, outputBias: 0, outputWeights: Array(16).fill(0), updates: 100 };
      model.updates = 100;
      const first = selectPreviewInspectorNeuralResidualCandidate(problem, [candidates[0]]).decision;
      const second = selectPreviewInspectorNeuralResidualCandidate(problem, [candidates[1]]).decision;
      for (let index = 0; index < 70; index++) recordPreviewInspectorNeuralResidualOutcome(model, first, 1, 1);
      for (let index = 0; index < 3; index++) recordPreviewInspectorNeuralResidualOutcome(model, first, 0, 1);
      recordPreviewInspectorNeuralResidualOutcome(model, second, 0, 1);
      const historicalFavorite = refreshPreviewInspectorNeuralResidualDecision(first).selectionScore >
        refreshPreviewInspectorNeuralResidualDecision(second).selectionScore;
      const selected = selectPreviewInspectorNeuralResidualCandidate(problem, candidates);
      const newProblem = selectPreviewInspectorNeuralResidualCandidate(
        { ...problem, tokens: ['required:another-hole'] }, candidates);
      ({ historicalFavorite, selected: selected.candidateId, failures: selected.decision.consecutiveFailures,
        freshFailures: newProblem.decision.consecutiveFailures, fresh: newProblem.candidateId });
    `),
    ).toEqual({
      historicalFavorite: true,
      selected: 'alternate',
      failures: 1,
      freshFailures: 0,
      fresh: 'familiar',
    });
  });
});
