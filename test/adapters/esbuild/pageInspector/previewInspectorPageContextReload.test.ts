/** Covers finite exploration across complete document replacement, using real persistence code. */
import { describe, expect, it } from 'vitest';
import {
  createPageContextReloadFixture,
  reloadCandidates,
  reloadFirstCandidate,
  reloadSecondCandidate,
} from './previewInspectorPageContextReloadFixtures';

const output = {
  directTarget: false,
  neuralStableOutputVerified: true,
  pageRootCommitted: true,
  status: 'reached',
  targetHasOutput: true,
  targetMounted: true,
};

/** Replaces the complete JavaScript realm after each genuine host selection request. */
function replayDocuments(): {
  readonly state: Record<string, unknown>;
  readonly transitions: readonly {
    readonly current: string;
    readonly switched: boolean;
    readonly activated: boolean;
    readonly restoredConditions: unknown;
    readonly evaluated: number;
    readonly complete: boolean;
  }[];
} {
  let state: Record<string, unknown> = {};
  let current = reloadFirstCandidate;
  const transitions = [];
  for (let revision = 1; revision <= 6; revision += 1) {
    const fixture = createPageContextReloadFixture(reloadCandidates, '', state);
    fixture.session.selectedPageCandidateId = current.id;
    fixture.setExecutableCandidateId(current.id);
    expect(fixture.record().evaluatedCandidateIds.has(current.id)).toBe(false);
    const activated = fixture.activateContract(current.id);
    const restoredConditions = JSON.parse(JSON.stringify(fixture.autoConditions())) as unknown;
    if (current.id === reloadSecondCandidate.id)
      fixture.setAutoConditions([['extra-condition', true]]);
    expect(fixture.observe(current, { ...output })).toBe(true);
    const switched = fixture.continueCoverage();
    state = fixture.persistedState();
    transitions.push({
      current: current.id,
      switched,
      activated,
      restoredConditions,
      evaluated: fixture.record().evaluatedCandidateIds.size,
      complete: fixture.record().coverageComplete,
    });
    if (!switched) break;
    const next = reloadCandidates.find(
      (candidate) => candidate.id === fixture.requests.at(-1)?.candidateId,
    );
    if (next === undefined) throw new Error('A selection must reference an admitted candidate.');
    current = next;
  }
  return { state, transitions };
}

describe('page-context exploration across document replacement', () => {
  it('restores past verdicts when a retained document readmits a temporarily omitted path', () => {
    const inventory = [...reloadCandidates];
    const fixture = createPageContextReloadFixture(inventory);
    expect(fixture.observe(reloadFirstCandidate, { ...output })).toBe(true);
    fixture.session.selectedPageCandidateId = reloadSecondCandidate.id;
    fixture.setExecutableCandidateId(reloadSecondCandidate.id);
    expect(fixture.observe(reloadSecondCandidate, { ...output })).toBe(true);
    inventory.splice(0, 1);
    expect(fixture.record().successfulCandidateIds.has(reloadFirstCandidate.id)).toBe(false);
    inventory.unshift(reloadFirstCandidate);
    const updates = fixture.model().updates;
    expect(fixture.record().successfulCandidateIds.has(reloadFirstCandidate.id)).toBe(true);
    expect(fixture.record().evaluatedCandidateIds.has(reloadFirstCandidate.id)).toBe(true);
    expect(fixture.model().updates).toBe(updates);
  });

  it('never reuses historical mount evidence for the current readmitted document', () => {
    const inventory = [...reloadCandidates];
    const fixture = createPageContextReloadFixture(inventory);
    expect(fixture.observe(reloadFirstCandidate, { ...output })).toBe(true);
    fixture.session.selectedPageCandidateId = reloadSecondCandidate.id;
    fixture.setExecutableCandidateId(reloadSecondCandidate.id);
    inventory.splice(0, 1);
    fixture.record();
    inventory.unshift(reloadFirstCandidate);
    fixture.session.selectedPageCandidateId = reloadFirstCandidate.id;
    fixture.setExecutableCandidateId(reloadFirstCandidate.id);
    expect(fixture.record().successfulCandidateIds.has(reloadFirstCandidate.id)).toBe(false);
    expect(fixture.record().evaluatedCandidateIds.has(reloadFirstCandidate.id)).toBe(false);
  });

  it('covers both paths, restores the least invasive recipe once, and settles after three renders', () => {
    const { transitions } = replayDocuments();
    expect(transitions).toHaveLength(3);
    expect(transitions.at(-1)).toMatchObject({
      current: reloadFirstCandidate.id,
      switched: false,
      activated: true,
      restoredConditions: [],
      evaluated: 2,
      complete: true,
    });
  });

  it('starts a fresh search when the host changes its immutable input identity', () => {
    const { state } = replayDocuments();
    const changed = createPageContextReloadFixture(reloadCandidates, '', state, 'source-input-two');
    expect(changed.record().evaluatedCandidateIds.size).toBe(0);
    expect(changed.record().successfulCandidateIds.size).toBe(0);
    expect(changed.observe(reloadFirstCandidate, { ...output })).toBe(true);
    expect(changed.continueCoverage()).toBe(true);
    expect(changed.requests.at(-1)?.candidateId).toBe(reloadSecondCandidate.id);
  });

  it('does not restore a different historical path before the requested current path receives a verdict', async () => {
    const first = createPageContextReloadFixture();
    expect(first.observe(reloadFirstCandidate, { ...output })).toBe(true);
    expect(first.continueCoverage()).toBe(true);
    const incoming = createPageContextReloadFixture(reloadCandidates, '', first.persistedState());
    incoming.session.selectedPageCandidateId = reloadSecondCandidate.id;
    incoming.setExecutableCandidateId(reloadSecondCandidate.id);
    incoming.record();
    incoming.activateContract(reloadSecondCandidate.id);
    incoming.schedule();
    await Promise.resolve();
    await Promise.resolve();
    expect(incoming.requests).toEqual([]);
  });

  it('preserves explicit user priority while keeping a newly admitted path unevaluated', () => {
    const { state } = replayDocuments();
    const extra = {
      ...reloadSecondCandidate,
      id: 'third-static-candidate',
      root: { exportName: 'ExtraApp' },
    };
    const expanded = createPageContextReloadFixture([...reloadCandidates, extra], '', state);
    expanded.session.selectedPageCandidateId = extra.id;
    expanded.setExecutableCandidateId(extra.id);
    expect(expanded.record().evaluatedCandidateIds.size).toBe(2);
    expect(expanded.record().coverageComplete).toBe(false);
    expanded.session.userSelectedPageCandidateId = extra.id;
    expect(expanded.observe(extra, { ...output })).toBe(true);
    expect(expanded.continueCoverage()).toBe(false);
    expect(expanded.requests).toEqual([]);
    expect(expanded.record().evaluatedCandidateIds.size).toBe(3);
  });

  it('retains past path verdicts through a temporarily narrower admitted inventory', () => {
    const { state } = replayDocuments();
    const narrow = createPageContextReloadFixture([reloadFirstCandidate], '', state);
    expect(narrow.record().evaluatedCandidateIds.size).toBe(0);
    expect(narrow.observe(reloadFirstCandidate, { ...output })).toBe(true);
    const expanded = createPageContextReloadFixture(reloadCandidates, '', narrow.persistedState());
    expect(expanded.record().evaluatedCandidateIds.has(reloadSecondCandidate.id)).toBe(true);
    expect(expanded.record().evaluatedCandidateIds.has(reloadFirstCandidate.id)).toBe(false);
    expect(expanded.record().successfulCandidateIds.has(reloadFirstCandidate.id)).toBe(false);
  });

  it('ignores malformed and unadmitted persisted verdicts', () => {
    const { state } = replayDocuments();
    const stored = JSON.parse(JSON.stringify(state)) as {
      'react-preview-inspector': {
        pageContextContinuity: { records: { rows: Record<string, unknown>[] }[] };
      };
    };
    const record = stored['react-preview-inspector'].pageContextContinuity.records[0];
    if (record === undefined) throw new Error('Expected a persisted target record.');
    record.rows = [
      { id: 'unadmitted-project-code', outcome: 'verified', stableCount: 1, regressionCount: 0 },
      { id: reloadSecondCandidate.id, outcome: 'verified', stableCount: -1, regressionCount: 0 },
    ];
    const fresh = createPageContextReloadFixture(reloadCandidates, '', stored);
    expect(fresh.record().evaluatedCandidateIds.size).toBe(0);
    expect(fresh.record().successfulCandidateIds.size).toBe(0);
    expect(fresh.record().executionContractByCandidateId.size).toBe(0);
  });

  it('restores the handoff control revision and honors an intervening human change', () => {
    const first = createPageContextReloadFixture();
    first.session.neuralHumanControlRevision = 7;
    expect(first.observe(reloadFirstCandidate, { ...output })).toBe(true);
    expect(first.continueCoverage()).toBe(true);
    const incoming = createPageContextReloadFixture(reloadCandidates, '', first.persistedState());
    incoming.session.selectedPageCandidateId = reloadSecondCandidate.id;
    incoming.setExecutableCandidateId(reloadSecondCandidate.id);
    incoming.record();
    expect(incoming.session.neuralHumanControlRevision).toBe(7);
    incoming.session.neuralHumanControlRevision = 8;
    incoming.setAutoConditions([['human-choice', true]]);
    expect(incoming.activateContract(reloadSecondCandidate.id)).toBe(false);
    expect(incoming.autoConditions()).toEqual([['human-choice', true]]);
  });
});
