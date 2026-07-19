/** Verifies chronological blocker correlation without mounting React or project modules. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorBlockerTraceRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorBlockerTraceRuntimeSource';

/** Minimal event envelope posted by the generated trace runtime. */
interface TraceMessage {
  readonly event: {
    readonly auto?: { readonly mode: string; readonly selectedValue?: unknown };
    readonly blocker?: { readonly id: string; readonly source?: { readonly sourcePath: string } };
    readonly error?: { readonly message: string };
    readonly event: string;
    readonly result?: {
      readonly changedBlockerIds: readonly string[];
      readonly remainingBlockerIds: readonly string[];
      readonly resolvedBlockerIds: readonly string[];
    };
    readonly traceId: string;
  };
  readonly type: string;
}

/** Pure trace functions deliberately exposed only inside the VM fixture. */
interface TraceRuntime {
  readonly advance: (milliseconds: number) => void;
  readonly decide: (candidate: Record<string, unknown>) => string | undefined;
  readonly error: (entry: Record<string, unknown>) => void;
  readonly messages: TraceMessage[];
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
    runtime.snapshot(createSnapshot('smart'));
    runtime.error({
      details: 'TypeError: next missing property',
      level: 'error',
      message: 'next missing property',
      source: 'react-boundary',
    });

    expect(runtime.messages.map((message) => message.event.event)).toEqual([
      'blocker-discovered',
      'auto-selection',
      'render-result',
      'blocker-updated',
      'subsequent-error',
    ]);
    const auto = runtime.messages[1]?.event;
    const result = runtime.messages[2]?.event;
    const error = runtime.messages[4]?.event;
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

  /** Ends causal attachment after the settled grace and suppresses repeated Auto churn for 30s. */
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
    expect(runtime.decide(candidate)).toBeUndefined();
    runtime.snapshot(createSnapshot('settled'));
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
    runtime.advance(29_000);
    expect(runtime.decide(candidate)).not.toBeUndefined();
  });

  /** Requires a stable second observation before claiming that a remounting blocker disappeared. */
  it('does not report a transiently absent error boundary as resolved', () => {
    const runtime = createTraceRuntime();
    runtime.snapshot(createSnapshot('error'));
    runtime.decide({
      action: 'Retry target',
      blockerId: 'hook-form',
      blockerKind: 'target-error',
      mode: 'smart-props',
      selectedValue: {},
      startsRenderAttempt: true,
    });

    runtime.snapshot({ roots: [] });
    expect(runtime.messages.at(-1)?.event.result?.resolvedBlockerIds).toEqual([]);
    expect(runtime.messages.at(-1)?.event.result?.remainingBlockerIds).toEqual(['hook-form']);
    runtime.advance(200);
    runtime.snapshot(createSnapshot('error'));

    expect(
      runtime.messages
        .filter((message) => message.event.event === 'render-result')
        .flatMap((message) => message.event.result?.resolvedBlockerIds ?? []),
    ).not.toContain('hook-form');
  });

  /** Emits resolution only after the blocker remains absent beyond the stability window. */
  it('reports a blocker resolved after two stable absent snapshots', () => {
    const runtime = createTraceRuntime();
    runtime.snapshot(createSnapshot('error'));
    runtime.decide({
      action: 'Retry target',
      blockerId: 'hook-form',
      blockerKind: 'target-error',
      mode: 'smart-props',
      selectedValue: {},
      startsRenderAttempt: true,
    });

    runtime.snapshot({ roots: [] });
    runtime.advance(200);
    runtime.snapshot({ roots: [] });

    const renderResults = runtime.messages.filter(
      (message) => message.event.event === 'render-result',
    );
    expect(renderResults.at(-1)?.event.result?.resolvedBlockerIds).toEqual(['hook-form']);
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
      Date.now = () => currentTime;
      const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
      const messages = [];
      const previewInspectorPostHostMessage = (message) => { messages.push(message); };
      const isPreviewInspectorBlockingNode = () => true;
      const schedulePreviewInspectorTreeRefresh = () => undefined;
      ${createPreviewInspectorBlockerTraceRuntimeSource()}
      globalThis.__runtime = {
        advance: (milliseconds) => { currentTime += milliseconds; },
        decide: recordPreviewInspectorBlockerAutoDecision,
        error: recordPreviewInspectorBlockerTraceError,
        messages,
        snapshot: publishPreviewInspectorBlockerTraceSnapshot,
      };
    `,
    context,
  );
  if (context.__runtime === undefined) throw new Error('Blocker trace fixture did not initialize.');
  return context.__runtime;
}
