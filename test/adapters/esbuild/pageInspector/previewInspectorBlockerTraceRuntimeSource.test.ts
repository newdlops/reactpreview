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
      readonly resolvedBlockerIds: readonly string[];
    };
    readonly traceId: string;
  };
  readonly type: string;
}

/** Pure trace functions deliberately exposed only inside the VM fixture. */
interface TraceRuntime {
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
      const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
      const messages = [];
      const previewInspectorPostHostMessage = (message) => { messages.push(message); };
      const isPreviewInspectorBlockingNode = () => true;
      ${createPreviewInspectorBlockerTraceRuntimeSource()}
      globalThis.__runtime = {
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
