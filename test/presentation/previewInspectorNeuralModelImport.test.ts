/** Verifies that a pre-training import adds its learning without resetting profile learning. */
import { describe, expect, it, vi } from 'vitest';
import {
  applyPreviewInspectorNeuralModelImport,
  readPreviewInspectorNeuralModelImport,
  type PreviewInspectorNeuralModelImport,
  type PreviewInspectorNeuralModelImportClaim,
} from '../../src/presentation/previewInspectorNeuralModelImport';
import {
  readPreviewInspectorNeuralModel,
  type PreviewInspectorNeuralModel,
} from '../../src/presentation/previewInspectorNeuralModelProtocol';
import { PreviewInspectorNeuralModelStore } from '../../src/presentation/previewInspectorNeuralModelStore';

const STATE_KEY = 'reactPreview.neuralResidualModel';

describe('applyPreviewInspectorNeuralModelImport', () => {
  /** Profile updates made after the copy survive, and pre-training adds only its difference. */
  it('adds the trained head difference to the current head', () => {
    const base = model({ heads: { condition: head(10, 9, 0.5, 0.25) } });
    const trained = model({ heads: { condition: head(14, 12, 0.75, 0.5) } });
    const current = model({ heads: { condition: head(12, 11, 1, 0.125) } });

    const result = applyPreviewInspectorNeuralModelImport(current, imported(base, trained));

    expect(result.heads.condition).toEqual({
      evidence: 14,
      outputBias: 1.25,
      outputWeights: Array.from({ length: 16 }, () => 0.375),
      updates: 16,
    });
  });

  /** Heads pre-training never trained keep the profile's values, and new heads are added. */
  it('keeps untrained heads and adds heads the profile does not have', () => {
    const base = model({ heads: { condition: head(10, 9, 0.5, 0.25) } });
    const trained = model({
      heads: { condition: head(10, 9, 0.5, 0.25), 'page-choice': head(3, 2, -0.5, 0.125) },
    });
    const current = model({ heads: { condition: head(12, 11, 1, 0.125) } });

    const result = applyPreviewInspectorNeuralModelImport(current, imported(base, trained));

    expect(result.heads.condition).toEqual(current.heads.condition);
    expect(result.heads['page-choice']).toEqual(trained.heads['page-choice']);
  });

  /** Combined weights stay inside the runtime clipping range. */
  it('clamps combined weights', () => {
    const base = model({ heads: { general: head(1, 1, 0, 0) } });
    const trained = model({ heads: { general: head(2, 2, 3, 3) } });
    const current = model({ heads: { general: head(5, 5, 3, -3) } });

    const result = applyPreviewInspectorNeuralModelImport(current, imported(base, trained));

    expect(result.heads.general?.outputBias).toBe(4);
    expect(result.heads.general?.outputWeights[0]).toBe(0);
  });

  /** Existing memories gain only the pre-training attempts and keep their eviction order. */
  it('adds outcome counters without reordering profile memories', () => {
    const key = 'condition:0000000a';
    const base = model({ outcomes: { [key]: outcome(2, 1, 5) } });
    const trained = model({ outcomes: { [key]: outcome(4, 3, 9) } });
    const current = model({ outcomes: { [key]: outcome(3, 2, 7) } });

    const result = applyPreviewInspectorNeuralModelImport(current, imported(base, trained));

    expect(result.candidateOutcomes[key]).toMatchObject({
      attempts: 5,
      evidence: 4,
      rewardSum: 4,
      sequence: 7,
    });
  });

  /** Pre-training never displaces or resurrects profile memories. */
  it('fills only free outcome slots, as the oldest entries', () => {
    const dropped = 'condition:000000d0';
    const base = model({ outcomes: { [dropped]: outcome(1, 1, 1) } });
    const fresh = Object.fromEntries(
      Array.from({ length: 3 }, (_, index) => [
        `page-choice:${index.toString(16).padStart(8, '0')}`,
        outcome(1, index === 1 ? 1 : 0.5, 3000 + index),
      ]),
    );
    const trained = model({ outcomes: { [dropped]: outcome(2, 2, 2), ...fresh } });
    const full = Object.fromEntries(
      Array.from({ length: 191 }, (_, index) => [
        `general:${(0x1000 + index).toString(16).padStart(8, '0')}`,
        outcome(1, 1, index + 1),
      ]),
    );
    const current = model({ outcomes: full });

    const result = applyPreviewInspectorNeuralModelImport(current, imported(base, trained));

    expect(Object.keys(result.candidateOutcomes)).toHaveLength(192);
    expect(result.candidateOutcomes[dropped]).toBeUndefined();
    expect(result.candidateOutcomes['page-choice:00000001']).toMatchObject({ sequence: 1 });
    for (const key of Object.keys(full)) {
      expect(result.candidateOutcomes[key]).toEqual(current.candidateOutcomes[key]);
    }
  });
});

describe('readPreviewInspectorNeuralModelImport', () => {
  /** Only the documented format with two valid models is accepted. */
  it('rejects unknown formats, identifiers, and models', () => {
    const valid = {
      base: model({}),
      format: 'react-preview-neural-pretraining',
      id: 'pretrain-1',
      trained: model({}),
      version: 1,
    };

    expect(readPreviewInspectorNeuralModelImport(valid)?.id).toBe('pretrain-1');
    expect(readPreviewInspectorNeuralModelImport({ ...valid, version: 2 })).toBeUndefined();
    expect(readPreviewInspectorNeuralModelImport({ ...valid, id: '../x' })).toBeUndefined();
    expect(
      readPreviewInspectorNeuralModelImport({ ...valid, trained: { version: 4 } }),
    ).toBeUndefined();
  });
});

describe('PreviewInspectorNeuralModelStore import', () => {
  /** The first synchronization applies a claimed import once, after backing up the profile. */
  it('applies a pending import on first use and persists it', async () => {
    const values = new Map<string, unknown>([
      [STATE_KEY, model({ heads: { condition: head(12, 11, 1, 0.125) } })],
    ]);
    const update = vi.fn((key: string, value: unknown): Promise<void> => {
      values.set(key, value);
      return Promise.resolve();
    });
    const claim = createClaim(
      imported(
        model({ heads: { condition: head(10, 9, 0.5, 0.25) } }),
        model({ heads: { condition: head(14, 12, 0.75, 0.5) } }),
      ),
    );
    const source = { claim: vi.fn().mockResolvedValueOnce(claim).mockResolvedValue(undefined) };
    const store = new PreviewInspectorNeuralModelStore(
      { get: (key) => values.get(key), update },
      { debug: vi.fn(), info: vi.fn() },
      source,
    );

    const first = await store.synchronize(model({}));
    const second = await store.synchronize(model({}));

    expect(first.heads.condition?.updates).toBe(16);
    expect(second).toEqual(first);
    expect(source.claim).toHaveBeenCalledOnce();
    expect(claim.backup).toHaveBeenCalledOnce();
    expect(
      (claim.backup.mock.calls[0]?.[0] as PreviewInspectorNeuralModel | undefined)?.heads.condition
        ?.updates,
    ).toBe(12);
    expect(claim.settle).toHaveBeenCalledWith('applied');
    expect(values.get(STATE_KEY)).toEqual(first);
  });

  /** The import is marked applied only once the combined model is stored. */
  it('settles the import only after the combined model is persisted', async () => {
    const update = vi
      .fn<(key: string, value: unknown) => Promise<void>>()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValue(undefined);
    const claim = createClaim(
      imported(model({}), model({ heads: { general: head(2, 2, 0.5, 0.25) } })),
    );
    const store = new PreviewInspectorNeuralModelStore(
      { get: () => undefined, update },
      { debug: vi.fn(), info: vi.fn() },
      { claim: () => Promise.resolve(claim) },
    );

    await store.synchronize(model({}));
    expect(claim.settle).not.toHaveBeenCalled();
    await store.synchronize(model({}));

    expect(update).toHaveBeenCalledTimes(2);
    expect(claim.settle).toHaveBeenCalledExactlyOnceWith('applied');
  });

  /** Learning another window stored after this window loaded is kept, not overwritten. */
  it('merges profile state stored by another window before writing', async () => {
    const values = new Map<string, unknown>();
    const update = vi.fn((key: string, value: unknown): Promise<void> => {
      values.set(key, value);
      return Promise.resolve();
    });
    const store = new PreviewInspectorNeuralModelStore(
      { get: (key) => values.get(key), update },
      { debug: vi.fn(), info: vi.fn() },
    );
    await store.synchronize(model({ heads: { condition: head(2, 2, 0.5, 0.25) } }));
    values.set(STATE_KEY, model({ heads: { general: head(9, 9, -0.5, 0.125) } }));

    const shared = await store.synchronize(model({ heads: { condition: head(3, 3, 0.5, 0.25) } }));

    expect(shared.heads.general?.updates).toBe(9);
    expect(shared.heads.condition?.updates).toBe(3);
    expect(values.get(STATE_KEY)).toEqual(shared);
  });

  /** A malformed import is set aside and the profile model is used unchanged. */
  it('rejects a malformed import without touching the profile model', async () => {
    const persisted = model({ heads: { condition: head(12, 11, 1, 0.125) } });
    const claim = createClaim(undefined);
    const store = new PreviewInspectorNeuralModelStore(
      { get: () => persisted, update: () => Promise.resolve() },
      { debug: vi.fn(), info: vi.fn() },
      { claim: () => Promise.resolve(claim) },
    );

    const shared = await store.synchronize(model({}));

    expect(shared).toEqual(persisted);
    expect(claim.backup).not.toHaveBeenCalled();
    expect(claim.settle).toHaveBeenCalledWith('rejected');
  });
});

/** Creates a claim whose storage operations are observable. */
function createClaim(value: PreviewInspectorNeuralModelImport | undefined): {
  readonly backup: ReturnType<typeof vi.fn>;
  readonly settle: ReturnType<typeof vi.fn>;
} & PreviewInspectorNeuralModelImportClaim {
  return {
    backup: vi.fn(() => Promise.resolve()),
    settle: vi.fn(() => Promise.resolve()),
    ...(value === undefined ? {} : { value }),
  };
}

/** Wraps two models as an import. */
function imported(
  base: PreviewInspectorNeuralModel,
  trained: PreviewInspectorNeuralModel,
): PreviewInspectorNeuralModelImport {
  return { base, id: 'pretrain-test', trained };
}

/** Builds a validated model from heads and outcomes. */
function model({
  heads = {},
  outcomes = {},
}: {
  readonly heads?: Record<string, unknown>;
  readonly outcomes?: Record<string, unknown>;
}): PreviewInspectorNeuralModel {
  const value = readPreviewInspectorNeuralModel({ candidateOutcomes: outcomes, heads, version: 4 });
  if (value === undefined) throw new Error('Invalid neural model test fixture.');
  return value;
}

/** Creates one head with a uniform weight. */
function head(
  updates: number,
  evidence: number,
  outputBias: number,
  weight: number,
): Record<string, unknown> {
  return {
    evidence,
    outputBias,
    outputWeights: Array.from({ length: 16 }, () => weight),
    updates,
  };
}

/** Creates one consistent successful outcome. */
function outcome(attempts: number, evidence: number, sequence: number): Record<string, unknown> {
  return {
    attempts,
    consecutiveFailures: 0,
    evidence,
    lastConfidence: 1,
    lastLabel: 1,
    rewardSum: evidence,
    sequence,
  };
}
