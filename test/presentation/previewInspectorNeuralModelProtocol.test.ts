/** Verifies bounded anonymous model validation, family merging, and profile persistence. */
import { describe, expect, it, vi } from 'vitest';
import {
  createEmptyPreviewInspectorNeuralModel,
  mergePreviewInspectorNeuralModels,
  readPreviewInspectorNeuralModel,
  readPreviewInspectorNeuralModelSyncRequest,
  type PreviewInspectorNeuralModel,
} from '../../src/presentation/previewInspectorNeuralModelProtocol';
import { PreviewInspectorNeuralModelStore } from '../../src/presentation/previewInspectorNeuralModelStore';

describe('Preview Inspector neural model host protocol', () => {
  /** Migrates the earlier schema while preserving heads that have no candidate-level audit trail. */
  it('accepts legacy version-three heads and adds calibrated evidence memory', () => {
    const model = readPreviewInspectorNeuralModel({
      heads: {
        condition: createHead(7, 0.4),
      },
      updates: 7,
      version: 3,
    });

    expect(model).toEqual({
      candidateOutcomes: {},
      heads: {
        condition: {
          ...createHead(7, 0.4),
          evidence: 4.55,
        },
      },
      outcomeSequence: 0,
      updates: 7,
      version: 4,
    });
  });

  /** Keeps exact failure memory but removes singleton-heavy legacy bias from generalization. */
  it('refines noisy legacy outcomes and recovers the page-choice family', () => {
    const model = readPreviewInspectorNeuralModel({
      candidateOutcomes: {
        'page-choice:0123abcd': createOutcome(1, 3),
        'render-state:89abcdef': createOutcome(4, 2),
        'rendered-empty:00112233': createOutcome(1, 1, 1, 0.05),
      },
      heads: {
        'page-choice': createHead(1, 0.5),
        'render-state': createHead(4, 0.5),
        'rendered-empty': createHead(1, -1),
      },
      outcomeSequence: 3,
      version: 3,
    });

    expect(model?.version).toBe(4);
    expect(model?.heads['page-choice']).toMatchObject({
      evidence: 0.35,
      outputBias: 0.2,
      updates: 1,
    });
    expect(model?.heads['render-state']).toMatchObject({
      evidence: 2.9,
      outputBias: 0.5,
      updates: 4,
    });
    expect(model?.heads['rendered-empty']).toMatchObject({
      evidence: 0.35,
      outputBias: -0.4,
      updates: 1,
    });
    expect(model?.candidateOutcomes['rendered-empty:00112233']).toMatchObject({
      attempts: 1,
      evidence: 0.35,
      lastConfidence: 0.35,
    });
    expect(model?.candidateOutcomes['rendered-empty:00112233']?.rewardSum).toBeCloseTo(0.0175);
    expect(readPreviewInspectorNeuralModel(model)).toEqual(model);
  });

  /** Rejects non-finite weights, raw candidate names, and over-budget candidate memories. */
  it('fails closed for malformed or identifying model payloads', () => {
    expect(
      readPreviewInspectorNeuralModel({
        heads: { condition: createHead(1, Number.NaN) },
        version: 3,
      }),
    ).toBeUndefined();
    expect(
      readPreviewInspectorNeuralModel({
        heads: { condition: createHead(1, 0.2) },
        version: 4,
      }),
    ).toBeUndefined();
    expect(
      readPreviewInspectorNeuralModel({
        candidateOutcomes: {
          'condition:project-row-loader': createOutcome(1, 1),
        },
        heads: {},
        outcomeSequence: 1,
        version: 3,
      }),
    ).toBeUndefined();
    expect(
      readPreviewInspectorNeuralModel({
        candidateOutcomes: Object.fromEntries(
          Array.from({ length: 193 }, (_value, index) => [
            `condition:${index.toString(16).padStart(8, '0')}`,
            createOutcome(1, index + 1),
          ]),
        ),
        heads: {},
        outcomeSequence: 193,
        version: 3,
      }),
    ).toBeUndefined();
  });

  /** Keeps independently learned blocker families and the strongest candidate evidence. */
  it('merges panel models by family instead of replacing all prior learning', () => {
    const current = requireModel({
      candidateOutcomes: {
        'condition:0123abcd': createOutcome(2, 2, 0),
      },
      heads: { condition: createHead(9, 0.2) },
      outcomeSequence: 2,
      version: 3,
    });
    const incoming = requireModel({
      candidateOutcomes: {
        'condition:0123abcd': createOutcome(4, 4, 2),
        'unrendered:89abcdef': createOutcome(1, 5, 0),
      },
      heads: {
        condition: createHead(3, -0.2),
        unrendered: createHead(5, 0.6),
      },
      outcomeSequence: 5,
      version: 3,
    });

    const merged = mergePreviewInspectorNeuralModels(current, incoming);

    expect(merged.heads.condition?.updates).toBe(9);
    expect(merged.heads.unrendered?.updates).toBe(5);
    expect(merged.updates).toBe(14);
    expect(merged.candidateOutcomes['condition:0123abcd']).toMatchObject({
      attempts: 4,
      consecutiveFailures: 2,
    });
    expect(merged.candidateOutcomes['unrendered:89abcdef']?.attempts).toBe(1);
  });

  /** Validates the revision envelope before a model can reach profile persistence. */
  it('reads only a complete synchronization request', () => {
    const model = createEmptyPreviewInspectorNeuralModel();
    expect(
      readPreviewInspectorNeuralModelSyncRequest({
        model,
        runtimeRevision: 8,
        type: 'react-preview-neural-model-sync',
      }),
    ).toMatchObject({ model, runtimeRevision: 8 });
    expect(
      readPreviewInspectorNeuralModelSyncRequest({
        model,
        runtimeRevision: -1,
        type: 'react-preview-neural-model-sync',
      }),
    ).toBeUndefined();
  });
});

describe('PreviewInspectorNeuralModelStore', () => {
  /** Serializes concurrent panel updates and durably combines different learned families. */
  it('shares accumulated learning through profile state', async () => {
    const values = new Map<string, unknown>();
    const update = vi.fn((key: string, value: unknown): Promise<void> => {
      values.set(key, value);
      return Promise.resolve();
    });
    const store = new PreviewInspectorNeuralModelStore(
      { get: (key) => values.get(key), update },
      { debug: vi.fn() },
    );
    const condition = requireModel({
      heads: { condition: createHead(4, 0.4) },
      version: 3,
    });
    const exception = requireModel({
      heads: { 'blocker-exception': createHead(6, -0.3) },
      version: 3,
    });

    const [, shared] = await Promise.all([
      store.synchronize(condition),
      store.synchronize(exception),
    ]);

    expect(shared.heads.condition?.updates).toBe(4);
    expect(shared.heads['blocker-exception']?.updates).toBe(6);
    expect(shared.updates).toBe(10);
    expect(update).toHaveBeenCalledTimes(2);
    expect(values.get('reactPreview.neuralResidualModel')).toEqual(shared);
  });

  /** Writes the refined schema even when the first live panel has no newer training yet. */
  it('persists a legacy model migration on the first synchronization', async () => {
    const legacy = {
      candidateOutcomes: {
        'rendered-empty:0123abcd': createOutcome(1, 1, 1, 0.05),
      },
      heads: { 'rendered-empty': createHead(1, -1) },
      outcomeSequence: 1,
      version: 3,
    };
    const values = new Map<string, unknown>([['reactPreview.neuralResidualModel', legacy]]);
    const update = vi.fn((key: string, value: unknown): Promise<void> => {
      values.set(key, value);
      return Promise.resolve();
    });
    const store = new PreviewInspectorNeuralModelStore(
      { get: (key) => values.get(key), update },
      { debug: vi.fn() },
    );

    const shared = await store.synchronize(createEmptyPreviewInspectorNeuralModel());

    expect(update).toHaveBeenCalledOnce();
    expect(shared).toMatchObject({ updates: 1, version: 4 });
    expect(shared.heads['rendered-empty']).toMatchObject({
      evidence: 0.35,
      outputBias: -0.4,
    });
    expect(values.get('reactPreview.neuralResidualModel')).toEqual(shared);
  });
});

/** Creates one finite head with distinctive but bounded weights. */
function createHead(updates: number, outputBias: number): Record<string, unknown> {
  return {
    outputBias,
    outputWeights: Array(16).fill(outputBias / 2),
    updates,
  };
}

/** Creates one internally consistent anonymous outcome. */
function createOutcome(
  attempts: number,
  sequence: number,
  consecutiveFailures = 0,
  lastLabel = consecutiveFailures > 0 ? 0 : 1,
): Record<string, unknown> {
  return {
    attempts,
    consecutiveFailures,
    lastLabel,
    rewardSum:
      lastLabel * Math.max(1, consecutiveFailures) +
      (consecutiveFailures > 0 ? attempts - consecutiveFailures : attempts - 1),
    sequence,
  };
}

/** Narrows a test literal after exercising the same untrusted parser used in production. */
function requireModel(value: unknown): PreviewInspectorNeuralModel {
  const model = readPreviewInspectorNeuralModel(value);
  if (model === undefined) throw new Error('Invalid neural model test fixture.');
  return model;
}
