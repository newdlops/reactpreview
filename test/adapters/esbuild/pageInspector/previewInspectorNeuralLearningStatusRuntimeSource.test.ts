/** Exercises observable learning status independently from project React and feature data. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorNeuralLearningStatusRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorNeuralLearningStatusRuntimeSource';

interface LearningStatus {
  readonly activeCount: number;
  readonly choiceAttempt?: number;
  readonly choiceCount?: number;
  readonly collecting?: boolean;
  readonly phase:
    'applied' | 'applying' | 'learned' | 'learning' | 'needs-choice' | 'paused' | 'unchanged';
  readonly restoring?: boolean;
  readonly successCount?: number;
  readonly updates: number;
  readonly verifying?: boolean;
}

interface LearningStatusFixture {
  begin(detail?: Record<string, unknown>): LearningStatus;
  finish(detail?: Record<string, unknown>): LearningStatus;
  flush(): void;
  read(): LearningStatus | undefined;
  set(status: Record<string, unknown>): LearningStatus | undefined;
  setModelUpdates(updates: number): void;
  sync(event: string, detail?: Record<string, unknown>): void;
}

/** Evaluates renderer-owned progress metadata with a controllable minimum-visible timer. */
function createLearningStatusFixture(): LearningStatusFixture {
  const sandbox: {
    __fixture?: LearningStatusFixture;
    Date: { now(): number };
    clearTimeout(): void;
    now: number;
    queueMicrotask(callback: () => void): void;
    scheduled: (() => void)[];
    setTimeout(callback: () => void): number;
  } = {
    Date: { now: () => sandbox.now },
    clearTimeout: () => undefined,
    now: 1_000,
    queueMicrotask: (callback) => {
      callback();
    },
    scheduled: [],
    setTimeout: (callback) => sandbox.scheduled.push(callback),
  };
  vm.runInNewContext(
    `
      const previewEntryRevision = 7;
      const previewInspectorSession = {
        neuralResidualModel: { heads: {}, updates: 0, version: 3 },
      };
      const notifyPreviewInspector = () => undefined;
      ${createPreviewInspectorNeuralLearningStatusRuntimeSource()}
      globalThis.__fixture = {
        begin: beginPreviewInspectorNeuralLearningStatus,
        finish: finishPreviewInspectorNeuralLearningStatus,
        flush: () => {
          now += 600;
          for (const callback of scheduled.splice(0)) callback();
        },
        read: readPreviewInspectorNeuralLearningStatus,
        set: setPreviewInspectorNeuralLearningStatus,
        setModelUpdates: (updates) => { previewInspectorSession.neuralResidualModel.updates = updates; },
        sync: syncPreviewInspectorNeuralLearningStatusFromHealth,
      };
    `,
    sandbox,
  );
  if (sandbox.__fixture === undefined) {
    throw new Error('Neural learning status fixture did not initialize.');
  }
  return sandbox.__fixture;
}

describe('Preview Inspector neural learning status runtime source', () => {
  it('stays hidden for a neutral model and summarizes restored verified updates', () => {
    const fixture = createLearningStatusFixture();

    expect(fixture.read()).toBeUndefined();
    fixture.setModelUpdates(4);
    expect(fixture.read()).toMatchObject({ phase: 'learned', updates: 4 });
  });

  it('keeps fast learning visible before announcing the verified update', () => {
    const fixture = createLearningStatusFixture();

    fixture.begin({ headKey: 'render-state' });
    expect(fixture.read()).toMatchObject({ activeCount: 1, phase: 'learning', updates: 0 });

    fixture.finish({ modelUpdates: 6, success: true, trainingExamples: 6 });
    expect(fixture.read()).toMatchObject({ activeCount: 0, phase: 'learning', updates: 6 });

    fixture.flush();
    expect(fixture.read()).toMatchObject({ activeCount: 0, phase: 'learned', updates: 6 });
  });

  it('mirrors verifier training that did not start a deferred task', () => {
    const fixture = createLearningStatusFixture();

    fixture.sync('neural-residual-trained', { headKey: 'unrendered', updates: 3 });

    expect(fixture.read()).toMatchObject({ phase: 'learned', updates: 3 });
  });

  it('shows verified table data-flow learning as a learned update', () => {
    const fixture = createLearningStatusFixture();

    fixture.sync('neural-residual-data-flow-trained', {
      headKey: 'rendered-data-collection',
      updates: 5,
    });

    expect(fixture.read()).toMatchObject({
      headKey: 'rendered-data-collection',
      phase: 'learned',
      updates: 5,
    });
  });

  it('retains explicit request phases independently from model training tasks', () => {
    const fixture = createLearningStatusFixture();

    fixture.set({
      activeCount: 0,
      choiceAttempt: 2,
      choiceCount: 3,
      phase: 'applying',
      updates: 7,
    });
    expect(fixture.read()).toMatchObject({
      choiceAttempt: 2,
      choiceCount: 3,
      phase: 'applying',
      updates: 7,
    });

    fixture.set({ activeCount: 0, phase: 'applied', updates: 7 });
    expect(fixture.read()).toMatchObject({ phase: 'applied', updates: 7 });

    fixture.set({ activeCount: 0, phase: 'needs-choice', updates: 7 });
    expect(fixture.read()).toMatchObject({ phase: 'needs-choice', updates: 7 });
  });

  it('retains bounded success collection and restoration progress', () => {
    const fixture = createLearningStatusFixture();

    fixture.set({
      activeCount: 0,
      collecting: true,
      phase: 'applying',
      updates: 7,
      verifying: true,
    });
    expect(fixture.read()).toMatchObject({
      collecting: true,
      phase: 'applying',
      verifying: true,
    });

    fixture.set({
      activeCount: 0,
      collecting: true,
      phase: 'applying',
      successCount: 3,
      updates: 7,
    });
    expect(fixture.read()).toMatchObject({
      collecting: true,
      phase: 'applying',
      restoring: false,
      successCount: 3,
    });

    fixture.set({
      activeCount: 0,
      phase: 'applying',
      restoring: true,
      successCount: 3,
      updates: 7,
    });
    expect(fixture.read()).toMatchObject({
      collecting: false,
      restoring: true,
      successCount: 3,
    });
  });
});
