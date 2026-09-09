/** Composes real hook fallback, blocker tracing, and render feedback to prevent unverified learning. */
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorBlockerTraceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorBlockerTraceRuntimeSource';
import type { PreviewInspectorNeuralModel } from '../../../../src/presentation/previewInspectorNeuralModelProtocol';
import {
  createMetadata,
  createRuntimeFallbackFixture,
} from './support/previewInspectorRuntimeFallbackFixture';

interface TraceApi {
  advance(milliseconds: number): void;
  error(): void;
  model(): PreviewInspectorNeuralModel;
  setOutput(output: boolean): void;
  takeControl(): void;
  snapshot(): void;
}

/** Reuses the real fallback realm, replacing only clocks, DOM reachability, and rollback boundaries. */
function createFixture(): ReturnType<typeof createRuntimeFallbackFixture> & { trace: TraceApi } {
  const fixture = createRuntimeFallbackFixture(true);
  const trace = fixture.evaluate(`
    const previewHotRuntime = { activeReloadRevision: 0 };
    let currentTime = 1_000;
    const timers = [];
    Date.now = () => currentTime;
    globalThis.setTimeout = (callback, delay = 0) => {
      timers.push({ callback, dueAt: currentTime + Math.max(0, Number(delay) || 0) });
    };
    const targetState = { pageRootCommitted: true, targetWasMounted: true, targetHasOutput: false };
    previewInspectorSession.targetReachabilityByKey = new Map([['page:Target', targetState]]);
    const PREVIEW_INSPECTOR_TARGET_CONDITION_SETTLED_GRACE_MS = 160;
    const previewInspectorPostHostMessage = () => undefined;
    const readPreviewInspectorRuntimeCorrelation = () => ({});
    const rollbackPreviewInspectorFailedAutoDecision = () => true;
    const rollbackPreviewInspectorRequirementAutoDecision = () => true;
    const resumePreviewInspectorTargetReachabilityAfterConditionAttempt = (attempt) => {
      attempt.targetReachabilityResumeHandled = true;
    };
    const inferPreviewInspectorTargetAutoAttemptReachabilityKey = (candidate) => candidate?.targetReachabilityKey;
    const isPreviewInspectorBlockingNode = () => true;
    ${createPreviewInspectorBlockerTraceRuntimeSource()}
    ({
      advance: (milliseconds) => {
        const deadline = currentTime + milliseconds;
        for (let count = 0; count < 1_000; count += 1) {
          timers.sort((left, right) => left.dueAt - right.dueAt);
          const next = timers[0];
          if (next === undefined || next.dueAt > deadline) { currentTime = deadline; return; }
          timers.shift();
          currentTime = next.dueAt;
          next.callback();
        }
        throw new Error('Unexpected unbounded timer loop');
      },
      error: () => recordPreviewInspectorBlockerTraceError({
        level: 'error', message: 'fatal target render failure', source: 'preview-runtime',
      }),
      model: serializePreviewInspectorNeuralResidualModel,
      setOutput: (output) => { targetState.targetHasOutput = output; },
      takeControl: () => {
        previewInspectorSession.neuralHumanControlRevision =
          (previewInspectorSession.neuralHumanControlRevision ?? 0) + 1;
      },
      snapshot: () => publishPreviewInspectorBlockerTraceSnapshot({ roots: [] }),
    });
  `) as TraceApi;
  return { ...fixture, trace };
}

/** Resolves an actual generated callable whose invocations update the attempt-owned signal. */
function resolveFilter(
  fixture: ReturnType<typeof createFixture>,
  id = 'filter',
): { matches(): unknown } {
  return fixture.api.resolve(
    () => {
      throw new Error('filter provider unavailable');
    },
    () => ({ matches: () => undefined }),
    {
      ...createMetadata(),
      id,
      hookName: 'useFilter',
      requiredPaths: ['matches()'],
      smartPathValues: [{ path: 'matches()', role: 'collection-filter-predicate', value: true }],
    },
  ) as { matches(): unknown };
}

/** Completes the trace's existing settlement before the separate neural output observations. */
function settleTrace(trace: TraceApi): void {
  trace.snapshot();
  trace.snapshot();
  trace.advance(320);
}

describe('verified neural fallback learning', () => {
  it('does not count retained rows without target output as a successful render', () => {
    const fixture = createFixture();
    expect(resolveFilter(fixture).matches()).toBe(true);
    fixture.trace.advance(0);
    expect(fixture.trace.model().updates).toBe(0);
    settleTrace(fixture.trace);
    expect(fixture.trace.model().updates).toBe(0);
    fixture.trace.advance(960);
    expect(fixture.trace.model().updates).toBe(1);
    expect(Object.values(fixture.trace.model().candidateOutcomes)).toEqual([
      expect.objectContaining({ lastLabel: 0.2, lastConfidence: 0.2 }),
    ]);
    fixture.trace.advance(960);
    expect(fixture.trace.model().updates).toBe(1);
  });

  it('learns a retained collection once, only after stable target output', () => {
    const fixture = createFixture();
    fixture.trace.setOutput(true);
    resolveFilter(fixture).matches();
    settleTrace(fixture.trace);
    expect(fixture.trace.model().updates).toBe(0);
    fixture.trace.advance(160);
    expect(fixture.trace.model().updates).toBe(0);
    fixture.trace.advance(160);
    expect(fixture.trace.model().updates).toBe(1);
    expect(Object.values(fixture.trace.model().candidateOutcomes)[0]?.lastLabel).toBe(1);
    fixture.trace.advance(960);
    expect(fixture.trace.model().updates).toBe(1);
  });

  it('abstains when a rendered target never called the generated predicate', () => {
    const fixture = createFixture();
    fixture.trace.setOutput(true);
    resolveFilter(fixture);
    settleTrace(fixture.trace);
    fixture.trace.advance(1_920);
    expect(fixture.trace.model().updates).toBe(0);
  });

  it('does not learn from a data-flow signal without a target owner', () => {
    const fixture = createFixture();
    fixture.evaluate('previewInspectorSession.activeTargetReachabilityKey = undefined');
    resolveFilter(fixture).matches();
    settleTrace(fixture.trace);
    fixture.trace.advance(1_920);
    expect(fixture.trace.model().updates).toBe(0);
  });

  it('invalidates old entry closures when the shared hot runtime prepares a newer revision', () => {
    const fixture = createFixture();
    fixture.trace.setOutput(true);
    resolveFilter(fixture).matches();
    settleTrace(fixture.trace);
    fixture.trace.advance(160);
    fixture.evaluate('previewHotRuntime.activeReloadRevision = 1');
    fixture.trace.advance(1_920);
    expect(fixture.trace.model().updates).toBe(0);
  });

  it('records a new attempt when only the generated callable strategy changes', () => {
    const fixture = createFixture();
    resolveFilter(fixture).matches();
    const initialTrace = fixture.evaluate(
      'previewInspectorSession.blockerTraceActiveAttempt.traceId',
    );
    fixture.trace.error();
    expect(fixture.trace.model().updates).toBe(1);
    expect(resolveFilter(fixture).matches()).toBeUndefined();
    expect(fixture.api.read()[0]?.neuralRecommendation?.candidateId).toBe('neutral-callable');
    expect(fixture.evaluate('previewInspectorSession.blockerTraceActiveAttempt.traceId')).not.toBe(
      initialTrace,
    );
    fixture.trace.setOutput(true);
    settleTrace(fixture.trace);
    expect(fixture.trace.model().updates).toBe(2);
    expect(
      Object.values(fixture.trace.model().candidateOutcomes).every(
        (outcome) => outcome.lastLabel === 0,
      ),
    ).toBe(true);
  });

  it('does not credit a superseded fallback after another hook takes the trace', () => {
    const fixture = createFixture();
    fixture.trace.setOutput(true);
    resolveFilter(fixture).matches();
    settleTrace(fixture.trace);
    fixture.trace.advance(160);
    resolveFilter(fixture, 'second-filter').matches();
    fixture.trace.takeControl();
    settleTrace(fixture.trace);
    fixture.trace.advance(1_920);
    expect(fixture.trace.model().updates).toBe(0);
  });

  it('cancels delayed credit when the user takes control', () => {
    const fixture = createFixture();
    fixture.trace.setOutput(true);
    resolveFilter(fixture).matches();
    settleTrace(fixture.trace);
    fixture.trace.advance(160);
    fixture.trace.takeControl();
    fixture.trace.advance(1_920);
    expect(fixture.trace.model().updates).toBe(0);
  });

  it('retains ownership from attempt start when the user intervenes before settlement', () => {
    const fixture = createFixture();
    fixture.trace.setOutput(true);
    resolveFilter(fixture).matches();
    fixture.trace.takeControl();
    fixture.trace.error();
    settleTrace(fixture.trace);
    fixture.trace.advance(1_920);
    expect(fixture.trace.model().updates).toBe(0);
  });

  it('learns a late fatal once and never rewards the obsolete output', () => {
    const fixture = createFixture();
    fixture.trace.setOutput(true);
    resolveFilter(fixture).matches();
    settleTrace(fixture.trace);
    fixture.trace.advance(160);
    fixture.trace.error();
    fixture.trace.advance(1_920);
    expect(fixture.trace.model().updates).toBe(1);
    expect(Object.values(fixture.trace.model().candidateOutcomes)[0]?.lastLabel).toBe(0);
  });

  it('learns identity candidates from render outcomes and can reject the compiler preference', () => {
    const fixture = createFixture();
    const resolveIdentity = (): { value: string } =>
      fixture.api.resolve(
        () => {
          throw new Error('field provider unavailable');
        },
        () => ({ value: 'value' }),
        {
          ...createMetadata(),
          requiredPaths: ['value'],
          semanticValueDemand: { kind: 'identity', path: 'value' },
        },
      ) as { value: string };
    expect(resolveIdentity().value).toBe('preview-id');
    expect(fixture.trace.model().updates).toBe(0);
    fixture.trace.error();
    expect(fixture.trace.model().updates).toBe(1);
    expect(resolveIdentity().value).toBe('value');
    fixture.trace.setOutput(true);
    settleTrace(fixture.trace);
    fixture.trace.advance(320);
    expect(fixture.trace.model().updates).toBe(2);
    expect(
      Object.values(fixture.trace.model().candidateOutcomes)
        .map((outcome) => outcome.lastLabel)
        .sort(),
    ).toEqual([0, 1]);
  });
});
