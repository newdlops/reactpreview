/** Tests render-quality learning and stale-observation rejection with production source and a fake clock. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';
import type { PreviewInspectorNeuralModel } from '../../../../src/presentation/previewInspectorNeuralModelProtocol';

interface Fixture {
  readonly advance: (milliseconds: number) => void;
  readonly assess: (
    attempt: unknown,
    result: unknown,
    deadline?: boolean,
  ) => {
    readonly label?: number;
    readonly pending: boolean;
    readonly targetOutput?: boolean;
  };
  readonly begin: (extra?: Record<string, unknown>) => Record<string, unknown>;
  readonly observe: (attempt: unknown, result: unknown) => unknown;
  readonly reject: (attempt: unknown) => unknown;
  readonly model: () => PreviewInspectorNeuralModel;
  readonly select: (
    specification: unknown,
    candidates: unknown[],
  ) => {
    readonly candidateId: string;
    readonly decision: unknown;
  };
  readonly setHostOutput: (visible: boolean) => void;
  readonly setBlockers: (blockers: unknown[]) => void;
  readonly setRevision: (revision: number) => void;
  readonly setState: (state: Record<string, unknown>, replace?: boolean) => void;
  readonly session: Record<string, unknown>;
}

const committed = {
  outcome: 'committed',
  remainingBlockerIds: [],
  resolvedBlockerIds: ['required-data'],
};

/** Runs a single exact page/target transaction; no authored app, browser, or network is executed. */
function createFixture(): Fixture {
  const context: { fixture?: Fixture } = {};
  vm.runInNewContext(
    `
      let previewEntryRevision = 1;
      let now = 1_000;
      let hostOutput = true;
      let blockers = [];
      const readPreviewInspectorNeuralAssistanceBlockers = () => ({ active: blockers, count: blockers.length });
      const timers = [];
      Date.now = () => now;
      globalThis.setTimeout = (callback, delay) => {
        timers.push({ callback, due: now + delay });
      };
      const key = 'page:Target';
      const previewInspectorSession = {
        activeTargetReachabilityKey: key,
        selectedExportName: 'Target', selectedPageCandidateId: 'page',
        targetReachabilityByKey: new Map([[key, {
          status: 'reached', targetHasOutput: true, targetWasMounted: true,
          pageRootCommitted: true, targetOutputKind: 'target-output',
        }]]),
      };
      const hasPreviewInspectorTargetHostOutput = () => hostOutput;
      ${createPreviewInspectorNeuralResidualRuntimeSource()}
      globalThis.fixture = {
        advance: milliseconds => {
          const deadline = now + milliseconds;
          for (let count = 0; count < 100; count += 1) {
            timers.sort((left, right) => left.due - right.due);
            if (timers.length === 0 || timers[0].due > deadline) break;
            const next = timers.shift(); now = next.due; next.callback();
          }
          now = deadline;
        },
        assess: assessPreviewInspectorNeuralResidualAttempt,
        begin: (extra = {}) => {
          const attempt = {
            blocker: { id: 'required-data' },
            neuralResidualDecision: createPreviewInspectorNeuralResidualDecision({
              candidateId: 'fill-required-data', blockerKind: 'runtime-fallback',
              holeKind: 'unrendered-runtime-value', tokens: ['required:items'],
            }),
            targetReachabilityKey: key, traceId: 'attempt-1', ...extra,
          };
          previewInspectorSession.blockerTraceActiveAttempt = attempt;
          observePreviewInspectorNeuralResidualAttempt(attempt, ${JSON.stringify(committed)});
          return attempt;
        },
        model: serializePreviewInspectorNeuralResidualModel,
        select: selectPreviewInspectorNeuralResidualCandidate,
        observe: observePreviewInspectorNeuralResidualAttempt,
        reject: rejectPreviewInspectorNeuralResidualAttempt,
        session: previewInspectorSession,
        setHostOutput: visible => { hostOutput = visible; },
        setBlockers: value => { blockers = value; },
        setRevision: value => { previewEntryRevision = value; },
        setState: (state, replace = false) => {
          const current = previewInspectorSession.targetReachabilityByKey.get(key);
          if (replace) previewInspectorSession.targetReachabilityByKey.set(key, { ...current, ...state });
          else Object.assign(current, state);
        },
      };
    `,
    context,
  );
  if (context.fixture === undefined) throw new Error('Feedback fixture did not initialize');
  return context.fixture;
}

describe('neural rendering feedback', () => {
  it.each([{ targetHasOutput: false }, { pageRootCommitted: false }, { targetWasMounted: false }])(
    'does not reward a stale reached status: %j',
    (state) => {
      const fixture = createFixture();
      fixture.setState(state);
      const result = fixture.assess({ targetReachabilityKey: 'page:Target' }, committed, true);
      expect(result.targetOutput).toBe(false);
      expect(result.label).toBeLessThan(0.65);
    },
  );

  it('checks real target-owned output even when cached flags say reached', () => {
    const fixture = createFixture();
    fixture.setHostOutput(false);
    fixture.begin();
    fixture.advance(960);
    expect(Object.values(fixture.model().candidateOutcomes)[0]?.lastLabel).toBeLessThan(0.65);
  });

  it('waits for target output instead of treating retained data as a completed render', () => {
    const fixture = createFixture();
    fixture.setState({ status: 'probing', targetHasOutput: false });
    const attempt = fixture.begin({ neuralDataFlowSignal: { calls: 3, truthyReturns: 3 } });
    expect(fixture.model().updates).toBe(0);
    expect(fixture.assess(attempt, committed).pending).toBe(true);
    fixture.advance(960);
    expect(fixture.model().updates).toBe(1);
    expect(Object.values(fixture.model().candidateOutcomes)[0]?.lastLabel).toBeLessThan(0.65);
  });

  it('learns success only after three spaced observations of the same target', () => {
    const fixture = createFixture();
    fixture.begin();
    expect(fixture.model().updates).toBe(0);
    fixture.advance(160);
    expect(fixture.model().updates).toBe(0);
    fixture.advance(160);
    expect(fixture.model().updates).toBe(1);
    expect(Object.values(fixture.model().candidateOutcomes)[0]?.lastLabel).toBe(1);
  });

  it.each(['render-condition', 'data-request', 'runtime-fallback', 'target-error'])(
    'does not teach success for partial output with an active %s',
    (blockerKind) => {
      const fixture = createFixture();
      fixture.setBlockers([{ blockerKind, id: 'still-unresolved' }]);
      fixture.begin({ neuralDataFlowSignal: { calls: 3, truthyReturns: 3 } });
      fixture.advance(960);
      expect(fixture.model().updates).toBe(1);
      expect(Object.values(fixture.model().candidateOutcomes)[0]?.lastLabel).toBeLessThan(0.65);
    },
  );

  it('verifies fresh stable output after the remaining blocker is resolved', () => {
    const fixture = createFixture();
    fixture.setBlockers([{ blockerKind: 'render-condition', id: 'required-choice' }]);
    fixture.begin();
    fixture.advance(320);
    expect(fixture.model().updates).toBe(0);
    fixture.setBlockers([]);
    fixture.advance(320);
    expect(fixture.model().updates).toBe(0);
    fixture.advance(160);
    expect(Object.values(fixture.model().candidateOutcomes)[0]?.lastLabel).toBe(1);
  });

  it('restarts success observations if a new unresolved step appears', () => {
    const fixture = createFixture();
    fixture.begin();
    fixture.advance(160);
    fixture.setBlockers([{ blockerKind: 'data-request', id: 'required-data' }]);
    fixture.advance(160);
    fixture.setBlockers([]);
    fixture.advance(320);
    expect(fixture.model().updates).toBe(0);
    fixture.advance(160);
    expect(Object.values(fixture.model().candidateOutcomes)[0]?.lastLabel).toBe(1);
  });

  it('does not teach success for output that disappears after one frame', () => {
    const fixture = createFixture();
    fixture.begin();
    fixture.setState({ status: 'probing', targetHasOutput: false });
    fixture.advance(960);
    const outcomes = Object.values(fixture.model().candidateOutcomes);
    expect(fixture.model().updates).toBe(1);
    expect(outcomes[0]?.lastLabel).toBeLessThan(0.65);
    expect(outcomes[0]?.rewardSum).toBeLessThan(0.65);
  });

  it('allows a slow render to converge within the existing bounded observation window', () => {
    const fixture = createFixture();
    fixture.setState({ status: 'probing', targetHasOutput: false });
    fixture.begin();
    fixture.advance(480);
    fixture.setState({ status: 'reached', targetHasOutput: true });
    fixture.advance(480);
    expect(fixture.model().updates).toBe(1);
    expect(Object.values(fixture.model().candidateOutcomes)[0]?.lastLabel).toBe(1);
  });

  it('does not call a last-moment flash stable merely because the deadline expires', () => {
    const fixture = createFixture();
    fixture.setState({ status: 'probing', targetHasOutput: false });
    fixture.begin();
    fixture.advance(800);
    fixture.setState({ status: 'reached', targetHasOutput: true });
    fixture.advance(160);
    expect(fixture.model().updates).toBe(0);
  });

  it('restarts stability observations after a gap in actual target output', () => {
    const fixture = createFixture();
    fixture.begin();
    fixture.advance(160);
    fixture.setState({ status: 'probing', targetHasOutput: false });
    fixture.advance(160);
    fixture.setState({ status: 'reached', targetHasOutput: true });
    fixture.advance(320);
    expect(fixture.model().updates).toBe(0);
    fixture.advance(160);
    expect(Object.values(fixture.model().candidateOutcomes)[0]?.lastLabel).toBe(1);
  });

  it('tries another admitted strategy when retained data still cannot render the target', () => {
    const fixture = createFixture();
    const specification = {
      blockerKind: 'runtime-fallback',
      holeKind: 'unrendered-runtime-value',
      tokens: ['required:items'],
    };
    const candidates = [{ id: 'shape-only' }, { id: 'branch-opening' }];
    const selected = fixture.select(specification, candidates);
    expect(selected.candidateId).toBe('shape-only');
    fixture.setState({ status: 'probing', targetHasOutput: false });
    fixture.begin({
      neuralResidualDecision: selected.decision,
      neuralDataFlowSignal: { calls: 3, truthyReturns: 3 },
    });
    fixture.advance(960);
    expect(fixture.select(specification, candidates).candidateId).toBe('branch-opening');
  });

  it.each(['page', 'export', 'target', 'state', 'revision', 'manual', 'attempt'])(
    'does not learn from a superseding %s',
    (change) => {
      const fixture = createFixture();
      fixture.setState({ status: 'probing', targetHasOutput: false });
      fixture.begin();
      if (change === 'page') fixture.session.selectedPageCandidateId = 'different-page';
      if (change === 'export') fixture.session.selectedExportName = 'DifferentTarget';
      if (change === 'target') fixture.session.activeTargetReachabilityKey = 'page:DifferentTarget';
      if (change === 'state') fixture.setState({}, true);
      if (change === 'revision') fixture.setRevision(2);
      if (change === 'manual') fixture.session.neuralHumanControlRevision = 1;
      if (change === 'attempt')
        fixture.session.blockerTraceActiveAttempt = { traceId: 'attempt-2' };
      fixture.setState({ status: 'reached', targetHasOutput: true });
      fixture.advance(960);
      expect(fixture.model().updates).toBe(0);
    },
  );

  it('cancels an already scheduled observation when the attempt is superseded', () => {
    const fixture = createFixture();
    fixture.setState({ status: 'probing', targetHasOutput: false });
    const attempt = fixture.begin();
    fixture.observe(attempt, { outcome: 'superseded' });
    fixture.setState({ status: 'reached', targetHasOutput: true });
    fixture.advance(960);
    expect(fixture.model().updates).toBe(0);
  });

  it('records an immediate fatal rejection once and invalidates delayed success', () => {
    const fixture = createFixture();
    const attempt = fixture.begin();
    fixture.reject(attempt);
    fixture.reject(attempt);
    fixture.advance(960);
    expect(fixture.model().updates).toBe(1);
    expect(Object.values(fixture.model().candidateOutcomes)[0]?.lastLabel).toBe(0);
  });

  it('corrects a verified same-attempt success only once when the caller rejects it', () => {
    const fixture = createFixture();
    const attempt = fixture.begin();
    fixture.advance(320);
    expect(fixture.model().updates).toBe(1);
    fixture.reject(attempt);
    fixture.reject(attempt);
    fixture.advance(960);
    expect(fixture.model().updates).toBe(2);
    expect(Object.values(fixture.model().candidateOutcomes)[0]?.lastLabel).toBe(0);
  });

  it('does not attribute a later page error to an abandoned candidate', () => {
    const fixture = createFixture();
    const attempt = fixture.begin();
    fixture.session.selectedPageCandidateId = 'different-page';
    fixture.reject(attempt);
    fixture.advance(960);
    expect(fixture.model().updates).toBe(0);
  });
});
