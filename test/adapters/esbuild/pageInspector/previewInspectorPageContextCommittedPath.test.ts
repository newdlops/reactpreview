/** A committed path must receive its own verdict before an older verified path can replace it. */
import { describe, expect, it } from 'vitest';
import { candidates, createPageContextFixture } from './previewInspectorNeuralPageContextFixture';

const firstCandidate = candidates[0];
const secondCandidate = candidates[1];
if (firstCandidate === undefined || secondCandidate === undefined) {
  throw new Error('Expected two page-context candidates.');
}
const first = { ...firstCandidate, complete: true };
const second = { ...secondCandidate, complete: true };
const flush = async (): Promise<void> => {
  await Promise.resolve();
};

/** Supplies a verifier-owned settled state; no new label is manufactured while a path waits. */
function settled(success = true): Record<string, unknown> {
  return {
    directTarget: false,
    exhausted: !success,
    neuralStableOutputVerified: success,
    pageExecutionContext: { contextComplete: true },
    pageRootCommitted: true,
    status: success ? 'reached' : 'page-blocked',
    targetExportName: first.target.exportName,
    targetHasOutput: success,
    targetMounted: true,
  };
}

/** Retains the first page's real success, as a previous runtime would before selecting another. */
function preparedFixture(
  previouslyVerifiedSecond = false,
): ReturnType<typeof createPageContextFixture> {
  const fixture = createPageContextFixture([first, second]);
  if (previouslyVerifiedSecond) {
    fixture.session.selectedPageCandidateId = second.id;
    fixture.setExecutableCandidateId(second.id);
    expect(fixture.observe(second, settled())).toBe(true);
    fixture.session.selectedPageCandidateId = first.id;
    fixture.setExecutableCandidateId(first.id);
  }
  fixture.reconcile();
  expect(fixture.observe(first, settled())).toBe(true);
  expect(fixture.prepareContract(second.id, 'neural')).toBe(true);
  fixture.session.selectedPageCandidateId = second.id;
  fixture.setExecutableCandidateId(second.id);
  return fixture;
}

describe('committed page path verification ownership', () => {
  /** Same-document HMR retains history, unlike a fresh document's existing restoration guard. */
  it.each([false, true])(
    'waits for the committed path, including historical success: %s',
    async (historical) => {
      const fixture = preparedFixture(historical);
      const updates = fixture.model().updates;
      fixture.reconcile();
      await flush();
      fixture.schedule();
      await flush();
      expect(fixture.requests).toEqual([]);
      expect(fixture.record().awaitingCurrentCandidateId).toBe(second.id);
      expect(fixture.model().updates).toBe(updates);
    },
  );

  it('does not use historical coverage to skip current-document verification', async () => {
    const fixture = preparedFixture(true);
    fixture.reconcile();
    await flush();
    expect(fixture.continueCoverage()).toBe(false);
    expect(fixture.requests).toEqual([]);
  });

  it('retains the mounted verified path after both candidates have succeeded', async () => {
    const fixture = preparedFixture(true);
    fixture.reconcile();
    expect(fixture.observe(second, settled())).toBe(true);
    expect(fixture.record().coverageComplete).toBe(true);
    fixture.reconcile();
    await flush();
    expect(fixture.select()?.candidate.id).toBe(second.id);
    expect(fixture.requests).toEqual([]);
  });

  it('still promotes a candidate when no executable page is installed', async () => {
    const fixture = createPageContextFixture([first, second]);
    fixture.setExecutableCandidateId(undefined);
    fixture.schedule();
    await flush();
    expect(fixture.requests).toHaveLength(1);
  });

  it('releases the wait only after a current success verdict', async () => {
    const fixture = preparedFixture();
    fixture.reconcile();
    await flush();
    expect(fixture.observe(second, settled())).toBe(true);
    expect(fixture.record().awaitingCurrentCandidateId).toBeUndefined();
    fixture.schedule();
    await flush();
    expect(fixture.requests).toEqual([]);
    expect(fixture.record().successfulCandidateIds.has(second.id)).toBe(true);
  });

  it('allows recovery after a current terminal failure', async () => {
    const fixture = preparedFixture();
    fixture.reconcile();
    await flush();
    expect(fixture.observe(second, settled(false))).toBe(true);
    expect(fixture.record().awaitingCurrentCandidateId).toBeUndefined();
    expect(fixture.requests.map((request) => request.candidateId)).toEqual([first.id]);
  });

  it('ignores a late verdict owned by the previous path', async () => {
    const fixture = preparedFixture();
    fixture.reconcile();
    expect(fixture.observe(first, settled())).toBe(false);
    await flush();
    expect(fixture.record().awaitingCurrentCandidateId).toBe(second.id);
    expect(fixture.requests).toEqual([]);
  });

  it('does not create a new wait for a same-document reactivation', async () => {
    const fixture = createPageContextFixture([first, second]);
    fixture.reconcile();
    expect(fixture.observe(first, settled())).toBe(true);
    expect(fixture.prepareContract(first.id, 'user')).toBe(true);
    fixture.reconcile();
    await flush();
    expect(fixture.record().awaitingCurrentCandidateId).toBeUndefined();
    expect(fixture.requests).toEqual([]);
  });

  it('reverifies the same candidate after a newly committed source revision', async () => {
    const fixture = createPageContextFixture([first, second]);
    fixture.reconcile();
    expect(fixture.observe(first, settled())).toBe(true);
    expect(fixture.prepareContract(first.id, 'neural')).toBe(true);
    fixture.advanceEntryRevision();
    fixture.reconcile();
    await flush();
    expect(fixture.record().awaitingCurrentCandidateId).toBe(first.id);
    expect(fixture.requests).toEqual([]);
  });
});
