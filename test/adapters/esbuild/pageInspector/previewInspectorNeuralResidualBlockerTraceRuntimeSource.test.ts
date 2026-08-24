/** Verifies the neural residual's causal bridge through the existing blocker trace verifier. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorBlockerTraceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorBlockerTraceRuntimeSource';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';

interface NeuralTraceFixture {
  readonly advance: (milliseconds: number) => void;
  readonly createDecision: (specification: unknown) => { readonly score: number };
  readonly createSignal: () => {
    calls: number;
    truthyReturns: number;
  };
  readonly decide: (candidate: Record<string, unknown>) => string | undefined;
  readonly error: (entry: Record<string, unknown>) => void;
  readonly modelUpdates: () => number;
  readonly setReachability: (key: string, state: Record<string, unknown>) => void;
  readonly snapshot: (snapshot: Record<string, unknown>) => void;
}

/** Evaluates only the trace, verifier stubs, and the local model in a fake-clock browser realm. */
function createNeuralTraceFixture(): NeuralTraceFixture {
  const context: { __fixture?: NeuralTraceFixture } = {};
  vm.runInNewContext(
    `
      const previewInspectorSession = {
        renderScenario: 'authored-page',
        selectedExportName: 'Target',
        selectedPageCandidateId: 'page',
        targetReachabilityByKey: new Map(),
      };
      const previewEntryRevision = 1;
      let currentTime = 1_000;
      const scheduledTimers = [];
      Date.now = () => currentTime;
      globalThis.setTimeout = (callback, delay = 0) => {
        scheduledTimers.push({ callback, dueAt: currentTime + Math.max(0, Number(delay) || 0) });
      };
      const advance = (milliseconds) => {
        const targetTime = currentTime + milliseconds;
        while (true) {
          scheduledTimers.sort((left, right) => left.dueAt - right.dueAt);
          const next = scheduledTimers[0];
          if (next === undefined || next.dueAt > targetTime) break;
          scheduledTimers.shift();
          currentTime = next.dueAt;
          next.callback();
        }
        currentTime = targetTime;
      };
      const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
      const PREVIEW_INSPECTOR_TARGET_CONDITION_SETTLED_GRACE_MS = 160;
      const previewInspectorPostHostMessage = () => undefined;
      const readPreviewInspectorRuntimeCorrelation = () => ({});
      const rollbackPreviewInspectorFailedAutoDecision = () => true;
      const rollbackPreviewInspectorRequirementAutoDecision = () => true;
      const resumePreviewInspectorTargetReachabilityAfterConditionAttempt = (attempt) => {
        attempt.targetReachabilityResumeHandled = true;
      };
      const inferPreviewInspectorTargetAutoAttemptReachabilityKey = (candidate) =>
        candidate?.targetReachabilityKey;
      const isPreviewInspectorBlockingNode = () => true;
      const schedulePreviewInspectorTreeRefresh = () => undefined;
      const persistPreviewInspectorState = () => undefined;
      ${createPreviewInspectorNeuralResidualRuntimeSource()}
      ${createPreviewInspectorBlockerTraceRuntimeSource()}
      globalThis.__fixture = {
        advance,
        createDecision: createPreviewInspectorNeuralResidualDecision,
        createSignal: () => ({ calls: 0, paths: new Set(['matches']), truthyReturns: 0 }),
        decide: recordPreviewInspectorBlockerAutoDecision,
        error: recordPreviewInspectorBlockerTraceError,
        modelUpdates: () => serializePreviewInspectorNeuralResidualModel().updates,
        setReachability: (key, state) => {
          previewInspectorSession.targetReachabilityByKey.set(key, state);
        },
        snapshot: publishPreviewInspectorBlockerTraceSnapshot,
      };
    `,
    context,
  );
  if (context.__fixture === undefined) throw new Error('Neural trace fixture did not initialize.');
  return context.__fixture;
}

describe('Preview Inspector neural residual blocker trace bridge', () => {
  /** Applies one negative label when a fatal error rolls back an attempt before settlement. */
  it('does not double-train an unsettled rollback', () => {
    const fixture = createNeuralTraceFixture();
    const decision = fixture.createDecision({
      blockerKind: 'render-condition',
      holeKind: 'condition-activation-order',
      texts: ['brokenGate', 'BrokenGate'],
      tokens: ['desired:true'],
    });
    fixture.decide({
      action: 'Advance broken target gate',
      blockerId: 'broken-gate',
      mode: 'target-guided-auto',
      neuralResidualDecision: decision,
      startsRenderAttempt: true,
    });

    fixture.error({
      level: 'error',
      message: 'immediate target gate failure',
      source: 'preview-runtime',
    });

    expect(fixture.modelUpdates()).toBe(1);
  });

  /** Learns a settled success and corrects it if the existing fatal grace window rolls it back. */
  it('trains and corrects the opaque residual through verified trace outcomes', () => {
    const fixture = createNeuralTraceFixture();
    const reachabilityKey = 'page:learned-target';
    fixture.setReachability(reachabilityKey, { status: 'reached', targetHasOutput: true });
    const decision = fixture.createDecision({
      blockerKind: 'render-condition',
      holeKind: 'condition-activation-order',
      texts: ['showTarget', 'TargetGate'],
      tokens: ['desired:true'],
    });
    fixture.decide({
      action: 'Advance learned target gate',
      blockerId: 'target-gate',
      mode: 'target-guided-auto',
      neuralResidualDecision: decision,
      startsRenderAttempt: true,
      targetReachabilityKey: reachabilityKey,
    });

    fixture.snapshot({ roots: [] });
    fixture.snapshot({ roots: [] });
    fixture.advance(320);
    expect(fixture.modelUpdates()).toBe(1);

    fixture.error({
      level: 'error',
      message: 'late target gate failure',
      source: 'preview-runtime',
    });
    expect(fixture.modelUpdates()).toBe(2);
  });

  /** Applies the same late-error correction to a settled minimum-requirement recommendation. */
  it('corrects a settled requirement recommendation when its grace window rejects it', () => {
    const fixture = createNeuralTraceFixture();
    const reachabilityKey = 'page:requirement-target';
    fixture.setReachability(reachabilityKey, { status: 'reached', targetHasOutput: true });
    const decision = fixture.createDecision({
      blockerKind: 'runtime-fallback',
      holeKind: 'blocker-exception-runtime-value',
      texts: ['state.status', 'useAiChatPanel'],
      tokens: ['strategy:shape-only'],
    });
    fixture.decide({
      action: 'Apply the minimum hook requirement',
      blockerId: 'runtime-hole',
      mode: 'minimum-requirement-dfs',
      neuralResidualDecision: decision,
      startsRenderAttempt: true,
      targetReachabilityKey: reachabilityKey,
    });

    fixture.snapshot({ roots: [] });
    fixture.snapshot({ roots: [] });
    fixture.advance(320);
    expect(fixture.modelUpdates()).toBe(1);

    fixture.error({
      level: 'error',
      message: 'late requirement failure',
      source: 'preview-runtime',
    });
    expect(fixture.modelUpdates()).toBe(2);
  });

  /** Uses the live generated-call signal instead of rewarding an unrelated rendered empty state. */
  it('trains a data candidate negatively when its predicate drops every generated row', () => {
    const fixture = createNeuralTraceFixture();
    const reachabilityKey = 'page:data-target';
    const specification = {
      blockerKind: 'runtime-fallback',
      candidateId: 'neutral-callable',
      holeKind: 'rendered-collection-consumer-data',
      tokens: ['role:collection-filter-predicate', 'strategy:neutral-call-result'],
    };
    const decision = fixture.createDecision(specification);
    const signal = fixture.createSignal();
    fixture.setReachability(reachabilityKey, { status: 'reached', targetHasOutput: true });
    fixture.decide({
      action: 'Try a generated filter predicate',
      blockerId: 'round-filter',
      mode: 'neural-data-flow-auto',
      neuralDataFlowSignal: signal,
      neuralResidualDecision: decision,
      startsRenderAttempt: true,
      targetReachabilityKey: reachabilityKey,
    });

    signal.calls = 3;
    fixture.snapshot({ roots: [] });
    fixture.snapshot({ roots: [] });
    fixture.advance(320);

    expect(fixture.modelUpdates()).toBe(1);
    expect(fixture.createDecision(specification).score).toBeLessThan(0.5);
  });
});
