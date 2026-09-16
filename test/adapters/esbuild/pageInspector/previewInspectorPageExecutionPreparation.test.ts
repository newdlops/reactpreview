/** Exercises inner execution preparation through the real browser selector and host controller. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorPageCandidateRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageCandidateRuntimeSource';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';
import { PreviewPanelInspectorSelectionController } from '../../../../src/presentation/previewPanelInspectorSelectionController';
import { createPreviewInspectorTargetReachabilityRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetReachabilityRuntimeSource';

/** Keeps transport, time and Fiber observations controlled; recovery, ranking and host status are real. */
function scenario(body: string, count = 2): Promise<unknown> {
  return vm.runInNewContext(
    `(async () => {
    const React = { Component: class {} };
    let previewEntryRevision = 7;
    const previewRuntimeRevision = 7;
    let paused = false, transportThrows = false, synchronousFailure = false, now = 1000;
    const Date = { now: () => now };
    const candidate = { complete: true, id: 'page', root: { exportName: 'Page' },
      target: { exportName: 'Target', sourcePath: '/workspace/Target.tsx' } };
    let descriptor = { inspector: { executablePageCandidateId: 'page',
      pageCandidates: [candidate, { ...candidate, id: 'manual' }], target: candidate.target,
      pageExecutionCandidateId: 'contextual', pageExecutionCandidates: [
        ...Array.from({ length: ${String(count)} }, (_, index) => ({ id: 'execution-' + index,
          fidelity: 'page-authentic', executionRootExportName: 'Page', pageRootExportName: 'Page' })),
        { id: 'contextual', fidelity: 'target-contextual' },
      ] } };
    const state = { key: 'page:Target', candidateId: 'page', targetExportName: 'Target',
      targetSourcePath: '/workspace/Target.tsx', status: 'reached' };
    const previewInspectorSession = { interactionSequence: 0, selectedExportName: 'Target',
      selectedPageCandidateId: 'page', neuralHumanControlRevision: 0 };
    const requests = [], timers = new Map(), needsChoice = [];
    let timerId = 0;
    const setTimeout = (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; };
    const clearTimeout = (id) => timers.delete(id);
    const expire = () => { const entries = [...timers.entries()];
      for (const [id, timer] of entries) { timers.delete(id); timer.callback(); } };
    const findSelectedPreviewInspectorDescriptor = () => descriptor;
    const readPreviewInspectorTargetReachabilityState = () => state;
    const isPreviewInspectorNeuralAssistancePaused = () => paused;
    const notifyPreviewInspector = () => undefined;
    const persistPreviewInspectorState = () => undefined;
    const resetPreviewInspectorTargetReachability = () => undefined;
    const schedulePreviewInspectorCommitRefresh = () => undefined;
    const restorePreviewInspectorNeuralPageGenerationBaseline = () => true;
    const setPreviewInspectorNeuralNeedsChoiceStatus = (reason) => needsChoice.push(reason);
    const host = new HostController();
    const previewInspectorPostHostMessage = (message) => {
      if (transportThrows) throw new Error('transport unavailable');
      requests.push(message);
      if (synchronousFailure) status({ status: 'rejected', reason: 'busy' });
    };
    ${createPreviewInspectorNeuralResidualRuntimeSource()}
    ${createPreviewInspectorPageCandidateRuntimeSource()}
    readPreviewInspectorPageExecutionContextObservation = () => ({ contextComplete: false,
      pageCandidateComplete: true, fidelity: readSelectedPreviewInspectorPageExecutionCandidate(descriptor).fidelity,
      missingOwnerNames: ['Page'] });
    const request = () => requestPreviewInspectorNeuralPageExecutionContextRecovery(
      descriptor, candidate, state, { fingerprint: 'retained-recipe' });
    const record = () => readPreviewInspectorPageExecutionContextRecoveryRecord(state);
    const status = (extra = {}) => handlePreviewInspectorSelectionStatus({
      type: 'react-preview-inspector-page-candidate-selection-status',
      candidateId: requests.at(-1)?.candidateId, interactionId: requests.at(-1)?.interactionId,
      displayedRuntimeRevision: 7, buildRevision: 8, status: 'failed', reason: 'build-failed', ...extra });
    const admit = () => {
      const admission = host.beginPageCandidate({ ...requests.at(-1),
        type: 'react-preview-inspector-page-candidate-selected' }, 8);
      admission.statuses.forEach(handlePreviewInspectorSelectionStatus);
    };
    const beforeModel = JSON.stringify(serializePreviewInspectorNeuralResidualModel());
    ${body}
  })()`,
    { HostController: PreviewPanelInspectorSelectionController },
    { timeout: 5_000 },
  ) as Promise<unknown>;
}

describe('page execution preparation recovery', () => {
  it('consumes actual host build failure and advances without training on an unrendered artifact', async () => {
    expect(
      await scenario(`
      request(); admit();
      handlePreviewInspectorSelectionStatus(host.failBuild(8, 'build-failed', 7).status);
      await Promise.resolve();
      return { requests: requests.length, changed: requests[0].executionCandidateId !== requests[1]?.executionCandidateId,
        pending: record().pendingExecutionCandidateId === requests[1]?.executionCandidateId,
        outcomes: record().outcomeByExecutionCandidateId.size,
        sameModel: beforeModel === JSON.stringify(serializePreviewInspectorNeuralResidualModel()) };
    `),
    ).toEqual({ requests: 2, changed: true, pending: true, outcomes: 0, sameModel: true });
  });

  it.each([1, 2, 4, 20])(
    'bounds %s alternatives and releases every failed preparation',
    async (count) => {
      expect(
        await scenario(
          `
      request();
      for (let index = 0; index < 20; index++) { status(); await Promise.resolve(); request(); }
      return { requests: requests.length, unique: new Set(requests.map(item => item.executionCandidateId)).size,
        timers: timers.size, pending: isPreviewInspectorNeuralPageExecutionContextTransitionPending(state),
        state: state.status, outcomes: record().outcomeByExecutionCandidateId.size };
    `,
          count,
        ),
      ).toEqual({
        requests: Math.min(count, 3),
        unique: Math.min(count, 3),
        timers: 0,
        pending: false,
        state: 'page-context-incomplete',
        outcomes: 0,
      });
    },
  );

  it.each([false, true])(
    'expires a lost response (accepted: %s) without retrying or learning',
    async (accepted) => {
      expect(
        await scenario(`
      request(); ${accepted ? 'admit();' : ''}
      const delay = [...timers.values()][0]?.delay;
      expire(); await Promise.resolve(); request();
      return { requests: requests.length, delay, timers: timers.size,
        pending: isPreviewInspectorNeuralPageExecutionContextTransitionPending(state), state: state.status,
        sameModel: beforeModel === JSON.stringify(serializePreviewInspectorNeuralResidualModel()) };
    `),
      ).toEqual({
        requests: 1,
        delay: accepted ? 150000 : 5000,
        timers: 0,
        pending: false,
        state: 'page-context-incomplete',
        sameModel: true,
      });
    },
  );

  it('honors a queued manual page choice before any automatic execution continuation', async () => {
    expect(
      await scenario(`
      request(); selectPreviewInspectorPageCandidate('manual', { origin: 'user' });
      if (requests.length !== 1) throw new Error('Manual choice bypassed the pending host build');
      status(); await Promise.resolve();
      return requests.map(item => [item.candidateId, item.type]);
    `),
    ).toEqual([
      ['page', 'react-preview-inspector-page-execution-retry'],
      ['manual', 'react-preview-inspector-page-candidate-selected'],
    ]);
  });

  it.each([
    ['rejected', 'busy'],
    ['cancelled', 'cancelled-by-refresh'],
    ['failed', 'publish-failed'],
    ['failed', 'runtime-timeout'],
    ['failed', 'hot-reload-timeout'],
    ['failed', 'artifact-unchanged'],
    ['failed', 'already-active'],
  ])('does not auto-loop or train after %s / %s', async (state, reason) => {
    expect(
      await scenario(`
      request(); status({ status: '${state}', reason: '${reason}' });
      await Promise.resolve(); request();
      return { requests: requests.length, pending: record().pendingExecutionCandidateId,
        timers: timers.size, state: state.status,
        sameModel: beforeModel === JSON.stringify(serializePreviewInspectorNeuralResidualModel()) };
    `),
    ).toEqual({
      requests: 1,
      pending: undefined,
      timers: 0,
      state: 'page-context-incomplete',
      sameModel: true,
    });
  });

  it('continues past a compiler-unavailable execution without falling back to component-only output', async () => {
    expect(
      await scenario(`
      request(); status({ status: 'rejected', reason: 'selection-unavailable' });
      await Promise.resolve();
      return requests.map(item => item.executionCandidateId);
    `),
    ).toEqual(['execution-0', 'execution-1']);
  });

  it.each([
    'paused = true',
    'previewEntryRevision++',
    'previewInspectorSession.neuralHumanControlRevision++',
    "previewInspectorSession.selectedExportName = 'Other'",
    'descriptor = { ...descriptor }',
    "previewInspectorSession.pendingRouteBranchId = 'manual-route'",
  ])('drops deferred recovery when ownership changes: %s', async (change) => {
    expect(
      await scenario(`
      request(); status(); ${change}; await Promise.resolve();
      return { requests: requests.length, timers: timers.size, pending: record().pendingExecutionCandidateId };
    `),
    ).toEqual({ requests: 1, timers: 0, pending: undefined });
  });

  it('ignores mismatched and duplicate responses and an obsolete timer for the same page', async () => {
    expect(
      await scenario(`
      request(); admit(); const first = requests[0]; const oldTimer = [...timers.values()][0].callback;
      status({ buildRevision: 99 }); status({ interactionId: 'execution:7:stale' });
      status({ candidateId: 'unrelated' }); await Promise.resolve();
      const retained = requests.length === 1 && record().pendingExecutionCandidateId === first.executionCandidateId;
      status(); await Promise.resolve(); oldTimer();
      status({ interactionId: first.interactionId }); await Promise.resolve();
      return { retained, requests: requests.length, timers: timers.size,
        pending: record().pendingExecutionCandidateId === requests[1].executionCandidateId };
    `),
    ).toEqual({ retained: true, requests: 2, timers: 1, pending: true });
  });

  it('does not mistake host commit or generic ready progress for a live execution acknowledgement', async () => {
    expect(
      await scenario(`
      request(); admit(); status({ status: 'committed', reason: undefined });
      handlePreviewInspectorSelectionStatus({ type: 'react-preview-progress', revision: 8, complete: true, stage: 'ready' });
      const waiting = isPreviewInspectorNeuralPageExecutionContextTransitionPending(state) && timers.size === 1;
      descriptor = { ...descriptor, inspector: { ...descriptor.inspector,
        pageExecutionCandidateId: requests[0].executionCandidateId } };
      previewEntryRevision++;
      activatePreviewInspectorNeuralPageExecutionContextRecovery(descriptor);
      await Promise.resolve();
      return { waiting, phase: record().status, timers: timers.size,
        outcomes: record().outcomeByExecutionCandidateId.size,
        sameModel: beforeModel === JSON.stringify(serializePreviewInspectorNeuralResidualModel()) };
    `),
    ).toEqual({ waiting: true, phase: 'verifying', timers: 0, outcomes: 0, sameModel: true });
  });

  it('expires a committed transaction whose descriptor never arrives', async () => {
    expect(
      await scenario(`
      request(); admit(); status({ status: 'committed', reason: undefined }); expire();
      await Promise.resolve(); request();
      return { requests: requests.length, state: state.status, timers: timers.size, phase: record().status };
    `),
    ).toEqual({
      requests: 1,
      state: 'page-context-incomplete',
      timers: 0,
      phase: 'preparation-blocked',
    });
  });

  it.each(['committed', 'ready'])(
    'waits for host %s before releasing an already installed descriptor to manual work',
    async (terminal) => {
      expect(
        await scenario(`
      request(); admit(); selectPreviewInspectorPageCandidate('manual', { origin: 'user' });
      descriptor.inspector.pageExecutionCandidateId = requests[0].executionCandidateId;
      previewEntryRevision++;
      activatePreviewInspectorNeuralPageExecutionContextRecovery(descriptor);
      await Promise.resolve();
      const queued = requests.length === 1 && previewInspectorSession.queuedPageCandidateId === 'manual';
      ${
        terminal === 'committed'
          ? "status({ status: 'committed', reason: undefined });"
          : "handlePreviewInspectorSelectionStatus({ type: 'react-preview-progress', revision: 8, complete: true, stage: 'ready' });"
      }
      await Promise.resolve();
      return { queued, requests: requests.length, next: requests[1]?.candidateId, phase: record().status };
    `),
      ).toEqual({ queued: true, requests: 2, next: 'manual', phase: 'verifying' });
    },
  );

  it('does not traverse unrelated gates or report exhausted renders after a preparation stop', () => {
    const result: unknown = vm.runInNewContext(`
      const React = { Component: class {} };
      ${createPreviewInspectorTargetReachabilityRuntimeSource()}
      const state = { status: 'reached', exhausted: false };
      function hasMountedPreviewInspectorTarget() { return true; }
      function hasPreviewInspectorTargetRenderError() { return false; }
      function hasPreviewInspectorTargetHostOutput() { return true; }
      function isPreviewInspectorPageExecutionPreparationBlocked() { return true; }
      function createPreviewInspectorTargetGateSearch() { throw new Error('unrelated traversal'); }
      evaluatePreviewInspectorTargetReachability({}, {}, state);
      ({ status: state.status, exhausted: state.exhausted, output: state.targetHasOutput });
    `);
    expect(result).toEqual({ status: 'page-context-incomplete', exhausted: false, output: true });
  });

  it('keeps progress on one absolute settlement deadline', async () => {
    expect(
      await scenario(`
      request(); admit(); const first = [...timers.values()][0].delay;
      now += 10000; status({ status: 'progress' });
      return { first, remaining: [...timers.values()][0].delay, timers: timers.size };
    `),
    ).toEqual({ first: 150000, remaining: 140000, timers: 1 });
  });

  it.each(['transportThrows = true', 'synchronousFailure = true'])(
    'registers pending state before sending and releases a failed handoff: %s',
    async (mode) => {
      expect(
        await scenario(`
        ${mode}; request(); await Promise.resolve();
        return { pending: record().pendingExecutionCandidateId, state: state.status, timers: timers.size };
      `),
      ).toEqual({ pending: undefined, state: 'page-context-incomplete', timers: 0 });
    },
  );

  it('does not rescan or settle the old render while the requested execution is still building', async () => {
    expect(
      await scenario(`
      request();
      readPreviewInspectorPageExecutionContextObservation = () => { throw new Error('unnecessary Fiber scan'); };
      for (let index = 0; index < 20; index++) { request(); requestPreviewInspectorPageExecutionRetry(descriptor, candidate); }
      return { requests: requests.length, outcomes: record().outcomeByExecutionCandidateId.size,
        pending: record().pendingExecutionCandidateId === requests[0].executionCandidateId };
    `),
    ).toEqual({ requests: 1, outcomes: 0, pending: true });
  });

  it('bounds the generic module-load retry even without a neural recovery record', async () => {
    expect(
      await scenario(`
      descriptor.inspector.pageExecutionCandidateId = 'execution-0';
      requestPreviewInspectorPageExecutionRetry(descriptor, candidate); admit();
      status(); await Promise.resolve(); requestPreviewInspectorPageExecutionRetry(descriptor, candidate);
      return { requests: requests.length, record: record(), timers: timers.size,
        pending: previewInspectorSession.pendingPageCandidateId };
    `),
    ).toEqual({ requests: 1, record: undefined, timers: 0, pending: undefined });
  });

  it('allows remaining untried executions after a new artifact, without refilling failed render attempts', async () => {
    expect(
      await scenario(`
      request(); status({ status: 'rejected', reason: 'busy' }); await Promise.resolve();
      previewEntryRevision++; descriptor = { ...descriptor }; request();
      return { requests: requests.length, unique: new Set(requests.map(item => item.executionCandidateId)).size,
        outcomes: record().outcomeByExecutionCandidateId.size };
    `),
    ).toEqual({ requests: 2, unique: 2, outcomes: 0 });
  });
});
