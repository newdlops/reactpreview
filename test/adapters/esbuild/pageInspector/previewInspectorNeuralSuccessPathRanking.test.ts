/** Verifies which verified success path is restored and when a success sweep counts as busy. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralSuccessCheckpointRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralSuccessCheckpointRuntimeSource';

interface RankingRuntime {
  readonly best: (paths: readonly Record<string, unknown>[]) => unknown;
  readonly busy: () => boolean;
  readonly setRecord: (record: Record<string, unknown> | undefined) => void;
}

/** Evaluates the checkpoint runtime with one corridor key and a replaceable sweep record. */
function createRankingRuntime(): RankingRuntime {
  const sandbox: { __runtime?: RankingRuntime } = {};
  vm.runInNewContext(
    `
      const previewInspectorSession = { automaticNeuralAssistanceByKey: new Map() };
      const readPreviewInspectorNeuralAssistanceReachability = () => ({ key: 'page:Panel' });
      const createPreviewInspectorAutomaticNeuralAssistanceKey = (state) => '7:' + state.key;
      ${createPreviewInspectorNeuralSuccessCheckpointRuntimeSource()}
      globalThis.__runtime = {
        best: (paths) => selectPreviewInspectorBestNeuralSuccessfulPath({
          failedSuccessRestorations: new Set(),
          successfulPaths: paths,
        })?.fingerprint,
        busy: () => isPreviewInspectorNeuralSuccessCollectionBusy(),
        setRecord: (record) => {
          previewInspectorSession.automaticNeuralAssistanceByKey.clear();
          if (record !== undefined) {
            // Records are built in this realm, like the browser's own records.
            const { explored, ...rest } = record;
            if (explored === true) rest.successfulPaths = [{ fingerprint: 'verified' }];
            previewInspectorSession.automaticNeuralAssistanceByKey.set('7:page:Panel', rest);
          }
        },
      };
    `,
    sandbox,
  );
  if (sandbox.__runtime === undefined) throw new Error('Checkpoint runtime did not initialize.');
  return sandbox.__runtime;
}

/** One terminal-stable checkpoint; `forced` conditions and `score` vary per case. */
function path(
  fingerprint: string,
  options: { readonly forced: number; readonly score: number; readonly tier?: number },
): Record<string, unknown> {
  return {
    conditionEntries: Array.from({ length: options.forced }, (_, index) => [
      `c${index.toString()}`,
      false,
    ]),
    fingerprint,
    observedAt: 1,
    score: options.score,
    temporalState: { kind: 'terminal-stable' },
    ...(options.tier === undefined ? {} : { tier: options.tier }),
  };
}

describe('neural success path ranking', () => {
  /** The authored tab with more filled values still beats a forced tab with fewer values. */
  it('restores the path with fewer forced branches within one output tier', () => {
    const runtime = createRankingRuntime();

    expect(
      runtime.best([
        path('forced-tab', { forced: 1, score: 11_099_274, tier: 11_100_000 }),
        path('authored-tab', { forced: 0, score: 11_092_000, tier: 11_100_000 }),
      ]),
    ).toBe('authored-tab');
    // A higher output tier (complete page context) still wins over fewer forced branches.
    expect(
      runtime.best([
        path('incomplete', { forced: 0, score: 1_099_000, tier: 1_100_000 }),
        path('complete', { forced: 2, score: 11_090_000, tier: 11_100_000 }),
      ]),
    ).toBe('complete');
    // Checkpoints without a tier (hot-reloaded records) keep the old score order.
    expect(
      runtime.best([
        path('older-low', { forced: 0, score: 100 }),
        path('older-high', { forced: 1, score: 200 }),
      ]),
    ).toBe('older-high');
  });

  /** Sampling an explored path, a scheduled next step, or a restoration keep request snapshots waiting. */
  it('reports a sweep as busy only while it samples, schedules, or restores', () => {
    const runtime = createRankingRuntime();

    runtime.setRecord(undefined);
    expect(runtime.busy()).toBe(false);
    runtime.setRecord({ scheduled: false });
    expect(runtime.busy()).toBe(false);
    // The first path is sampled before any alternative was tried: not busy.
    runtime.setRecord({ provisionalSuccessfulPath: { fingerprint: 'a' } });
    expect(runtime.busy()).toBe(false);
    runtime.setRecord({ explored: true, provisionalSuccessfulPath: { fingerprint: 'b' } });
    expect(runtime.busy()).toBe(true);
    runtime.setRecord({ scheduled: true });
    expect(runtime.busy()).toBe(true);
    runtime.setRecord({ restoringSuccessfulPath: true });
    expect(runtime.busy()).toBe(true);
  });
});
