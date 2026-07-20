/** Verifies one-in-flight coordination for target-guided condition render attempts. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorTargetAttemptRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetAttemptRuntimeSource';

describe('Preview Inspector target attempt runtime source', () => {
  /** Holds the next DFS gate until the exact condition attempt settles, then resumes its probe. */
  it('serializes condition attempts within one reachability corridor', () => {
    const context: { __result?: Record<string, unknown> } = {};
    vm.runInNewContext(
      `
        let notifications = 0;
        let treeRefreshes = 0;
        let currentTime = 100;
        Date.now = () => currentTime;
        const condition = { id: 'gate-a', reachabilityKey: 'candidate:Target' };
        const state = {
          key: 'candidate:Target',
          probeRevision: 3,
          status: 'settling-condition-attempt',
        };
        const attempt = {
          autoMode: 'target-guided-auto',
          blocker: { id: 'gate-a' },
          traceId: 'trace-a',
        };
        const previewInspectorSession = {
          blockerTraceActiveAttempt: attempt,
          renderConditions: new Map([['gate-a', condition]]),
          targetReachabilityByKey: new Map([[state.key, state]]),
        };
        const notifyPreviewInspector = () => { notifications += 1; };
        const schedulePreviewInspectorTreeRefresh = () => { treeRefreshes += 1; };
        ${createPreviewInspectorTargetAttemptRuntimeSource()}
        const pending = isPreviewInspectorTargetConditionAttemptPending(state);
        attempt.settledAt = 10;
        const pendingDuringGrace = isPreviewInspectorTargetConditionAttemptPending(state);
        currentTime = 171;
        const pendingAfterGrace = isPreviewInspectorTargetConditionAttemptPending(state);
        const resumed = resumePreviewInspectorTargetReachabilityAfterConditionAttempt(attempt);
        const unrelated = resumePreviewInspectorTargetReachabilityAfterConditionAttempt({
          autoMode: 'smart',
          blocker: { id: 'gate-a' },
        });
        globalThis.__result = {
          notifications,
          pending,
          pendingAfterGrace,
          pendingDuringGrace,
          probeRevision: state.probeRevision,
          resumed,
          status: state.status,
          treeRefreshes,
          unrelated,
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      notifications: 1,
      pending: true,
      pendingAfterGrace: false,
      pendingDuringGrace: true,
      probeRevision: 4,
      resumed: true,
      status: 'probing',
      treeRefreshes: 1,
      unrelated: false,
    });
  });
});
