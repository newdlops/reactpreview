/** Ensures source-proven user-state waits advance finite coverage without training a render failure. */
import { describe, expect, it } from 'vitest';
import { candidates, createPageContextFixture } from './previewInspectorNeuralPageContextFixture';

/** One current mounted target whose source-proven gate needs actual authored interaction. */
function waitingState(): Record<string, unknown> {
  return {
    awaitingAuthoredStateConditionId: 'selected-movie',
    pageRootCommitted: true,
    status: 'awaiting-authored-state',
    targetHasOutput: false,
    targetMounted: true,
  };
}

describe('authored-state page-context continuation', () => {
  it('tries another admitted caller without learning success or failure for a waiting route', () => {
    const fixture = createPageContextFixture();
    const state = waitingState();
    const first = candidates[0];
    if (first === undefined) throw new Error('Missing first caller.');
    fixture.select();
    const updates = fixture.model().updates;
    expect(fixture.scheduleAuthoredStateContinuation(state)).toBe(true);
    expect(fixture.scheduleAuthoredStateContinuation(state)).toBe(false);
    expect(fixture.requests).toHaveLength(0);
    fixture.runAuthoredStateTimers();

    expect(fixture.record().authoredStateCandidateIds.has(first.id)).toBe(true);
    expect(fixture.record().evaluatedCandidateIds.has(first.id)).toBe(true);
    expect(fixture.record().failedCandidateIds.size).toBe(0);
    expect(fixture.record().successfulCandidateIds.size).toBe(0);
    expect(fixture.model().updates).toBe(updates);
    expect(fixture.requests.at(-1)?.candidateId).toBe(candidates[1]?.id);
  });

  it.each(['manual', 'paused', 'human-revision', 'output-recovered', 'gate-changed'])(
    'does not advance a stale or user-owned wait (%s)',
    (change) => {
      const fixture = createPageContextFixture();
      const state = waitingState();
      fixture.select();
      expect(fixture.scheduleAuthoredStateContinuation(state)).toBe(true);
      if (change === 'manual')
        fixture.session.userSelectedPageCandidateId = candidates[0]?.id ?? '';
      if (change === 'paused') fixture.setPaused(true);
      if (change === 'human-revision') fixture.session.neuralHumanControlRevision = 1;
      if (change === 'output-recovered') state.targetHasOutput = true;
      if (change === 'gate-changed') state.awaitingAuthoredStateConditionId = 'different-gate';
      fixture.runAuthoredStateTimers();

      expect(fixture.record().evaluatedCandidateIds.size).toBe(0);
      expect(fixture.record().authoredStateCandidateIds.size).toBe(0);
      expect(fixture.requests).toHaveLength(0);
      expect(fixture.model().updates).toBe(0);
    },
  );

  it('allows every route to be considered again after explicit viewer input changes', () => {
    const fixture = createPageContextFixture();
    const first = candidates[0];
    if (first === undefined) throw new Error('Missing first caller.');
    fixture.select();
    fixture.scheduleAuthoredStateContinuation(waitingState());
    fixture.runAuthoredStateTimers();
    fixture.session.pendingPageCandidateId = undefined;
    fixture.session.neuralHumanControlRevision = 1;
    expect(fixture.select()?.candidate.id).toBe(first.id);
    expect(fixture.record().authoredStateCandidateIds.size).toBe(0);
    expect(fixture.record().evaluatedCandidateIds.has(first.id)).toBe(false);
  });
});
