/** Verifies chronological blocker correlation without mounting React or project modules. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorBlockerTraceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorBlockerTraceRuntimeSource';

/** Minimal event envelope posted by the generated trace runtime. */
interface TraceMessage {
  readonly artifactId?: string;
  readonly event: {
    readonly auto?: {
      readonly action?: string;
      readonly mode: string;
      readonly selectedValue?: unknown;
    };
    readonly blocker?: { readonly id: string; readonly source?: { readonly sourcePath: string } };
    readonly error?: { readonly message: string };
    readonly event: string;
    readonly result?: {
      readonly changedBlockerIds: readonly string[];
      readonly outcome?: string;
      readonly remainingBlockerIds: readonly string[];
      readonly resolvedBlockerIds: readonly string[];
    };
    readonly traceId: string;
  };
  readonly runtimeRevision?: number;
  readonly runtimeSessionId?: string;
  readonly type: string;
}

/** Pure trace functions deliberately exposed only inside the VM fixture. */
interface TraceRuntime {
  readonly advance: (milliseconds: number) => void;
  readonly decide: (candidate: Record<string, unknown>) => string | undefined;
  readonly error: (entry: Record<string, unknown>) => void;
  readonly flush: () => void;
  readonly messages: TraceMessage[];
  readonly rollbackCalls: string[];
  readonly rollbacks: string[];
  readonly snapshot: (snapshot: Record<string, unknown>) => void;
}

describe('Preview Inspector blocker trace runtime source', () => {
  /** Links discovery, Auto choice, blocker-set change, and the following error by attempt identity. */
  it('emits one deduplicated chronological resolver flow', () => {
    const runtime = createTraceRuntime();
    runtime.snapshot(createSnapshot('auto'));
    runtime.snapshot(createSnapshot('auto'));

    const traceId = runtime.decide({
      action: 'Smart fill minimum hook value',
      blockerId: 'hook-form',
      blockerKind: 'runtime-fallback',
      blockerName: 'Missing hook value · useFormContext',
      generatedPaths: ['formikProps.values.name'],
      line: 3,
      mode: 'smart',
      ownerName: 'ProfileForm',
      reason: 'property read',
      selectedValue: { formikProps: { values: { name: 'Preview name' } } },
      sourcePath: '/workspace/ProfileForm.tsx',
      startsRenderAttempt: true,
    });
    runtime.snapshot(createSnapshot('auto'));
    runtime.advance(300);
    expect(
      runtime.messages.some(
        (message) => message.event.event === 'render-result' && message.event.traceId === traceId,
      ),
    ).toBe(false);
    runtime.snapshot(createSnapshot('smart'));
    runtime.error({
      details: 'TypeError: next missing property',
      level: 'error',
      message: 'next missing property',
      source: 'react-boundary',
    });
    runtime.advance(20);

    expect(runtime.messages.map((message) => message.event.event)).toEqual([
      'blocker-discovered',
      'auto-selection',
      'blocker-updated',
      'subsequent-error',
      'render-result',
    ]);
    expect(runtime.messages[0]).toMatchObject({
      artifactId: '0123456789abcdef',
      runtimeRevision: 2,
      runtimeSessionId: 'rp-0123456789abcdef01234567',
    });
    const auto = runtime.messages[1]?.event;
    const error = runtime.messages[3]?.event;
    const result = runtime.messages[4]?.event;
    expect(auto).toMatchObject({
      auto: {
        mode: 'smart',
        selectedValue: { formikProps: { values: { name: 'Preview name' } } },
      },
      blocker: {
        id: 'hook-form',
        source: { sourcePath: '/workspace/ProfileForm.tsx' },
      },
    });
    expect(result?.result?.changedBlockerIds).toEqual(['hook-form']);
    expect(result?.result?.resolvedBlockerIds).toEqual([]);
    expect(traceId).toBe(auto?.traceId);
    expect(result?.traceId).toBe(traceId);
    expect(error?.traceId).toBe(traceId);
    expect(error?.error?.message).toBe('next missing property');
    expect(runtime.rollbacks).toEqual([]);
  });

  /** Emits a standalone error trace when no Auto attempt exists, while ignoring ordinary info rows. */
  it('retains fatal boundary errors without tracing unrelated console chatter', () => {
    const runtime = createTraceRuntime();
    runtime.error({ level: 'info', message: 'render started', source: 'console' });
    runtime.error({ level: 'error', message: 'provider missing', source: 'react-boundary' });

    expect(runtime.messages).toHaveLength(1);
    expect(runtime.messages[0]?.event).toMatchObject({
      error: { message: 'provider missing' },
      event: 'subsequent-error',
    });
  });

  /** Does not blame a new JSX decision for the same fatal error already active before it began. */
  it('rolls back only errors that were absent from the attempt baseline', () => {
    const runtime = createTraceRuntime();
    const persistentError = {
      details: 'TypeError: existing provider state is invalid',
      level: 'error',
      message: 'existing provider state is invalid',
      source: 'react-boundary',
    };
    runtime.error(persistentError);
    const traceId = runtime.decide({
      action: 'Advance unrelated overlay',
      blockerId: 'overlay-gate',
      mode: 'target-guided-auto',
      startsRenderAttempt: true,
    });
    runtime.error(persistentError);

    expect(traceId).toBeTypeOf('string');
    expect(runtime.rollbacks).toEqual([]);
    expect(
      runtime.messages.filter((message) => message.event.event === 'subsequent-error'),
    ).toHaveLength(2);
  });

  /** Keeps a sibling gallery boundary in the baseline under its real export, not the selection. */
  it('does not blame a selected gate for a persistent sibling export failure', () => {
    const runtime = createTraceRuntime();
    const siblingError = {
      exportName: 'SiblingPanel',
      level: 'error',
      message: 'persistent sibling provider failure',
      source: 'react-boundary',
    };
    runtime.error(siblingError);
    runtime.snapshot(createTargetErrorSnapshot('SiblingPanel', siblingError.message));
    const traceId = runtime.decide({
      action: 'Advance selected target gate',
      blockerId: 'selected-gate',
      mode: 'target-guided-auto',
      startsRenderAttempt: true,
    });
    runtime.error(siblingError);

    expect(traceId).toBeTypeOf('string');
    expect(runtime.rollbacks).toEqual([]);
  });

  /** Treats a fatal signature as new again after a healthy committed tree removed its boundary. */
  it('rolls back a repeated error after the latest blocker snapshot resolved it', () => {
    const runtime = createTraceRuntime();
    const repeatedError = {
      details: 'TypeError: options.filter is not a function',
      level: 'error',
      message: 'options.filter is not a function',
      source: 'react-boundary',
    };
    runtime.error(repeatedError);
    runtime.snapshot(createSnapshot('healthy'));
    const traceId = runtime.decide({
      action: 'Advance a collection gate',
      blockerId: 'collection-gate',
      mode: 'target-guided-auto',
      startsRenderAttempt: true,
    });
    runtime.error(repeatedError);

    expect(runtime.rollbacks).toEqual([traceId]);
    expect(
      runtime.messages.find(
        (message) => message.event.event === 'render-result' && message.event.traceId === traceId,
      )?.event.result?.outcome,
    ).toBe('rolled-back');
  });

  /** Settles a failed target-guided transaction immediately after its automatic gate is restored. */
  it('publishes a rolled-back result for a newly introduced condition error', () => {
    const runtime = createTraceRuntime();
    const traceId = runtime.decide({
      action: 'Advance target overlay',
      blockerId: 'overlay-gate',
      mode: 'target-guided-auto',
      startsRenderAttempt: true,
    });
    runtime.error({
      level: 'error',
      message: 'options.filter is not a function',
      source: 'react-boundary',
    });

    expect(runtime.rollbacks).toEqual([traceId]);
    expect(
      runtime.messages.find(
        (message) => message.event.event === 'render-result' && message.event.traceId === traceId,
      )?.event.result?.outcome,
    ).toBe('rolled-back');
  });

  /** Keeps a revealed modal open when one of its newly visible descendants throws. */
  it('never rolls back an overlay visibility attempt after a descendant error', () => {
    const runtime = createTraceRuntime();
    const traceId = runtime.decide({
      action: 'Reveal selected overlay target',
      blockerId: 'target-overlay:DeleteModal',
      mode: 'target-overlay-auto',
      startsRenderAttempt: true,
    });
    runtime.error({
      level: 'error',
      message: 'visible modal child needs backend data',
      source: 'react-boundary',
    });

    expect(runtime.rollbackCalls).toEqual([]);
    expect(runtime.rollbacks).toEqual([]);
    expect(runtime.messages.at(-1)?.event).toMatchObject({
      event: 'subsequent-error',
      traceId,
    });
  });

  /** Stops attributing later page errors to a modal reveal after its short settle grace expires. */
  it('bounds a settled overlay reveal to the target-attempt error grace', () => {
    const runtime = createTraceRuntime();
    runtime.snapshot(createSnapshot('hidden-overlay'));
    const traceId = runtime.decide({
      action: 'Reveal selected overlay target',
      blockerId: 'target-overlay:DeleteModal',
      mode: 'target-overlay-auto',
      startsRenderAttempt: true,
    });
    runtime.snapshot(createSnapshot('visible-overlay'));
    runtime.snapshot(createSnapshot('visible-overlay'));
    runtime.advance(320);
    runtime.advance(161);
    runtime.error({
      level: 'error',
      message: 'independent page failure',
      source: 'react-boundary',
    });

    const error = runtime.messages.at(-1)?.event;
    expect(error?.event).toBe('subsequent-error');
    expect(error?.traceId).not.toBe(traceId);
    expect(error?.blocker).toBeUndefined();
  });

  /** Ends causal attachment after the bounded settlement and its short late-error grace. */
  it('bounds attempts to one render settlement instead of a long global time window', () => {
    const runtime = createTraceRuntime();
    runtime.snapshot(createSnapshot('auto'));
    const candidate = {
      action: 'Complete route params',
      blockerId: 'route-params',
      blockerKind: 'runtime-fallback',
      blockerName: 'useParams',
      generatedPaths: ['companyId'],
      mode: 'auto',
      selectedValue: { companyId: 'preview-id' },
      startsRenderAttempt: true,
    };
    const traceId = runtime.decide(candidate);
    runtime.snapshot(createSnapshot('settled'));
    runtime.advance(320);
    runtime.advance(1_001);
    runtime.error({
      level: 'error',
      message: 'independent theme failure',
      source: 'react-boundary',
    });

    const error = runtime.messages.at(-1)?.event;
    expect(error?.event).toBe('subsequent-error');
    expect(error?.traceId).not.toBe(traceId);
    expect(error?.blocker).toBeUndefined();
    expect(runtime.decide(candidate)).not.toBeUndefined();
  });

  /** Requires repeated stable observations before claiming that a remounting blocker disappeared. */
  it('does not report a transiently absent error boundary as resolved', () => {
    const runtime = createTraceRuntime();
    runtime.snapshot(createSnapshot('error'));
    const traceId = runtime.decide({
      action: 'Retry target',
      blockerId: 'hook-form',
      blockerKind: 'target-error',
      mode: 'smart-props',
      selectedValue: {},
      startsRenderAttempt: true,
    });

    runtime.snapshot({ roots: [] });
    expect(
      runtime.messages.filter(
        (message) => message.event.event === 'render-result' && message.event.traceId === traceId,
      ),
    ).toEqual([]);
    runtime.advance(200);
    runtime.snapshot(createSnapshot('error'));
    runtime.advance(120);

    const renderResults = runtime.messages.filter(
      (message) => message.event.event === 'render-result' && message.event.traceId === traceId,
    );
    expect(renderResults).toHaveLength(1);
    expect(renderResults[0]?.event.result).toMatchObject({
      outcome: 'committed',
      remainingBlockerIds: ['hook-form'],
      resolvedBlockerIds: [],
    });
  });

  /** Emits resolution only after the blocker remains absent across a stable observation window. */
  it('reports a blocker resolved after three stable absent snapshots', () => {
    const runtime = createTraceRuntime();
    runtime.snapshot(createSnapshot('error'));
    const traceId = runtime.decide({
      action: 'Retry target',
      blockerId: 'hook-form',
      blockerKind: 'target-error',
      mode: 'smart-props',
      selectedValue: {},
      startsRenderAttempt: true,
    });

    runtime.snapshot({ roots: [] });
    expect(
      runtime.messages.filter(
        (message) => message.event.event === 'render-result' && message.event.traceId === traceId,
      ),
    ).toEqual([]);
    runtime.advance(321);
    runtime.snapshot({ roots: [] });
    expect(
      runtime.messages
        .filter(
          (message) => message.event.event === 'render-result' && message.event.traceId === traceId,
        )
        .flatMap((message) => message.event.result?.resolvedBlockerIds ?? []),
    ).not.toContain('hook-form');
    runtime.snapshot({ roots: [] });

    const renderResults = runtime.messages.filter(
      (message) => message.event.event === 'render-result' && message.event.traceId === traceId,
    );
    expect(renderResults).toHaveLength(1);
    expect(renderResults[0]?.event.result?.resolvedBlockerIds).toEqual(['hook-form']);
  });

  /** Settles a no-diff attempt only after its bounded fake-clock stabilization window. */
  it('commits a no-diff snapshot instead of leaving the active attempt orphaned', () => {
    const runtime = createTraceRuntime();
    runtime.snapshot(createSnapshot('same'));
    const traceId = runtime.decide({
      action: 'Remount unchanged page',
      blockerId: 'hook-form',
      blockerKind: 'runtime-fallback',
      mode: 'auto',
      startsRenderAttempt: true,
    });

    runtime.snapshot(createSnapshot('same'));
    runtime.snapshot(createSnapshot('same'));

    const readRenderResults = (): TraceMessage[] =>
      runtime.messages.filter(
        (message) => message.event.event === 'render-result' && message.event.traceId === traceId,
      );
    expect(readRenderResults()).toEqual([]);
    runtime.advance(319);
    expect(readRenderResults()).toEqual([]);
    runtime.advance(1);

    const renderResults = readRenderResults();
    expect(renderResults).toHaveLength(1);
    expect(renderResults[0]?.event.result).toEqual({
      changedBlockerIds: [],
      discoveredBlockerIds: [],
      outcome: 'committed',
      remainingBlockerIds: ['hook-form'],
      resolvedBlockerIds: [],
    });
  });

  /** Keeps a lone stale observation open for a later remount, then closes it at the hard bound. */
  it('does not let one stale snapshot end the causal trace early', () => {
    const runtime = createTraceRuntime();
    runtime.snapshot(createSnapshot('same'));
    const traceId = runtime.decide({
      action: 'Remount delayed page',
      blockerId: 'hook-form',
      mode: 'auto',
      startsRenderAttempt: true,
    });
    runtime.snapshot(createSnapshot('same'));

    runtime.advance(959);
    expect(
      runtime.messages.some(
        (message) => message.event.event === 'render-result' && message.event.traceId === traceId,
      ),
    ).toBe(false);
    runtime.advance(1);

    expect(
      runtime.messages.filter(
        (message) => message.event.event === 'render-result' && message.event.traceId === traceId,
      ),
    ).toHaveLength(1);
  });

  /** Hard-settles a stalled disappearance when scheduled refreshes never produce another tree. */
  it('closes a pending resolution at the bounded fake-clock deadline', () => {
    const runtime = createTraceRuntime();
    runtime.snapshot(createSnapshot('error'));
    const traceId = runtime.decide({
      action: 'Retry stalled target',
      blockerId: 'hook-form',
      mode: 'smart-props',
      startsRenderAttempt: true,
    });
    runtime.snapshot({ roots: [] });

    runtime.advance(959);
    expect(
      runtime.messages.filter(
        (message) => message.event.event === 'render-result' && message.event.traceId === traceId,
      ),
    ).toEqual([]);
    runtime.advance(1);

    const result = runtime.messages.find(
      (message) => message.event.event === 'render-result' && message.event.traceId === traceId,
    )?.event.result;
    expect(result).toMatchObject({
      outcome: 'committed',
      remainingBlockerIds: ['hook-form'],
      resolvedBlockerIds: [],
    });
  });

  /** Closes a coalesced attempt before a newer Auto mutation becomes the causal owner. */
  it('settles a superseded attempt instead of leaving an orphaned start record', () => {
    const runtime = createTraceRuntime();
    runtime.snapshot(createSnapshot('auto'));
    const firstTraceId = runtime.decide({
      action: 'Fill first gate',
      blockerId: 'first-gate',
      mode: 'auto',
      startsRenderAttempt: true,
    });
    const secondTraceId = runtime.decide({
      action: 'Fill second gate',
      blockerId: 'second-gate',
      mode: 'auto',
      startsRenderAttempt: true,
    });

    const superseded = runtime.messages.find(
      (message) =>
        message.event.event === 'render-result' && message.event.traceId === firstTraceId,
    );
    expect(superseded?.event.result?.outcome).toBe('superseded');
    expect(secondTraceId).not.toBe(firstTraceId);
  });

  /** Treats an identical Smart retry as a fresh render attempt rather than diagnostic chatter. */
  it('creates a new trace for each identical render-producing retry', () => {
    const runtime = createTraceRuntime();
    const retry = {
      action: 'Smart fill target props',
      blockerId: 'target-error',
      mode: 'smart-props',
      selectedValue: { value: 'value' },
      startsRenderAttempt: true,
    };

    const firstTraceId = runtime.decide(retry);
    const secondTraceId = runtime.decide(retry);

    expect(firstTraceId).toBeTypeOf('string');
    expect(secondTraceId).toBeTypeOf('string');
    expect(secondTraceId).not.toBe(firstTraceId);
    expect(
      runtime.messages.filter((message) => message.event.event === 'auto-selection'),
    ).toHaveLength(2);
    expect(
      runtime.messages.find(
        (message) =>
          message.event.event === 'render-result' && message.event.traceId === firstTraceId,
      )?.event.result?.outcome,
    ).toBe('superseded');
  });

  /** Keeps an unstable disappearance pending under the newest attempt after Auto supersession. */
  it('preserves superseded causality while assigning stable resolution to the new attempt', () => {
    const runtime = createTraceRuntime();
    runtime.snapshot(createSnapshot('error'));
    const firstTraceId = runtime.decide({
      action: 'Fill first value',
      blockerId: 'hook-form',
      mode: 'auto',
      startsRenderAttempt: true,
    });
    runtime.snapshot({ roots: [] });
    const secondTraceId = runtime.decide({
      action: 'Fill refined value',
      blockerId: 'hook-form',
      mode: 'smart',
      startsRenderAttempt: true,
    });

    runtime.advance(321);
    runtime.snapshot({ roots: [] });
    runtime.snapshot({ roots: [] });

    const firstResults = runtime.messages.filter(
      (message) =>
        message.event.event === 'render-result' && message.event.traceId === firstTraceId,
    );
    const secondResults = runtime.messages.filter(
      (message) =>
        message.event.event === 'render-result' && message.event.traceId === secondTraceId,
    );
    expect(firstResults).toHaveLength(1);
    expect(firstResults[0]?.event.result?.outcome).toBe('superseded');
    expect(secondResults).toHaveLength(1);
    expect(secondResults[0]?.event.result).toMatchObject({
      outcome: 'committed',
      resolvedBlockerIds: ['hook-form'],
    });
  });

  /** Keeps fallback observations and handled warnings outside commit/error causal chains. */
  it('does not label render-time fallback warnings as failed render attempts', () => {
    const runtime = createTraceRuntime();
    runtime.decide({
      action: 'Substitute failed hook result',
      blockerId: 'hook-query',
      blockerKind: 'runtime-fallback',
      mode: 'auto',
      selectedValue: { data: {} },
    });
    runtime.error({
      level: 'warn',
      message: '[Render-only fallback] useQuery used generated data',
      source: 'runtime-fallback',
    });

    expect(runtime.messages.map((message) => message.event.event)).toEqual(['auto-selection']);
  });

  /** Keeps the 30-second fingerprint suppression only for non-render informational decisions. */
  it('deduplicates identical observational fallback decisions', () => {
    const runtime = createTraceRuntime();
    const observation = {
      action: 'Substitute failed hook result',
      blockerId: 'hook-query',
      mode: 'auto',
      selectedValue: { data: {} },
    };

    const firstTraceId = runtime.decide(observation);
    expect(runtime.decide(observation)).toBeUndefined();
    runtime.flush();

    expect(firstTraceId).toBeTypeOf('string');
    expect(runtime.messages).toHaveLength(1);
  });

  /** Batches fallback observations and excludes already-assisted nodes from unresolved traces. */
  it('keeps broad automatic inference off the render and host logging hot paths', () => {
    const runtime = createTraceRuntime();
    runtime.snapshot(createSnapshot('assisted'));
    runtime.decide({
      action: 'Complete missing hook fields',
      blockerId: 'hook-one',
      blockerKind: 'runtime-fallback',
      blockerName: 'useQuery',
      mode: 'auto',
      selectedValue: { data: { id: 'id' } },
    });
    runtime.decide({
      action: 'Complete missing hook fields',
      blockerId: 'hook-two',
      blockerKind: 'runtime-fallback',
      blockerName: 'useQuery',
      mode: 'auto',
      selectedValue: { data: { name: 'name' } },
    });
    runtime.flush();

    expect(runtime.messages).toHaveLength(1);
    expect(runtime.messages[0]?.event).toMatchObject({
      auto: {
        action: 'Complete missing hook fields × 2',
        selectedValue: { decisionCount: 2, truncatedCount: 0 },
      },
      event: 'auto-selection',
    });
  });
});

/** Creates one blocker tree snapshot whose mode change represents a post-Auto remount. */
function createSnapshot(mode: string): Record<string, unknown> {
  return {
    roots: [
      {
        children: [],
        blocker: { id: 'hook-form', mode, ownerName: 'ProfileForm' },
        blockerId: 'hook-form',
        blockerKind: 'runtime-fallback',
        id: 'runtime-blocker:hook-form',
        kind: 'blocker',
        name: 'Missing hook value · useFormContext',
        props: { mode, requiredPaths: ['formikProps.values.name'] },
        source: { line: 3, path: '/workspace/ProfileForm.tsx' },
        state: { generated: '{"formikProps":{"values":{"name":"Preview name"}}}' },
      },
    ],
  };
}

/** Creates the committed error-boundary evidence used to keep one fatal signature active. */
function createTargetErrorSnapshot(exportName: string, message: string): Record<string, unknown> {
  return {
    roots: [
      {
        blocker: { headline: 'TypeError: ' + message, requiredPaths: [] },
        blockerId: 'target-error:' + exportName,
        blockerKind: 'target-error',
        children: [],
        id: 'target-error:' + exportName,
        kind: 'blocker',
        name: 'Component error · ' + exportName,
        ownerExportName: exportName,
      },
    ],
  };
}

/** Evaluates the generated browser source against inert session and postMessage primitives. */
function createTraceRuntime(): TraceRuntime {
  const context: { __runtime?: TraceRuntime } = {};
  vm.runInNewContext(
    `
      const previewInspectorSession = {
        renderScenario: 'authored-page',
        selectedExportName: 'ProfileForm',
        selectedPageCandidateId: 'app-path',
      };
      const previewEntryRevision = 2;
      let currentTime = 1_000;
      const scheduledTimers = [];
      Date.now = () => currentTime;
      globalThis.setTimeout = (callback, delay = 0) => {
        scheduledTimers.push({ callback, dueAt: currentTime + Math.max(0, Number(delay) || 0) });
        return scheduledTimers.length;
      };
      const advanceClock = (milliseconds) => {
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
      const messages = [];
      const rollbackCalls = [];
      const rollbacks = [];
      const previewInspectorPostHostMessage = (message) => { messages.push(message); };
      const readPreviewInspectorRuntimeCorrelation = () => ({
        artifactId: '0123456789abcdef',
        runtimeRevision: 2,
        runtimeSessionId: 'rp-0123456789abcdef01234567',
      });
      const rollbackPreviewInspectorFailedAutoDecision = (traceId) => {
        rollbackCalls.push(traceId);
        const selection = messages.find(
          (message) => message?.event?.event === 'auto-selection' &&
            message?.event?.traceId === traceId,
        );
        if (selection?.event?.auto?.mode !== 'target-guided-auto') return false;
        rollbacks.push(traceId);
        return true;
      };
      const resumePreviewInspectorTargetReachabilityAfterConditionAttempt = () => false;
      const isPreviewInspectorBlockingNode = (node) => node?.blocker?.mode !== 'assisted';
      const schedulePreviewInspectorTreeRefresh = () => undefined;
      ${createPreviewInspectorBlockerTraceRuntimeSource()}
      globalThis.__runtime = {
        advance: advanceClock,
        decide: recordPreviewInspectorBlockerAutoDecision,
        error: recordPreviewInspectorBlockerTraceError,
        flush: flushPreviewInspectorBlockerTraceAutoDecisions,
        messages,
        rollbackCalls,
        rollbacks,
        snapshot: publishPreviewInspectorBlockerTraceSnapshot,
      };
    `,
    context,
  );
  if (context.__runtime === undefined) throw new Error('Blocker trace fixture did not initialize.');
  return context.__runtime;
}
