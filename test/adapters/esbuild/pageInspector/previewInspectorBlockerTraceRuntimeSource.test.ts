/** Verifies chronological discovery and stable settlement without mounting React or project modules. */
import { describe, expect, it } from 'vitest';
import {
  createSnapshot,
  createTargetErrorSnapshot,
  createTraceRuntime,
  type TraceMessage,
} from './support/previewInspectorBlockerTraceFixture';

describe('Preview Inspector blocker trace runtime source', () => {
  /** Starts proactive repair only after the active blocker has entered the committed tree. */
  it('starts automatic neural assistance from a newly discovered blocker', () => {
    const runtime = createTraceRuntime();
    const snapshot = createTargetErrorSnapshot('ProfileForm', 'variant is unsupported');

    runtime.snapshot(snapshot);
    runtime.snapshot(snapshot);

    expect(runtime.automaticAssistanceEvents).toEqual([
      {
        detail: {
          blockerCount: 1,
          blockerIds: ['target-error:ProfileForm'],
        },
        event: 'blocker-discovered',
      },
    ]);
  });

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

  /** Keeps an unresolved logical corridor visible even before its blocker-tree row is published. */
  it('retains target reachability in a settled no-diff attempt until host output succeeds', () => {
    const runtime = createTraceRuntime();
    const reachabilityKey = 'app-path:DeleteModal';
    runtime.setReachability(reachabilityKey, {
      status: 'filling-requirements',
      targetHasOutput: false,
    });
    const unresolvedTraceId = runtime.decide({
      action: 'Fill target page requirements',
      blockerId: 'target-reachability:' + reachabilityKey,
      mode: 'deterministic-minimum-auto',
      startsRenderAttempt: true,
      targetReachabilityKey: reachabilityKey,
    });
    runtime.snapshot({ roots: [] });
    runtime.snapshot({ roots: [] });
    runtime.advance(320);

    const unresolvedResult = runtime.messages.find(
      (message) =>
        message.event.event === 'render-result' && message.event.traceId === unresolvedTraceId,
    )?.event.result;
    expect(unresolvedResult?.remainingBlockerIds).toEqual([
      'target-reachability:' + reachabilityKey,
    ]);

    runtime.setReachability(reachabilityKey, { status: 'reached', targetHasOutput: true });
    const reachedTraceId = runtime.decide({
      action: 'Verify reached target page',
      blockerId: 'target-reachability:' + reachabilityKey,
      mode: 'deterministic-minimum-auto',
      startsRenderAttempt: true,
      targetReachabilityKey: reachabilityKey,
    });
    runtime.snapshot({ roots: [] });
    runtime.snapshot({ roots: [] });
    runtime.advance(320);

    const reachedResult = runtime.messages.find(
      (message) =>
        message.event.event === 'render-result' && message.event.traceId === reachedTraceId,
    )?.event.result;
    expect(reachedResult?.remainingBlockerIds).toEqual([]);
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
