/** Guards operation counts and fresh-model semantics without timing-sensitive performance assertions. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';

interface BatchFixture {
  readonly counts: { inference: number; validation: number };
  readonly select: (count: number) =>
    | {
        readonly candidateId: string;
        readonly decision: { readonly score: number };
      }
    | undefined;
  readonly corrupt: () => void;
}

/** Runs the real ranking source and counts expensive boundaries, not synthetic ranking stubs. */
function createBatchFixture(): BatchFixture {
  const context = vm.createContext({});
  vm.runInContext(
    `
    const previewEntryRevision = 1;
    const previewInspectorSession = {};
    ${createPreviewInspectorNeuralResidualRuntimeSource()}
    const model = createPreviewInspectorNeuralResidualModel();
    model.heads['data-collection'] = {
      evidence: 10, outputBias: 0.1, outputWeights: Array(16).fill(0.05), updates: 10,
    };
    model.updates = 10;
    previewInspectorSession.neuralResidualModel = model;
    const counts = { inference: 0, validation: 0 };
    const initialize = initializePreviewInspectorNeuralResidualModel;
    const inference = runPreviewInspectorNeuralResidualModel;
    initializePreviewInspectorNeuralResidualModel = (...args) => { counts.validation++; return initialize(...args); };
    runPreviewInspectorNeuralResidualModel = (...args) => { counts.inference++; return inference(...args); };
    globalThis.fixture = {
      counts,
      corrupt: () => { previewInspectorSession.neuralResidualModel.heads['data-collection'].outputBias = NaN; },
      select: (count) => selectPreviewInspectorNeuralResidualCandidate(
        { blockerKind: 'runtime-fallback', holeKind: 'rendered-data-collection', tokens: ['role:collection'] },
        Array.from({ length: count }, (_, index) => ({
          id: 'candidate-' + index, deterministicRank: index,
          tokens: ['strategy:row-' + index], numbers: { rows: index + 1 },
        }))),
    };
  `,
    context,
  );
  return (context as { fixture: BatchFixture }).fixture;
}

describe('neural candidate batch work', () => {
  it('does no model work when there is no admitted candidate', () => {
    const fixture = createBatchFixture();
    expect(fixture.select(0)).toBeUndefined();
    expect(fixture.counts).toEqual({ inference: 0, validation: 0 });
  });

  it.each([2, 6, 12])(
    'validates once and scores each of %s admitted candidates only once',
    (count) => {
      const fixture = createBatchFixture();
      expect(fixture.select(count)).toBeDefined();
      expect(fixture.counts).toEqual({ inference: count, validation: 1 });
    },
  );

  it('validates a new batch again and repairs malformed retained state', () => {
    const fixture = createBatchFixture();
    fixture.select(12);
    fixture.corrupt();
    const result = fixture.select(12);
    expect(result?.decision.score).toBe(0.5);
    expect(fixture.counts).toEqual({ inference: 24, validation: 2 });
  });
});
