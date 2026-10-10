/** Verifies page scheduling, model carry, and the import document of neural pre-training. */
import { describe, expect, it } from 'vitest';
import {
  createPreviewNeuralPretrainingImport,
  mergePreviewNeuralPretrainingLanes,
  runPreviewNeuralPretraining,
  schedulePreviewNeuralPretraining,
  type PreviewNeuralPretrainingRow,
} from '../../../src/adapters/node/previewNeuralPretraining';
import { readPreviewInspectorNeuralModelImport } from '../../../src/presentation/previewInspectorNeuralModelImport';
import {
  createEmptyPreviewInspectorNeuralModel,
  readPreviewInspectorNeuralModel,
  type PreviewInspectorNeuralModel,
} from '../../../src/presentation/previewInspectorNeuralModelProtocol';

const ALPHA = { name: 'alpha', pages: ['a1', 'a2', 'a3'], root: '/alpha' };
const BETA = { name: 'beta', pages: ['b1'], root: '/beta' };

describe('neural pre-training', () => {
  /** Workspaces take turns in chunks, so no project dominates the end of the run. */
  it('schedules pages as round-robin chunks', () => {
    expect(
      schedulePreviewNeuralPretraining([ALPHA, BETA], 2).map(
        ({ page, workspace }) => `${workspace.name}:${page}`,
      ),
    ).toEqual(['alpha:a1', 'alpha:a2', 'beta:b1', 'alpha:a3']);
  });

  /** Each page starts from the previous page's model; failed pages keep the model unchanged. */
  it('carries the model between pages and skips completed pages', async () => {
    const seen: number[] = [];
    const rows: PreviewNeuralPretrainingRow[] = [];

    const trained = await runPreviewNeuralPretraining({
      base: createEmptyPreviewInspectorNeuralModel(),
      chunkSize: 2,
      completed: new Set(['alpha:a2']),
      onPage: (row) => {
        rows.push(row);
      },
      previewPage: (_workspace, page, model) => {
        seen.push(model.heads.general?.updates ?? 0);
        return Promise.resolve(
          page === 'b1' ? { status: 'build-failed' } : { model: train(model), status: 'ready' },
        );
      },
      workspaces: [ALPHA, BETA],
    });

    expect(seen).toEqual([0, 1, 1]);
    expect(trained.heads.general?.updates).toBe(2);
    expect(rows.map((row) => [row.page, row.status, row.learned])).toEqual([
      ['a1', 'ready', { general: 1 }],
      ['b1', 'build-failed', {}],
      ['a3', 'ready', { general: 1 }],
    ]);
  });

  /** Parallel lanes from one start add their own updates instead of replacing each other. */
  it('adds the differences of parallel lanes', () => {
    const start = train(createEmptyPreviewInspectorNeuralModel());
    const twice = train(train(start));

    const merged = mergePreviewNeuralPretrainingLanes(start, [train(start), twice]);

    expect(merged.heads.general?.updates).toBe(4);
    expect(merged.heads.general?.outputBias).toBeCloseTo(0.1 + 0.1 + 0.2);
  });

  /** The document passes the extension's import validation. */
  it('writes an import document the extension accepts', () => {
    const base = createEmptyPreviewInspectorNeuralModel();
    const document = createPreviewNeuralPretrainingImport(base, train(base));

    const imported = readPreviewInspectorNeuralModelImport(document);

    expect(imported?.base).toEqual(base);
    expect(imported?.id).toMatch(/^pretrain-[a-f0-9]{12}$/u);
  });
});

/** Adds one update to the general head, like one settled training step. */
function train(model: PreviewInspectorNeuralModel): PreviewInspectorNeuralModel {
  const head = model.heads.general;
  const updates = (head?.updates ?? 0) + 1;
  const next = readPreviewInspectorNeuralModel({
    ...model,
    heads: {
      ...model.heads,
      general: {
        evidence: updates,
        outputBias: 0.1 * updates,
        outputWeights: Array(16).fill(0.01 * updates),
        updates,
      },
    },
  });
  if (next === undefined) throw new Error('Invalid trained fixture.');
  return next;
}
