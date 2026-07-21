/** Verifies revision-aware renderer health correlation without mounting React or project modules. */
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorRuntimeHealthSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorRuntimeHealthSource';

/** Minimal host message surface emitted by the generated health runtime. */
interface RuntimeHealthMessage {
  readonly artifactId?: string;
  readonly event: {
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
  readonly error: (entry: Record<string, unknown>) => void;
  readonly messages: RuntimeHealthMessage[];
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
});

/** Evaluates generated source with inert session, revision, and postMessage primitives. */
function createRuntimeHealthFixture(): RuntimeHealthFixture {
  const context: { __runtime?: RuntimeHealthFixture } = {};
  vm.runInNewContext(
    `
      const previewEntryRevision = 3;
      const previewInspectorSession = {
        selectedExportName: 'Header',
        selectedPageCandidateId: 'app-path',
      };
      const blockedInspectorPropNames = new Set(['__proto__', 'constructor', 'prototype']);
      const messages = [];
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
        error: recordPreviewInspectorRuntimeHealthError,
        messages,
        record: recordPreviewInspectorRuntimeHealth,
      };
    `,
    context,
  );
  if (context.__runtime === undefined)
    throw new Error('Runtime health fixture did not initialize.');
  return context.__runtime;
}
