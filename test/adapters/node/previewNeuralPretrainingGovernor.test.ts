/** Verifies that neural pre-training waits for machine capacity and retries starved pages once. */
import { describe, expect, it } from 'vitest';
import {
  runPreviewNeuralPretraining,
  type PreviewNeuralPretrainingRow,
} from '../../../src/adapters/node/previewNeuralPretraining';
import {
  isPreviewPretrainingEnvironmentalFailure,
  readPreviewPretrainingPauseReason,
  waitForPreviewPretrainingCapacity,
  type PreviewPretrainingLoadSample,
} from '../../../src/adapters/node/previewNeuralPretrainingGovernor';
import {
  createEmptyPreviewInspectorNeuralModel,
  readPreviewInspectorNeuralModel,
  type PreviewInspectorNeuralModel,
} from '../../../src/presentation/previewInspectorNeuralModelProtocol';

const CPUS = 16;

describe('pre-training admission gate', () => {
  /** Pausing above one task per CPU and resuming below three quarters prevents flapping. */
  it('pauses above the high watermark and resumes only below the low one', () => {
    const sample = (load: number): PreviewPretrainingLoadSample => ({ cpuCount: CPUS, load });

    expect(readPreviewPretrainingPauseReason(sample(15.9), false)).toBeUndefined();
    expect(readPreviewPretrainingPauseReason(sample(16.5), false)).toBe('load 16.5 > 16.0');
    expect(readPreviewPretrainingPauseReason(sample(13), true)).toBe('load 13.0 > 12.0');
    expect(readPreviewPretrainingPauseReason(sample(11.5), true)).toBeUndefined();
  });

  /** Critical memory pressure pauses regardless of load; warning level does not. */
  it('pauses on critical memory pressure only', () => {
    expect(
      readPreviewPretrainingPauseReason({ cpuCount: CPUS, load: 1, memoryPressure: 4 }, false),
    ).toBe('memory pressure level 4');
    expect(
      readPreviewPretrainingPauseReason({ cpuCount: CPUS, load: 1, memoryPressure: 2 }, false),
    ).toBeUndefined();
  });

  /** A zero ratio turns the load gate off. */
  it('admits every page when the load gate is disabled', () => {
    expect(
      readPreviewPretrainingPauseReason({ cpuCount: CPUS, load: 99 }, false, {
        pauseLoadRatio: 0,
        pauseMemoryPressure: 4,
        resumeLoadRatio: 0,
      }),
    ).toBeUndefined();
  });

  /** The wait polls until the load drops, logging the pause and its length. */
  it('waits while the machine is busy and reports the paused time', async () => {
    const loads = [20, 18, 13, 11];
    let clock = 0;
    const messages: string[] = [];

    const pausedMs = await waitForPreviewPretrainingCapacity({
      log: (message) => messages.push(message),
      now: () => clock,
      pollMs: 5_000,
      sample: () => ({ cpuCount: CPUS, load: loads.shift() ?? 0 }),
      sleep: (milliseconds) => {
        clock += milliseconds;
        return Promise.resolve();
      },
    });

    expect(pausedMs).toBe(15_000);
    expect(messages).toEqual(['paused: load 20.0 > 16.0', 'resumed after 15 s']);
  });
});

describe('pre-training retries of starved pages', () => {
  /** Chromium timeouts and compiler stalls are environmental; page crashes are not. */
  it('classifies only starvation failures as retryable', () => {
    expect(isPreviewPretrainingEnvironmentalFailure('protocol-error/none')).toBe(true);
    expect(isPreviewPretrainingEnvironmentalFailure('build-stalled')).toBe(true);
    expect(isPreviewPretrainingEnvironmentalFailure('build-failed')).toBe(false);
    expect(isPreviewPretrainingEnvironmentalFailure('ready/post-commit-failed')).toBe(false);
  });

  /** A starved page is re-queued once after the others and recorded only when it finishes. */
  it('retries a starved page once at the end before recording it', async () => {
    const attempts: string[] = [];
    const rows: PreviewNeuralPretrainingRow[] = [];
    const retries: string[] = [];
    let gateCalls = 0;
    const failures = new Map([
      ['a1', 1],
      ['b1', 2],
    ]);

    const trained = await runPreviewNeuralPretraining({
      base: createEmptyPreviewInspectorNeuralModel(),
      beforePage: () => {
        gateCalls += 1;
        return Promise.resolve();
      },
      chunkSize: 1,
      isRetryable: isPreviewPretrainingEnvironmentalFailure,
      onPage: (row) => {
        rows.push(row);
      },
      onRetry: (row) => {
        retries.push(row.page);
      },
      previewPage: (_workspace, page, model) => {
        attempts.push(page);
        const remaining = failures.get(page) ?? 0;
        if (remaining > 0) {
          failures.set(page, remaining - 1);
          return Promise.resolve({ status: 'protocol-error/none' });
        }
        return Promise.resolve({ model: train(model), status: 'ready/ready' });
      },
      workspaces: [
        { name: 'alpha', pages: ['a1', 'a2'], root: '/alpha' },
        { name: 'beta', pages: ['b1'], root: '/beta' },
      ],
    });

    expect(attempts).toEqual(['a1', 'b1', 'a2', 'a1', 'b1']);
    expect(retries).toEqual(['a1', 'b1']);
    expect(rows.map((row) => [row.page, row.status])).toEqual([
      ['a2', 'ready/ready'],
      ['a1', 'ready/ready'],
      ['b1', 'protocol-error/none'],
    ]);
    expect(gateCalls).toBe(5);
    expect(trained.heads.general?.updates).toBe(2);
  });
});

/** Adds one update to the general head, like one settled training step. */
function train(model: PreviewInspectorNeuralModel): PreviewInspectorNeuralModel {
  const updates = (model.heads.general?.updates ?? 0) + 1;
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
