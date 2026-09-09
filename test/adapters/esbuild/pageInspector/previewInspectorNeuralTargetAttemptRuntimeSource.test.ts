/** Verifies causal labels through real trace settlement and the synchronous corridor continuation. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorBlockerTraceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorBlockerTraceRuntimeSource';
import { createPreviewInspectorNeuralResidualRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralResidualRuntimeSource';
import { createPreviewInspectorTargetAttemptRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTargetAttemptRuntimeSource';
import type { PreviewInspectorNeuralModel } from '../../../../src/presentation/previewInspectorNeuralModelProtocol';

interface AttemptFixture {
  advance(milliseconds: number): void;
  decide(id: string): string;
  model(): PreviewInspectorNeuralModel;
  readonly rollbacks: string[];
  readonly messages: { event: { event: string; traceId: string; result?: { outcome: string } } }[];
  readonly health: { event: string; detail: { outcome?: string; labelReason?: string } }[];
  readonly state: { status: string; probeRevision: number; targetHasOutput: boolean };
  snapshot(): void;
}

/** Uses production inference, attempt locks, and tracing; only host delivery and renderer effects are inert. */
function createFixture(): AttemptFixture {
  const context = vm.createContext({});
  return vm.runInContext(
    `
    const state = {
      key: 'page:Target', status: 'settling-auto-attempt', probeRevision: 0,
      targetHasOutput: false, targetWasMounted: false, pageRootCommitted: true,
    };
    const previewEntryRevision = 1;
    const previewInspectorSession = {
      selectedExportName: 'Target', selectedPageCandidateId: 'page',
      activeTargetReachabilityKey: state.key,
      targetReachabilityByKey: new Map([[state.key, state]]),
    };
    let currentTime = 1_000;
    const timers = [];
    Date.now = () => currentTime;
    globalThis.setTimeout = (callback, delay = 0) => {
      timers.push({ callback, dueAt: currentTime + delay });
    };
    const messages = [], health = [], rollbacks = [];
    const blockedInspectorPropNames = new Set(['__proto__', 'prototype', 'constructor']);
    const previewInspectorPostHostMessage = (message) => messages.push(message);
    const recordPreviewInspectorRuntimeHealth = (event) => health.push(event);
    const notifyPreviewInspector = () => undefined;
    const schedulePreviewInspectorTreeRefresh = () => undefined;
    const readPreviewInspectorRuntimeCorrelation = () => ({});
    const isPreviewInspectorBlockingNode = () => true;
    const rollbackPreviewInspectorNoProgressAutoDecision = (traceId) => {
      rollbacks.push(traceId);
      state.status = 'recovering-after-rejected-gate';
      return true;
    };
    ${createPreviewInspectorNeuralResidualRuntimeSource()}
    ${createPreviewInspectorTargetAttemptRuntimeSource()}
    ${createPreviewInspectorBlockerTraceRuntimeSource()}
    ({
      advance: (milliseconds) => {
        const deadline = currentTime + milliseconds;
        for (let count = 0; count < 1_000; count += 1) {
          timers.sort((left, right) => left.dueAt - right.dueAt);
          const next = timers[0];
          if (next === undefined || next.dueAt > deadline) { currentTime = deadline; return; }
          timers.shift(); currentTime = next.dueAt; next.callback();
        }
        throw new Error('Unbounded attempt timer loop');
      },
      decide: (id) => recordPreviewInspectorBlockerAutoDecision({
        blockerId: id, blockerKind: 'render-condition',
        mode: 'target-guided-auto', startsRenderAttempt: true,
        targetReachabilityKey: state.key,
        neuralResidualDecision: createPreviewInspectorNeuralResidualDecision({
          candidateId: id, blockerKind: 'render-condition', holeKind: 'condition-activation-order',
        }),
      }),
      model: serializePreviewInspectorNeuralResidualModel,
      messages, health, rollbacks, state,
      snapshot: () => publishPreviewInspectorBlockerTraceSnapshot({ roots: [] }),
    });
  `,
    context,
  ) as AttemptFixture;
}

describe('neural target-attempt settlement', () => {
  it('learns a no-progress rollback once before the next attempt takes over', () => {
    const fixture = createFixture();
    const id = fixture.decide('dead-gate');
    fixture.snapshot();
    fixture.snapshot();
    fixture.advance(320);

    expect(fixture.rollbacks).toEqual([id]);
    expect(fixture.state).toMatchObject({ status: 'probing', probeRevision: 1 });
    expect(fixture.model().updates).toBe(1);
    expect(Object.values(fixture.model().candidateOutcomes)[0]?.lastLabel).toBe(0);
    expect(
      fixture.messages.find((message) => message.event.event === 'render-result')?.event,
    ).toMatchObject({
      traceId: id,
      result: { outcome: 'rolled-back' },
    });
    expect(
      fixture.health.find((entry) => entry.event === 'render-attempt-settled')?.detail.outcome,
    ).toBe('rolled-back');
    expect(fixture.health.some((entry) => entry.detail.labelReason === 'no-target-progress')).toBe(
      true,
    );
    fixture.decide('next-gate');
    expect(fixture.model().updates).toBe(1);
  });

  it('never rolls back or trains an unobserved attempt superseded before commit', () => {
    const fixture = createFixture();
    const oldId = fixture.decide('coalesced-gate');
    fixture.decide('replacement-gate');
    expect(fixture.rollbacks).toEqual([]);
    expect(fixture.model().updates).toBe(0);
    expect(fixture.state.probeRevision).toBe(0);
    expect(
      fixture.messages.find((message) => message.event.event === 'render-result')?.event,
    ).toMatchObject({
      traceId: oldId,
      result: { outcome: 'superseded' },
    });
  });

  it('retains a productive gate and learns only after its stable output observations', () => {
    const fixture = createFixture();
    fixture.state.targetHasOutput = true;
    // A mounted target is required by the independent output verifier.
    Reflect.set(fixture.state, 'targetWasMounted', true);
    fixture.decide('productive-gate');
    fixture.snapshot();
    fixture.snapshot();
    fixture.advance(320);
    expect(fixture.model().updates).toBe(0);
    fixture.advance(320);
    expect(fixture.rollbacks).toEqual([]);
    expect(fixture.model().updates).toBe(1);
    expect(Object.values(fixture.model().candidateOutcomes)[0]?.lastLabel).toBe(1);
    expect(
      fixture.messages.find((message) => message.event.event === 'render-result')?.event.result
        ?.outcome,
    ).toBe('committed');
  });
});
