/** Checks fast no-op recovery against real sweep budgets, render locks, and human cancellation. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralAssistanceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralAssistanceRuntimeSource';
import { createPreviewInspectorTargetAttemptRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetAttemptRuntimeSource';
import { createPreviewInspectorStructureUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorStructureUiRuntimeSource';

/** Uses real scheduling and request code; only the admitted resolver and renderer are controlled. */
function scenario(body: string, productionResolution = false): unknown {
  return vm.runInNewContext(
    `
    let previewEntryRevision = 1, now = 1000, resolverMode = 'noop', calls = 0, runtimeCalls = 0;
    let resolution = 'automatic';
    const frames = [], timers = [], statuses = [];
    const state = { key: 'page:Panel', targetExportName: 'Panel', status: 'page-blocked', directTarget: true };
    const previewInspectorSession = {
      selectedExportName: 'Panel', selectedPageCandidateId: 'page',
      activeTargetReachabilityKey: state.key, targetReachabilityByKey: new Map([[state.key, state]]),
    };
    const nodes = [{ blockerKind: 'data-request', blocker: { id: 'data', mode: 'auto' } }];
    Date.now = () => now;
    globalThis.setTimeout = (callback, delay) => timers.push({ callback, delay });
    const previewInspectorScheduleRuntimeEffectFrame = (callback) => frames.push(callback);
    const notifyPreviewInspector = () => undefined;
    const readPreviewInspectorActiveBlockerSummary = () => ({ active: nodes, count: nodes.length });
    ${productionResolution ? createPreviewInspectorStructureUiRuntimeSource() : 'const readPreviewInspectorResolutionKind = () => resolution;'}
    const readPreviewInspectorNeuralLearningModelUpdates = () => 0;
    const readPreviewInspectorNeuralLearningStatus = () => previewInspectorSession.neuralLearningStatus;
    const setPreviewInspectorNeuralLearningStatus = (status) => {
      statuses.push(status); previewInspectorSession.neuralLearningStatus = status;
    };
    const remountPreviewInspectorExport = () => undefined;
    const smartFillPreviewInspectorDataPayload = () => {
      calls += 1;
      if (resolverMode === 'throw') throw new Error('Resolver unavailable');
      return resolverMode === 'changed';
    };
    const smartFillPreviewInspectorRuntimeFallback = () => { runtimeCalls += 1; return false; };
    ${createPreviewInspectorTargetAttemptRuntimeSource()}
    ${createPreviewInspectorNeuralAssistanceRuntimeSource()}
    const frame = () => frames.splice(0).forEach((callback) => callback());
    const timer = () => { now += 600; timers.splice(0).forEach(({ callback }) => callback()); };
    const request = () => requestPreviewInspectorNeuralAssistance();
    const record = () => [...previewInspectorSession.automaticNeuralAssistanceByKey.values()][0];
    ${body}
  `,
    {},
    { timeout: 5_000 },
  );
}

describe('neural recovery scheduling', () => {
  it.each(['noop', 'throw'])('continues %s without the presentation-only 600ms delay', (mode) => {
    expect(
      scenario(`
      resolverMode = '${mode}'; request(); frame(); frame();
      ({ calls, timers: timers.length, frames: frames.length,
        pending: previewInspectorSession.neuralAssistancePending, phase: statuses.at(-1).phase });
    `),
    ).toEqual({ calls: 1, timers: 0, frames: 1, pending: false, phase: 'applying' });
  });

  it('keeps a changed request visible while render work settles', () => {
    expect(
      scenario(`
      resolverMode = 'changed'; request(); frame(); frame();
      ({ calls, delay: timers[0]?.delay, pending: previewInspectorSession.neuralAssistancePending });
    `),
    ).toEqual({ calls: 1, delay: 600, pending: true });
  });

  it('retains the delay and prevents overlapping attempts after a partial mutation throws', () => {
    expect(
      scenario(`
      resolverMode = 'throw'; request(); frame();
      previewInspectorSession.blockerTraceActiveAttempt = {
        autoMode: 'target-prop-repair-auto', traceId: 'rendering', targetReachabilityKey: state.key,
      };
      frame(); const delay = timers[0]?.delay; timer(); frame(); frame();
      const callsBeforeSettlement = calls;
      previewInspectorSession.blockerTraceActiveAttempt.settledAt = now;
      frame(); frame(); frame();
      ({ delay, callsBeforeSettlement, calls });
    `),
    ).toEqual({ delay: 600, callsBeforeSettlement: 1, calls: 2 });
  });

  it('cancels fast queued retries when the human pauses', () => {
    expect(
      scenario(`
      request(); frame(); frame(); pausePreviewInspectorNeuralAssistance();
      for (let index = 0; index < 8; index += 1) frame();
      ({ calls, scheduled: record().scheduled, paused: isPreviewInspectorNeuralAssistancePaused() });
    `),
    ).toEqual({ calls: 1, scheduled: false, paused: true });
  });

  it('drops a fast continuation after the source revision changes', () => {
    expect(
      scenario(`
      request(); frame(); frame(); previewEntryRevision += 1;
      for (let index = 0; index < 8; index += 1) frame();
      ({ calls, scheduled: record().scheduled });
    `),
    ).toEqual({ calls: 1, scheduled: false });
  });

  it('exhausts the existing per-blocker budget without timer or recursion storms', () => {
    expect(
      scenario(`
      request();
      for (let index = 0; index < 80; index += 1) frame();
      ({ calls, attempts: record().attempts, frames: frames.length, timers: timers.length });
    `),
    ).toEqual({ calls: 6, attempts: 6, frames: 0, timers: 0 });
  });

  it('does not convert a fast no-op into verified success or skip pending output observations', () => {
    expect(
      scenario(`
      request(); frame(); record().successVerificationScheduled = true; frame();
      ({ calls, frames: frames.length, successCount: record().successfulPaths.length,
        verifying: statuses.at(-1).verifying, phase: statuses.at(-1).phase });
    `),
    ).toEqual({ calls: 1, frames: 0, successCount: 0, verifying: true, phase: 'applying' });
  });

  it.each(['request', 'render', 'learning'])(
    'waits for %s without rebuilding the blocker tree',
    (busy) => {
      expect(
        scenario(`
      schedulePreviewInspectorAutomaticNeuralAssistanceFromHealth('blocker-discovered');
      let scans = 0;
      const read = readPreviewInspectorNeuralAssistanceBlockers;
      readPreviewInspectorNeuralAssistanceBlockers = () => { scans++; return read(); };
      ${
        busy === 'request'
          ? 'previewInspectorSession.neuralAssistancePending = true;'
          : busy === 'render'
            ? 'previewInspectorSession.blockerTraceActiveAttempt = { traceId: "pending" };'
            : 'previewInspectorSession.neuralLearningStatus = { phase: "learning", activeCount: 1 };'
      }
      for (let index = 0; index < 240; index++) frame();
      const waiting = { scans, calls, frames: frames.length };
      previewInspectorSession.neuralAssistancePending = false;
      previewInspectorSession.blockerTraceActiveAttempt = undefined;
      previewInspectorSession.neuralLearningStatus = undefined;
      frame(); frame(); frame();
      ({ waiting, calls, rechecked: scans > 0 });
    `),
      ).toEqual({ waiting: { scans: 0, calls: 0, frames: 1 }, calls: 1, rechecked: true });
    },
  );

  it('keeps the hard waiting limit without a blocker-analysis storm', () => {
    expect(
      scenario(`
      schedulePreviewInspectorAutomaticNeuralAssistanceFromHealth('blocker-discovered');
      previewInspectorSession.neuralAssistancePending = true;
      let scans = 0;
      readPreviewInspectorNeuralAssistanceBlockers = () => { scans++; return { active: nodes }; };
      for (let index = 0; index < 600; index++) frame();
      ({ scans, calls, frames: frames.length, scheduled: record().scheduled });
    `),
    ).toEqual({ scans: 0, calls: 0, frames: 0, scheduled: false });
  });

  it.each([
    'selectedPageCandidateId',
    'selectedExportName',
    'activeTargetReachabilityKey',
    'neuralHumanControlRevision',
  ])('rejects a queued request after %s changes', (field) => {
    expect(
      scenario(`
        request(); frame(); previewInspectorSession.${field} = 'changed'; frame();
        ({ calls, pending: previewInspectorSession.neuralAssistancePending, frames: frames.length });
      `),
    ).toEqual({ calls: 0, pending: false, frames: 0 });
  });

  it.each([0, 1])(
    'replans changed evidence after %s preparation frames before applying',
    (frames) => {
      expect(
        scenario(`
      request(); ${frames === 1 ? 'frame();' : ''}
      nodes[0].blocker.requiredPaths = ['payment.currency']; frame();
      const staleCalls = calls;
      for (let index = 0; index < 3; index++) frame();
      ({ staleCalls, calls, identities: record().attemptsByBlocker.size, successCount: record().successfulPaths.length });
    `),
      ).toEqual({ staleCalls: 0, calls: 1, identities: 2, successCount: 0 });
    },
  );

  it('does not apply the previous blocker strategy to a newly revealed blocker family', () => {
    expect(
      scenario(`
      request(); frame();
      nodes.splice(0, 1, { blockerKind: 'runtime-fallback', blocker: { id: 'hook', mode: 'auto' } });
      frame(); const staleRuntimeCalls = runtimeCalls;
      frame(); frame(); frame();
      ({ staleRuntimeCalls, runtimeCalls, calls, identities: record().attemptsByBlocker.size });
    `),
    ).toEqual({ staleRuntimeCalls: 0, runtimeCalls: 1, calls: 0, identities: 2 });
  });

  it('keeps a choice that becomes manual between preparation and application untouched', () => {
    expect(
      scenario(`
      request(); frame(); resolution = 'choice'; nodes[0].blocker.mode = 'custom'; frame();
      for (let index = 0; index < 6; index++) frame();
      ({ calls, pending: previewInspectorSession.neuralAssistancePending });
    `),
    ).toEqual({ calls: 0, pending: false });
  });

  it('executes the final reserved attempt even when real UI availability reports exhaustion', () => {
    expect(
      scenario(
        `
      request();
      // The first request uses two frames, then each continuation uses three. Inspect the last
      // blocker attempt before the independent finite page-generation sweep can start.
      for (let index = 0; index < 17; index++) frame();
      ({ calls, attempts: record().attempts, exhausted: readPreviewInspectorResolutionKind(nodes[0]) });
    `,
        true,
      ),
    ).toEqual({ calls: 6, attempts: 6, exhausted: 'choice' });
  });

  it('rechecks the finite source domain without mistaking reserved progress for exhaustion', () => {
    expect(
      scenario(`
      readPreviewInspectorNeuralFiniteChoiceDomain = () => ({ signature: 'original' });
      const plan = { choiceSignature: 'original', ordinal: 2, attemptLimit: 2 };
      const admitted = isPreviewInspectorNeuralAssistancePlanCurrent(nodes[0], plan);
      readPreviewInspectorNeuralFiniteChoiceDomain = () => ({ signature: 'changed' });
      const changed = isPreviewInspectorNeuralAssistancePlanCurrent(nodes[0], plan);
      readPreviewInspectorNeuralFiniteChoiceDomain = () => undefined;
      ({ admitted, changed, manual: isPreviewInspectorNeuralAssistancePlanCurrent(nodes[0], plan) });
    `),
    ).toEqual({ admitted: true, changed: false, manual: false });
  });

  it('returns an unexecuted finite slot once without refunding the hard budget or later reservations', () => {
    expect(
      scenario(`
      request(); const sweep = record(); const key = [...previewInspectorSession.automaticNeuralAssistanceByKey.keys()][0];
      const plan = { choiceAttemptSignature: 'path:domain', choiceOrdinal: 2 };
      sweep.finiteChoiceAttemptsBySignature.set('path:domain', 2);
      releasePreviewInspectorNeuralFiniteChoiceReservation(plan, key);
      releasePreviewInspectorNeuralFiniteChoiceReservation(plan, key);
      const released = sweep.finiteChoiceAttemptsBySignature.get('path:domain');
      sweep.finiteChoiceAttemptsBySignature.set('path:domain', 2);
      releasePreviewInspectorNeuralFiniteChoiceReservation(plan, key);
      ({ released, newer: sweep.finiteChoiceAttemptsBySignature.get('path:domain'),
        attempts: sweep.attempts, work: sweep.rendererWorkSliceAttempts });
    `),
    ).toEqual({ released: 1, newer: 2, attempts: 1, work: 1 });
  });
});
