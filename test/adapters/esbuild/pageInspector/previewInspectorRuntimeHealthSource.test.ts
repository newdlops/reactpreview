/** Verifies revision-aware renderer health correlation without mounting React or project modules. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorRuntimeHealthSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRuntimeHealthSource';

/** Minimal host message surface emitted by the generated health runtime. */
interface RuntimeHealthMessage {
  readonly artifactId?: string;
  readonly event: {
    readonly detail?: unknown;
    readonly event: string;
    readonly eventId: string;
    readonly parentEventId?: string;
    readonly revision: number;
    readonly source?: { readonly line?: number; readonly sourcePath: string };
  };
  readonly runtimeRevision?: number;
  readonly runtimeSessionId?: string;
}

/** Generated functions exposed by the isolated VM fixture. */
interface RuntimeHealthFixture {
  readonly automaticEvents: {
    readonly detail: unknown;
    readonly event: string;
    readonly targetErrorRetained?: boolean;
  }[];
  readonly error: (entry: Record<string, unknown>) => void;
  readonly flushScheduledFrames: () => void;
  readonly learningEvents: { readonly detail: unknown; readonly event: string }[];
  readonly messages: RuntimeHealthMessage[];
  readonly reachability: Record<string, unknown>;
  readonly readTargetError: (exportName: string) => Record<string, unknown> | undefined;
  readonly record: (candidate: Record<string, unknown>) => string | undefined;
}

describe('Preview Inspector runtime health source', () => {
  /** Records the selected shell and inferred route as an independent informational decision. */
  it('records page context selection evidence', () => {
    const runtime = createRuntimeHealthFixture();
    runtime.record({
      category: 'page-context',
      detail: {
        evidence: { sourcePath: '/workspace/pages.json' },
        pathname: '/company/1/analysis',
        rootExport: 'CompanyOwnerApp',
      },
      event: 'page-context-selected',
    });

    expect(runtime.messages[0]?.event).toMatchObject({
      event: 'page-context-selected',
      source: { sourcePath: '/workspace/pages.json' },
    });
    expect(runtime.messages[0]).toMatchObject({
      artifactId: '0123456789abcdef',
      runtimeRevision: 3,
      runtimeSessionId: 'rp-0123456789abcdef01234567',
    });
  });

  /** Admits compact page-tree snapshots as first-class informational health decisions. */
  it('records page composition snapshots once per stable renderer-owned detail', () => {
    const runtime = createRuntimeHealthFixture();
    const snapshot = {
      category: 'page-composition',
      detail: {
        applicationPath: ['Application', 'Page', 'Target'],
        statusCounts: { mounted: 3 },
        targetState: { hasOutput: true, mounted: true },
      },
      event: 'page-composition-snapshot',
    };

    runtime.record(snapshot);
    runtime.record(snapshot);

    expect(runtime.messages.map((message) => message.event.event)).toEqual([
      'page-composition-snapshot',
    ]);
  });

  /** Publishes only verifier-owned model updates, never feature vectors or project values. */
  it('records neural residual verifier updates', () => {
    const runtime = createRuntimeHealthFixture();
    runtime.record({
      category: 'neural-residual',
      detail: { holeKind: 'unrendered-runtime-value', label: 1, updates: 2 },
      event: 'neural-residual-trained',
    });

    expect(runtime.messages[0]?.event).toMatchObject({
      detail: { holeKind: 'unrendered-runtime-value', label: 1, updates: 2 },
      event: 'neural-residual-trained',
    });
    expect(runtime.learningEvents).toEqual([
      {
        detail: { holeKind: 'unrendered-runtime-value', label: 1, updates: 2 },
        event: 'neural-residual-trained',
      },
    ]);
    expect(runtime.automaticEvents).toEqual([
      {
        detail: { holeKind: 'unrendered-runtime-value', label: 1, updates: 2 },
        event: 'neural-residual-trained',
      },
    ]);
  });

  /** Makes table/collection call-flow labels visible to both status and automatic assistance. */
  it('records verified neural table data-flow learning', () => {
    const runtime = createRuntimeHealthFixture();
    runtime.record({
      category: 'neural-residual',
      detail: { headKey: 'rendered-data-collection', updates: 5 },
      event: 'neural-residual-data-flow-trained',
    });

    expect(runtime.messages[0]?.event).toMatchObject({
      detail: { headKey: 'rendered-data-collection', updates: 5 },
      event: 'neural-residual-data-flow-trained',
    });
    expect(runtime.automaticEvents).toEqual([
      {
        detail: { headKey: 'rendered-data-collection', updates: 5 },
        event: 'neural-residual-data-flow-trained',
      },
    ]);
  });

  /** Distinguishes inference selection from later verifier-owned training. */
  it('records a compact neural candidate selection', () => {
    const runtime = createRuntimeHealthFixture();
    runtime.record({
      category: 'neural-residual',
      detail: {
        candidateId: 'branch-opening',
        headKey: 'blocker-exception',
        holeKind: 'blocker-exception-runtime-value',
        prediction: 0.5,
        traceId: 'blocker-trace-7',
      },
      event: 'neural-residual-selected',
    });

    expect(runtime.messages[0]?.event).toMatchObject({
      detail: {
        candidateId: 'branch-opening',
        headKey: 'blocker-exception',
      },
      event: 'neural-residual-selected',
    });
  });

  /** Keeps a user request observable without confusing it with a verifier-owned training update. */
  it('records explicit neural assistance separately from learning', () => {
    const runtime = createRuntimeHealthFixture();
    runtime.record({
      category: 'neural-residual',
      detail: {
        action: 'page-path-search',
        modelUpdates: 12,
        requestedBy: 'user',
      },
      event: 'neural-assistance-requested',
    });

    expect(runtime.messages[0]?.event).toMatchObject({
      detail: { action: 'page-path-search', modelUpdates: 12, requestedBy: 'user' },
      event: 'neural-assistance-requested',
    });
    expect(runtime.learningEvents).toEqual([
      {
        detail: { action: 'page-path-search', modelUpdates: 12, requestedBy: 'user' },
        event: 'neural-assistance-requested',
      },
    ]);
  });

  /** Preserves JSON positions while omitting optional object absence from bounded health data. */
  it('omits undefined object members and preserves null and array positions', () => {
    const runtime = createRuntimeHealthFixture();
    runtime.record({
      category: 'page-composition',
      detail: {
        nested: {
          absent: undefined,
          explicitNull: null,
          literal: '[undefined]',
        },
        positional: [undefined, null, { absent: undefined, present: true }],
      },
      event: 'page-composition-snapshot',
    });

    const detail = runtime.messages[0]?.event.detail as
      | {
          readonly nested?: Record<string, unknown>;
          readonly positional?: readonly unknown[];
        }
      | undefined;
    expect(detail?.nested).toEqual({
      explicitNull: null,
      literal: '[undefined]',
    });
    expect(detail?.nested).not.toHaveProperty('absent');
    expect(detail?.positional).toEqual([null, null, { present: true }]);
  });

  /** Emits theme repairs once and links a stack-evidenced fallback to its first runtime error. */
  it('records revision-local health decisions and fallback error ancestry', () => {
    const runtime = createRuntimeHealthFixture();
    const repair = {
      category: 'theme',
      detail: {
        evidence: { line: 4, sourcePath: '/workspace/Header.tsx' },
        path: ['flex', 'rowBetween'],
        resolution: 'exact-root-theme',
      },
      event: 'theme-token-repaired',
    };
    runtime.record(repair);
    runtime.record(repair);
    runtime.error({
      level: 'error',
      message: "Cannot read properties of undefined (reading 'rowBetween')",
      source: 'preview-runtime',
    });
    runtime.error({
      componentStack: 'at ErrorStatus\n at ErrorBoundary',
      level: 'error',
      message: "Cannot read properties of undefined (reading 'black')",
      source: 'react-boundary',
    });

    expect(runtime.messages.map((message) => message.event.event)).toEqual([
      'theme-token-repaired',
      'runtime-error-root',
      'runtime-error-fallback',
    ]);
    expect(runtime.messages[0]?.event).toMatchObject({
      revision: 3,
      source: { line: 4, sourcePath: '/workspace/Header.tsx' },
    });
    expect(runtime.messages[2]?.event.parentEventId).toBe(runtime.messages[1]?.event.eventId);
  });

  /** Coalesces one exception repeated by browser, boundary, and fallback transports. */
  it('records an identical commit failure only once across runtime transports', () => {
    const runtime = createRuntimeHealthFixture();
    const message = 'PreviewInspectorTreeRow(...): Nothing was returned from render.';
    runtime.error({
      level: 'error',
      location: 'entry.js:10:2',
      message,
      source: 'preview-runtime',
    });
    runtime.error({
      componentStack: 'at PreviewInspectorTreeRow\n at PreviewInspectorToolbar',
      level: 'error',
      message,
      source: 'react-boundary',
    });
    runtime.error({
      componentStack: 'at PreviewErrorBoundary',
      level: 'error',
      message,
      source: 'runtime-fallback',
    });

    expect(runtime.messages.map((entry) => entry.event.event)).toEqual(['runtime-error-root']);
  });

  /** Keeps the package's own duplicate-instance warning outside an unrelated error chain. */
  it('records styled-components identity warnings as independent health warnings', () => {
    const runtime = createRuntimeHealthFixture();
    runtime.error({
      level: 'error',
      message: 'Original render failure',
      source: 'preview-runtime',
    });
    runtime.error({
      level: 'warn',
      message: 'It looks like there are several instances of "styled-components" initialized.',
      source: 'console',
    });

    expect(runtime.messages.map((message) => message.event.event)).toEqual([
      'runtime-error-root',
      'styled-components-instance-warning',
    ]);
    expect(runtime.messages[1]?.event.parentEventId).toBeUndefined();
  });

  /** Ignores development-only React diagnostics even when React transports them via console.error. */
  it('does not promote React compatibility warnings to runtime root failures', () => {
    const runtime = createRuntimeHealthFixture();
    runtime.error({
      level: 'error',
      message: 'Warning: findDOMNode is deprecated and will be removed in the next major release.',
      source: 'console',
    });
    runtime.error({
      level: 'error',
      message: 'Warning: Invalid attribute name: %s',
      source: 'console',
    });
    runtime.error({
      level: 'error',
      message: 'AG Grid: error #272 No AG Grid modules are registered!',
      source: 'console',
    });
    runtime.error({
      level: 'error',
      message: 'Warning: Support for defaultProps will be removed from function components.',
      source: 'console',
    });

    expect(runtime.messages).toEqual([]);
  });

  /** Keeps recoverable project console failures visible only in the dedicated Console surface. */
  it('does not treat generic project console errors as failed React commits', () => {
    const runtime = createRuntimeHealthFixture();
    runtime.error({
      level: 'error',
      message: 'native bridge not found',
      source: 'console',
    });
    runtime.error({
      level: 'error',
      message: 'currentPageConfig is undefined',
      source: 'console',
    });

    expect(runtime.messages).toEqual([]);
  });

  /** A root render error invalidates stale reached output and retains its first component owner. */
  it('demotes reached output to a fallback blocker with original owner evidence', () => {
    const runtime = createRuntimeHealthFixture();
    runtime.error({
      componentStack: 'at FiStaManagementApp\n at GlobalErrorBoundary',
      exportName: 'Header',
      level: 'error',
      message: 'Error: Unreachable',
      phase: 'unhandled browser error',
      source: 'preview-runtime',
    });

    expect(runtime.reachability).toMatchObject({
      status: 'runtime-error-output',
      targetHasOutput: false,
      targetOutputKind: 'fallback-output',
      targetOutputRecoveryPending: true,
    });
    expect(runtime.readTargetError('Header')).toMatchObject({
      message: 'Error: Unreachable',
      ownerName: 'FiStaManagementApp',
      phase: 'unhandled browser error',
      source: 'preview-runtime',
    });
    expect(runtime.automaticEvents).toMatchObject([
      {
        event: 'runtime-error-root',
        targetErrorRetained: true,
      },
    ]);
  });

  /** Retries after the React boundary commit when the synchronous blocker read is still stale. */
  it('defers automatic error repair when the first retained-error sweep cannot start', () => {
    const runtime = createRuntimeHealthFixture({ rejectedAutomaticAssistanceCalls: 2 });
    runtime.error({
      componentStack: 'at ResolutionFixture\n at GlobalErrorBoundary',
      exportName: 'Header',
      level: 'error',
      message: 'Error: Unreachable',
      source: 'react-boundary',
    });

    expect(runtime.automaticEvents).toMatchObject([
      {
        event: 'runtime-error-root',
        targetErrorRetained: true,
      },
    ]);

    runtime.flushScheduledFrames();

    expect(runtime.automaticEvents).toMatchObject([
      { event: 'runtime-error-root', targetErrorRetained: true },
      { event: 'runtime-error-root', targetErrorRetained: true },
      { event: 'runtime-error-root', targetErrorRetained: true },
    ]);
  });
});

/** Evaluates generated source with inert session, revision, and postMessage primitives. */
function createRuntimeHealthFixture(
  options: {
    readonly rejectedAutomaticAssistanceCalls?: number;
  } = {},
): RuntimeHealthFixture {
  const context: { __runtime?: RuntimeHealthFixture } = {};
  vm.runInNewContext(
    `
      const previewEntryRevision = 3;
      const reachability = {
        status: 'reached',
        targetExportName: 'Header',
        targetHasOutput: true,
      };
      const previewInspectorSession = {
        neuralAssistancePending: false,
        selectedExportName: 'Header',
        selectedPageCandidateId: 'app-path',
        targetReachabilityByKey: new Map([['target', reachability]]),
      };
      const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
      const messages = [];
      const learningEvents = [];
      const automaticEvents = [];
      const scheduledFrames = [];
      let automaticAssistanceCallCount = 0;
      const syncPreviewInspectorNeuralLearningStatusFromHealth = (event, detail) => {
        learningEvents.push({ detail, event });
      };
      const schedulePreviewInspectorAutomaticNeuralAssistanceFromHealth = (event, detail) => {
        automaticAssistanceCallCount += 1;
        automaticEvents.push({
          detail,
          event,
          ...(event.startsWith('runtime-error-')
            ? {
                targetErrorRetained:
                  previewInspectorSession.runtimeHealthRootErrors instanceof Map &&
                  previewInspectorSession.runtimeHealthRootErrors.size > 0,
              }
            : {}),
        });
        const accepted = automaticAssistanceCallCount > ${String(
          Math.max(0, options.rejectedAutomaticAssistanceCalls ?? 0),
        )};
        if (accepted && event.startsWith('runtime-error-')) {
          scheduledFrames.push(() => {
            previewInspectorSession.neuralAssistancePending = true;
          });
        }
        return accepted;
      };
      const schedulePreviewInspectorNeuralAssistanceFrame = (callback) => {
        scheduledFrames.push(callback);
      };
      const previewInspectorPostHostMessage = (message) => messages.push(message);
      const readPreviewInspectorRuntimeCorrelation = () => ({
        artifactId: '0123456789abcdef',
        runtimeRevision: 3,
        runtimeSessionId: 'rp-0123456789abcdef01234567',
      });
      const readPreviewInspectorBlockerTraceTarget = () => ({
        exportName: 'Header',
        pageCandidateId: 'app-path',
        renderScenario: 'authored-page',
      });
      ${createPreviewInspectorRuntimeHealthSource()}
      globalThis.__runtime = {
        automaticEvents,
        error: recordPreviewInspectorRuntimeHealthError,
        flushScheduledFrames: () => {
          while (scheduledFrames.length > 0) scheduledFrames.shift()();
        },
        learningEvents,
        messages,
        reachability,
        readTargetError: readPreviewInspectorRuntimeHealthTargetError,
        record: recordPreviewInspectorRuntimeHealth,
      };
    `,
    context,
  );
  if (context.__runtime === undefined)
    throw new Error('Runtime health fixture did not initialize.');
  return context.__runtime;
}
