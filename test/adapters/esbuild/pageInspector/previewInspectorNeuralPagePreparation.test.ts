/** Exercises preparation recovery through real generated ranking and correlated host transactions. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorPageCandidateRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorPageCandidateRuntimeSource';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';

/** Only the compiler transport and render environment are simulated; selection and model are real. */
function scenario(body: string, alternativeCount = 2): Promise<unknown> {
  return vm.runInNewContext(
    `(async () => {
    const React = { Component: class {} };
    let previewEntryRevision = 7;
    const previewRuntimeRevision = 7;
    let paused = false;
    const candidates = Array.from({ length: ${String(alternativeCount + 1)} }, (_, index) => ({
      id: 'page-' + index, root: { exportName: 'Page' + index },
      target: { exportName: 'Target', sourcePath: '/workspace/Target.tsx' },
      renderPath: { id: 'path-' + index, steps: [{ label: 'Page' + index }] },
    }));
    let descriptor = { exportName: 'Target', inspector: {
      executablePageCandidateId: 'page-0', pageCandidates: candidates, target: candidates[0].target,
    } };
    const previewInspectorSession = {
      interactionSequence: 0, selectedExportName: 'Target', selectedPageCandidateId: 'page-0',
      userSelectedPageCandidateId: '', neuralHumanControlRevision: 0,
    };
    const requests = [];
    const timers = new Map();
    let timerId = 0;
    const setTimeout = (callback) => { timers.set(++timerId, callback); return timerId; };
    const clearTimeout = (id) => timers.delete(id);
    const findSelectedPreviewInspectorDescriptor = () => descriptor;
    const isPreviewInspectorNeuralAssistancePaused = () => paused;
    const notifyPreviewInspector = () => undefined;
    const persistPreviewInspectorState = () => undefined;
    const resetPreviewInspectorTargetReachability = () => undefined;
    const schedulePreviewInspectorCommitRefresh = () => undefined;
    const previewInspectorPostHostMessage = (message) => requests.push(message);
    ${createPreviewInspectorNeuralResidualRuntimeSource()}
    ${createPreviewInspectorPageCandidateRuntimeSource()}
    const record = readPreviewInspectorNeuralPageContextRecord(descriptor);
    record.failedCandidateIds.add('page-0');
    record.evaluatedCandidateIds.add('page-0');
    const next = () => selectPreviewInspectorNeuralPageContextCandidate(descriptor)?.candidate.id;
    const selectNext = () => selectPreviewInspectorPageCandidate(next(), { origin: 'neural-page-context' });
    const status = (extra = {}) => handlePreviewInspectorPageCandidateSelectionStatus({
      type: 'react-preview-inspector-page-candidate-selection-status',
      interactionId: previewInspectorSession.pendingPageCandidateInteractionId,
      candidateId: previewInspectorSession.pendingPageCandidateId,
      displayedRuntimeRevision: previewEntryRevision,
      buildRevision: previewEntryRevision + 1, status: 'failed', reason: 'build-failed', ...extra,
    });
    const beforeModel = JSON.stringify(serializePreviewInspectorNeuralResidualModel());
    ${body}
  })()`,
    {},
    { timeout: 5_000 },
  ) as Promise<unknown>;
}

describe('neural page preparation recovery', () => {
  it('moves past a failed build without repeating it or inventing a render training label', async () => {
    expect(
      await scenario(`
      selectNext(); const failed = requests[0].candidateId;
      status(); await Promise.resolve();
      const retries = Array.from({ length: 20 }, () => next());
      return { requests: requests.length, changed: requests[1]?.candidateId !== failed,
        repeated: retries.includes(failed), evaluated: [...record.evaluatedCandidateIds],
        renderFailures: [...record.failedCandidateIds], successes: record.successfulCandidateIds.size,
        sameModel: beforeModel === JSON.stringify(serializePreviewInspectorNeuralResidualModel()) };
    `),
    ).toEqual({
      requests: 2,
      changed: true,
      repeated: false,
      evaluated: ['page-0'],
      renderFailures: ['page-0'],
      successes: 0,
      sameModel: true,
    });
  });

  it.each([1, 2, 4, 20])(
    'bounds %s unavailable candidates without a build or timer storm',
    async (count) => {
      expect(
        await scenario(
          `
      selectNext();
      for (let index = 0; index < 20; index++) { status(); await Promise.resolve(); }
      return { requests: requests.length, unique: new Set(requests.map((item) => item.candidateId)).size,
        timers: timers.size, next: next(), successes: record.successfulCandidateIds.size };
    `,
          count,
        ),
      ).toEqual({
        requests: Math.min(count, 3),
        unique: Math.min(count, 3),
        timers: 0,
        next: undefined,
        successes: 0,
      });
    },
  );

  it('does not let a provisional saved success bypass a current preparation failure', async () => {
    expect(
      await scenario(`
      selectNext(); const failed = requests[0].candidateId;
      record.provisionalCandidateIds.add(failed);
      status(); await Promise.resolve();
      return { next: next() !== failed, requests: requests.length, successes: record.successfulCandidateIds.size };
    `),
    ).toEqual({ next: true, requests: 2, successes: 0 });
  });

  it.each([
    ['rejected', 'busy'],
    ['cancelled', 'cancelled-by-refresh'],
    ['failed', 'publish-failed'],
    ['failed', 'runtime-timeout'],
    ['failed', 'hot-reload-timeout'],
  ])('does not quarantine or auto-loop after %s / %s', async (state, reason) => {
    expect(
      await scenario(`
      selectNext(); const selected = requests[0].candidateId;
      status({ status: '${state}', reason: '${reason}' }); await Promise.resolve();
      return { requests: requests.length, available: isPreviewInspectorNeuralPagePreparationAvailable(record, selected) };
    `),
    ).toEqual({ requests: 1, available: true });
  });

  it('advances when the host rejects a compiler candidate as unavailable', async () => {
    expect(
      await scenario(`
      selectNext(); status({ status: 'rejected', reason: 'selection-unavailable' }); await Promise.resolve();
      return requests.length;
    `),
    ).toBe(2);
  });

  it.each([
    'paused = true',
    'previewEntryRevision++',
    'previewInspectorSession.neuralHumanControlRevision++',
    "previewInspectorSession.selectedExportName = 'Other'",
    'descriptor = { ...descriptor }',
  ])('drops a queued continuation after ownership changes: %s', async (change) => {
    expect(
      await scenario(`
      selectNext(); status(); ${change}; await Promise.resolve(); return requests.length;
    `),
    ).toBe(1);
  });

  it('preserves a queued manual choice and allows an explicit retry of the failed path', async () => {
    expect(
      await scenario(`
      selectNext(); const failed = requests[0].candidateId;
      const manual = candidates.find((candidate) => !['page-0', failed].includes(candidate.id)).id;
      selectPreviewInspectorPageCandidate(manual, { origin: 'user' });
      status(); await Promise.resolve();
      const requested = requests.map((item) => item.candidateId);
      status({ status: 'cancelled', reason: 'cancelled-by-refresh' });
      selectPreviewInspectorPageCandidate(failed, { origin: 'user' });
      return { queuedHonored: requested[1] === manual, requestCount: requests.length,
        last: requests.at(-1).candidateId === failed, manualSelected: next() === failed };
    `),
    ).toEqual({ queuedHonored: true, requestCount: 3, last: true, manualSelected: true });
  });

  it('rejects stale interaction and source ownership evidence', async () => {
    expect(
      await scenario(`
      selectNext(); const selected = requests[0].candidateId;
      status({ interactionId: 'stale' }); await Promise.resolve();
      previewEntryRevision++;
      status(); await Promise.resolve();
      return { requests: requests.length, available: isPreviewInspectorNeuralPagePreparationAvailable(record, selected) };
    `),
    ).toEqual({ requests: 1, available: true });
  });

  it('does not release an active transaction for a different candidate or a duplicate failure', async () => {
    expect(
      await scenario(`
      selectNext(); const selected = requests[0].candidateId;
      const first = { ...requests[0] };
      status({ candidateId: 'different-page' }); await Promise.resolve();
      const retained = previewInspectorSession.pendingPageCandidateId === selected;
      status(); await Promise.resolve();
      const nextPending = previewInspectorSession.pendingPageCandidateId;
      status({ candidateId: first.candidateId, interactionId: first.interactionId });
      await Promise.resolve();
      return { retained, requests: requests.length,
        nextRetained: previewInspectorSession.pendingPageCandidateId === nextPending };
    `),
    ).toEqual({ retained: true, requests: 2, nextRetained: true });
  });

  it('re-admits preparation failures when a new source artifact replaces the retained revision', async () => {
    expect(
      await scenario(`
      selectNext(); const selected = requests[0].candidateId;
      status(); previewEntryRevision++; await Promise.resolve();
      return { requests: requests.length, available: isPreviewInspectorNeuralPagePreparationAvailable(record, selected) };
    `),
    ).toEqual({ requests: 1, available: true });
  });

  it('never counts host artifact commit alone as neural render success', async () => {
    expect(
      await scenario(`
      selectNext(); status({ status: 'committed', reason: undefined }); await Promise.resolve();
      return { successes: record.successfulCandidateIds.size, phase: record.status,
        sameModel: beforeModel === JSON.stringify(serializePreviewInspectorNeuralResidualModel()) };
    `),
    ).toEqual({ successes: 0, phase: 'verifying', sameModel: true });
  });
});
