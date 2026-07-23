/** Verifies one-in-flight coordination for current-file corridor render attempts. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorTargetAttemptRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetAttemptRuntimeSource';

describe('Preview Inspector target attempt runtime source', () => {
  /** Retains a condition corridor after its render-scoped condition records have disappeared. */
  it.each(['target-guided-auto', 'target-overlay-auto'])(
    'locks a %s attempt by durable metadata and resumes it exactly once',
    (mode) => {
      const context: { __result?: Record<string, unknown> } = {};
      vm.runInNewContext(
        `
        let notifications = 0;
        let treeRefreshes = 0;
        let currentTime = 100;
        const timers = [];
        Date.now = () => currentTime;
        globalThis.setTimeout = (callback, delay = 0) => {
          timers.push({ callback, dueAt: currentTime + delay });
          return timers.length;
        };
        const state = {
          key: 'candidate:Target',
          probeRevision: 3,
          status: 'settling-condition-attempt',
        };
        const attempt = {
          autoMode: ${JSON.stringify(mode)},
          blocker: { id: 'gate-a' },
          traceId: 'trace-a',
        };
        const previewInspectorSession = {
          blockerTraceActiveAttempt: attempt,
          renderConditionAutoAttempts: new Map([[
            'trace-a',
            { conditionId: 'gate-a', reachabilityKey: state.key },
          ]]),
          renderConditions: new Map(),
          targetReachabilityByKey: new Map([[state.key, state]]),
        };
        const notifyPreviewInspector = () => { notifications += 1; };
        const schedulePreviewInspectorTreeRefresh = () => { treeRefreshes += 1; };
        ${createPreviewInspectorTargetAttemptRuntimeSource()}
        const pendingFromAttemptMetadata = isPreviewInspectorTargetAutoAttemptPending(state);
        previewInspectorSession.renderConditionAutoAttempts.clear();
        const pendingAfterRegistryRemoval = isPreviewInspectorTargetAutoAttemptPending(state);
        attempt.settledAt = currentTime;
        const pendingDuringGrace = isPreviewInspectorTargetAutoAttemptPending(state);
        const firstSchedule = schedulePreviewInspectorTargetReachabilityResumeAfterAutoAttempt(
          attempt,
        );
        const duplicateSchedule = schedulePreviewInspectorTargetReachabilityResumeAfterAutoAttempt(
          attempt,
        );
        currentTime += 160;
        timers.shift().callback();
        const duplicateResume = resumePreviewInspectorTargetReachabilityAfterAutoAttempt(attempt);
        globalThis.__result = {
          duplicateResume,
          duplicateSchedule,
          firstSchedule,
          notifications,
          pendingAfterRegistryRemoval,
          pendingDuringGrace,
          pendingFromAttemptMetadata,
          probeRevision: state.probeRevision,
          retainedKey: attempt.targetReachabilityKey,
          status: state.status,
          treeRefreshes,
        };
      `,
        context,
      );

      expect(context.__result).toEqual({
        duplicateResume: false,
        duplicateSchedule: false,
        firstSchedule: true,
        notifications: 1,
        pendingAfterRegistryRemoval: true,
        pendingDuringGrace: true,
        pendingFromAttemptMetadata: true,
        probeRevision: 4,
        retainedKey: 'candidate:Target',
        status: 'probing',
        treeRefreshes: 1,
      });
    },
  );

  /** Keeps both minimum-shape modes locked through trace settlement and resumes only their state. */
  it.each(['deterministic-minimum-auto', 'minimum-requirement-dfs'])(
    'serializes and resumes the %s requirement attempt',
    (mode) => {
      const context: { __result?: Record<string, unknown> } = {};
      vm.runInNewContext(
        `
          let notifications = 0;
          let treeRefreshes = 0;
          const state = {
            key: 'candidate:Target',
            probeRevision: 7,
            status: 'filling-requirements',
          };
          const unrelatedState = {
            key: 'candidate:Other',
            probeRevision: 11,
            status: 'probing',
          };
          const attempt = {
            autoMode: ${JSON.stringify(mode)},
            blocker: { id: 'target-reachability:' + state.key },
            traceId: 'trace-requirement',
          };
          const previewInspectorSession = {
            blockerTraceActiveAttempt: attempt,
            renderConditionAutoAttempts: new Map(),
            renderConditions: new Map(),
            targetReachabilityByKey: new Map([
              [state.key, state],
              [unrelatedState.key, unrelatedState],
            ]),
          };
          const notifyPreviewInspector = () => { notifications += 1; };
          const schedulePreviewInspectorTreeRefresh = () => { treeRefreshes += 1; };
          ${createPreviewInspectorTargetAttemptRuntimeSource()}
          const pendingBeforeSettlement = isPreviewInspectorTargetAutoAttemptPending(state);
          const unrelatedPending = isPreviewInspectorTargetAutoAttemptPending(unrelatedState);
          attempt.settledAt = 200;
          const pendingAfterSettlement = isPreviewInspectorTargetAutoAttemptPending(state);
          const scheduled = schedulePreviewInspectorTargetReachabilityResumeAfterAutoAttempt(attempt);
          const duplicateSchedule = schedulePreviewInspectorTargetReachabilityResumeAfterAutoAttempt(
            attempt,
          );
          globalThis.__result = {
            duplicateSchedule,
            notifications,
            pendingAfterSettlement,
            pendingBeforeSettlement,
            probeRevision: state.probeRevision,
            scheduled,
            status: state.status,
            treeRefreshes,
            unrelatedPending,
            unrelatedRevision: unrelatedState.probeRevision,
          };
        `,
        context,
      );

      expect(context.__result).toEqual({
        duplicateSchedule: false,
        notifications: 1,
        pendingAfterSettlement: false,
        pendingBeforeSettlement: true,
        probeRevision: 8,
        scheduled: true,
        status: 'probing',
        treeRefreshes: 1,
        unrelatedPending: false,
        unrelatedRevision: 11,
      });
    },
  );

  /** Rolls back an inert committed JSX gate before resuming the same corridor's DFS. */
  it('rejects a settled target-guided gate with no blocker or target progress', () => {
    const context: { __result?: Record<string, unknown> } = {};
    vm.runInNewContext(
      `
        let notifications = 0;
        let rollbackCalls = 0;
        let treeRefreshes = 0;
        const state = {
          key: 'candidate:Target',
          probeRevision: 2,
          status: 'settling-condition-attempt',
          targetHasOutput: false,
          targetMounted: false,
          targetWasMounted: false,
        };
        const attempt = {
          autoMode: 'target-guided-auto',
          blocker: { id: 'dead-gate' },
          settledAt: 100,
          traceId: 'trace-dead-gate',
        };
        const previewInspectorSession = {
          blockerTraceActiveAttempt: attempt,
          renderConditionAutoAttempts: new Map([[
            attempt.traceId,
            { conditionId: 'dead-gate', reachabilityKey: state.key },
          ]]),
          renderConditions: new Map(),
          targetReachabilityByKey: new Map([[state.key, state]]),
        };
        const rollbackPreviewInspectorNoProgressAutoDecision = (traceId) => {
          rollbackCalls += traceId === attempt.traceId ? 1 : 100;
          return true;
        };
        const notifyPreviewInspector = () => { notifications += 1; };
        const schedulePreviewInspectorTreeRefresh = () => { treeRefreshes += 1; };
        ${createPreviewInspectorTargetAttemptRuntimeSource()}
        const resumed = resumePreviewInspectorTargetReachabilityAfterAutoAttempt(attempt);
        globalThis.__result = {
          handled: attempt.targetReachabilityResumeHandled,
          notifications,
          probeRevision: state.probeRevision,
          resumed,
          rollbackCalls,
          status: state.status,
          treeRefreshes,
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      handled: true,
      notifications: 1,
      probeRevision: 3,
      resumed: true,
      rollbackCalls: 1,
      status: 'probing',
      treeRefreshes: 1,
    });
  });

  /**
   * Retains multi-step JSX gates whenever the commit exposes blockers or reaches the target.
   * Each signal is independently sufficient because later DFS passes may need the new evidence.
   */
  it.each([
    ['changed blocker', "attempt.changedBlockerIds = new Set(['changed'])", ''],
    ['discovered blocker', "attempt.discoveredBlockerIds = new Set(['discovered'])", ''],
    ['resolved blocker', "attempt.resolvedBlockerIds = new Set(['resolved'])", ''],
    ['target mount', '', 'state.targetMounted = true'],
    ['historical target mount', '', 'state.targetWasMounted = true'],
    ['target output', '', 'state.targetHasOutput = true'],
  ])('preserves a settled branch with %s evidence', (_label, attemptSetup, stateSetup) => {
    const context: { __result?: Record<string, unknown> } = {};
    vm.runInNewContext(
      `
        let rollbackCalls = 0;
        const attempt = {
          autoMode: 'target-guided-auto',
          settledAt: 100,
          traceId: 'trace-progress',
        };
        const state = {
          targetHasOutput: false,
          targetMounted: false,
          targetWasMounted: false,
        };
        ${attemptSetup};
        ${stateSetup};
        const previewInspectorSession = {};
        const rollbackPreviewInspectorNoProgressAutoDecision = () => {
          rollbackCalls += 1;
          return true;
        };
        const notifyPreviewInspector = () => undefined;
        const schedulePreviewInspectorTreeRefresh = () => undefined;
        ${createPreviewInspectorTargetAttemptRuntimeSource()}
        const rolledBack = rollbackPreviewInspectorNoProgressTargetAutoAttempt(attempt, state);
        globalThis.__result = { rollbackCalls, rolledBack };
      `,
      context,
    );

    expect(context.__result).toEqual({ rollbackCalls: 0, rolledBack: false });
  });

  /** Prevents an older condition grace timer from resuming after a newer Auto attempt takes over. */
  it('retires a superseded delayed resume without advancing the new corridor attempt', () => {
    const context: { __result?: Record<string, unknown> } = {};
    vm.runInNewContext(
      `
        let notifications = 0;
        let scheduledCallback;
        const state = { key: 'candidate:Target', probeRevision: 5, status: 'advancing' };
        const oldAttempt = {
          autoMode: 'target-guided-auto',
          blocker: { id: 'target-reachability:' + state.key },
          settledAt: 100,
          traceId: 'trace-old',
        };
        const previewInspectorSession = {
          blockerTraceActiveAttempt: oldAttempt,
          renderConditionAutoAttempts: new Map(),
          renderConditions: new Map(),
          targetReachabilityByKey: new Map([[state.key, state]]),
        };
        globalThis.setTimeout = (callback) => { scheduledCallback = callback; return 1; };
        const notifyPreviewInspector = () => { notifications += 1; };
        const schedulePreviewInspectorTreeRefresh = () => undefined;
        ${createPreviewInspectorTargetAttemptRuntimeSource()}
        schedulePreviewInspectorTargetReachabilityResumeAfterAutoAttempt(oldAttempt);
        previewInspectorSession.blockerTraceActiveAttempt = {
          autoMode: 'minimum-requirement-dfs',
          blocker: { id: 'target-reachability:' + state.key },
          traceId: 'trace-new',
        };
        scheduledCallback();
        globalThis.__result = {
          handled: oldAttempt.targetReachabilityResumeHandled,
          notifications,
          probeRevision: state.probeRevision,
          status: state.status,
        };
      `,
      context,
    );

    expect(context.__result).toEqual({
      handled: true,
      notifications: 0,
      probeRevision: 5,
      status: 'advancing',
    });
  });

  /** Captures the reachability key while the render-scoped condition record still exists. */
  it('infers target attempt metadata when the blocker trace is created', () => {
    const context: { __result?: Record<string, unknown> } = {};
    vm.runInNewContext(
      `
        const previewInspectorSession = {
          renderConditionAutoAttempts: new Map(),
          renderConditions: new Map([[
            'gate-a',
            { reachabilityKey: 'candidate:Target' },
          ]]),
        };
        const notifyPreviewInspector = () => undefined;
        const schedulePreviewInspectorTreeRefresh = () => undefined;
        ${createPreviewInspectorTargetAttemptRuntimeSource()}
        const conditionKey = inferPreviewInspectorTargetAutoAttemptReachabilityKey(
          { blockerId: 'gate-a' },
          { id: 'gate-a', kind: 'render-condition' },
        );
        const requirementKey = inferPreviewInspectorTargetAutoAttemptReachabilityKey(
          {},
          { id: 'target-reachability:candidate:Target', kind: 'target-reachability' },
        );
        globalThis.__result = { conditionKey, requirementKey };
      `,
      context,
    );

    expect(context.__result).toEqual({
      conditionKey: 'candidate:Target',
      requirementKey: 'candidate:Target',
    });
  });
});
