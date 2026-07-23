/** Verifies cold fast-first preparation, full fallback, and warm full-only rebuild selection. */
import { describe, expect, it, vi } from 'vitest';
import type { BuildPreview } from '../../src/application/buildPreview';
import type { PreparedPreview, PreviewBuildRequest } from '../../src/domain/preview';
import {
  PreviewBuildCancelledError,
  PreviewBuildStalledError,
} from '../../src/domain/previewBuildExecution';
import { preparePreviewFirstPaint } from '../../src/presentation/previewFirstPaint';

const REQUEST: PreviewBuildRequest = Object.freeze({
  dependencySnapshots: Object.freeze([]),
  documentPath: '/workspace/src/Target.tsx',
  language: 'tsx',
  sourceText: 'export default function Target() { return <main />; }',
  workspaceRoot: '/workspace',
});

describe('preparePreviewFirstPaint', () => {
  /** Uses only the graph-reachable pass before a session has a complete context baseline. */
  it('returns a fast artifact and requests deferred enrichment for a cold session', async () => {
    const execute = vi.fn<BuildPreview['execute']>(() =>
      Promise.resolve(createPreparedPreview('fast')),
    );

    const result = await preparePreviewFirstPaint({
      buildPreview: createBuildService(execute),
      context: {},
      preferFast: true,
      renderMode: 'component',
      request: REQUEST,
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      buildIntent: 'foreground',
      preparationMode: 'fast',
      renderMode: 'component',
    });
    expect(result.requiresContextEnrichment).toBe(true);
    expect(result.preparedPreview.artifact.contentHash).toBe('fast');
  });

  /** Converts a genuine component-gallery fast-build failure into one complete initial build. */
  it('falls back to full preparation when the direct graph cannot compile', async () => {
    const execute = vi
      .fn<BuildPreview['execute']>()
      .mockRejectedValueOnce(new Error('fast graph unavailable'))
      .mockResolvedValueOnce(createPreparedPreview('full'));

    const result = await preparePreviewFirstPaint({
      buildPreview: createBuildService(execute),
      context: {},
      preferFast: true,
      renderMode: 'component',
      request: REQUEST,
    });

    expect(execute.mock.calls.map(([request]) => request.preparationMode)).toEqual([
      'fast',
      'full',
    ]);
    expect(result.requiresContextEnrichment).toBe(false);
    expect(result.preparedPreview.artifact.contentHash).toBe('full');
  });

  /** Paints the direct Inspector target before package-wide actual-parent discovery completes. */
  it('defers complete page context until after the first Page Inspector artifact', async () => {
    const execute = vi.fn<BuildPreview['execute']>(() =>
      Promise.resolve(createPreparedPreview('page-first-paint')),
    );

    const result = await preparePreviewFirstPaint({
      buildPreview: createBuildService(execute),
      context: {},
      preferFast: true,
      renderMode: 'page-inspector',
      request: REQUEST,
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      preparationMode: 'fast',
      renderMode: 'page-inspector',
    });
    expect(result.requiresContextEnrichment).toBe(true);
    expect(result.preparedPreview.artifact.contentHash).toBe('page-first-paint');
  });

  /** Skips a redundant full pass when the compiler already proved the authored page corridor. */
  it('accepts a complete fast Page Inspector artifact as the final context result', async () => {
    const execute = vi.fn<BuildPreview['execute']>(() =>
      Promise.resolve({
        ...createPreparedPreview('page-complete'),
        contextCoverage: 'complete',
      }),
    );

    const result = await preparePreviewFirstPaint({
      buildPreview: createBuildService(execute),
      context: {},
      preferFast: true,
      renderMode: 'page-inspector',
      request: REQUEST,
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(result.requiresContextEnrichment).toBe(false);
    expect(result.preparedPreview.contextCoverage).toBe('complete');
  });

  /** Reuses the complete incremental path after a session has established full context once. */
  it('builds only full context for a warm session', async () => {
    const execute = vi.fn<BuildPreview['execute']>(() =>
      Promise.resolve(createPreparedPreview('warm')),
    );

    const result = await preparePreviewFirstPaint({
      buildPreview: createBuildService(execute),
      context: {},
      preferFast: false,
      renderMode: 'component',
      request: REQUEST,
    });

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      buildIntent: 'foreground',
      preparationMode: 'full',
    });
    expect(result.requiresContextEnrichment).toBe(false);
  });

  /** Never spends more work on an explicitly superseded fast revision. */
  it('does not fall back after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    const execute = vi.fn<BuildPreview['execute']>(() =>
      Promise.reject(new PreviewBuildCancelledError()),
    );

    await expect(
      preparePreviewFirstPaint({
        buildPreview: createBuildService(execute),
        context: { signal: controller.signal },
        preferFast: true,
        renderMode: 'component',
        request: REQUEST,
      }),
    ).rejects.toBeInstanceOf(PreviewBuildCancelledError);
    expect(execute).toHaveBeenCalledOnce();
  });

  /** A watchdog restart must not replay the same oversized graph through the full fallback. */
  it('does not retry a stalled fast build', async () => {
    const execute = vi.fn<BuildPreview['execute']>(() =>
      Promise.reject(
        new PreviewBuildStalledError(REQUEST.documentPath, 'bundling-modules', 45_000),
      ),
    );

    await expect(
      preparePreviewFirstPaint({
        buildPreview: createBuildService(execute),
        context: {},
        preferFast: true,
        renderMode: 'page-inspector',
        request: REQUEST,
      }),
    ).rejects.toBeInstanceOf(PreviewBuildStalledError);
    expect(execute).toHaveBeenCalledOnce();
  });
});

/** Creates the minimal application boundary consumed by first-paint selection. */
function createBuildService(
  execute: BuildPreview['execute'],
): Pick<BuildPreview, 'execute' | 'releaseArtifact'> {
  return { execute, releaseArtifact: vi.fn(() => Promise.resolve()) };
}

/** Creates one deterministic published artifact for preparation-policy assertions. */
function createPreparedPreview(contentHash: string): PreparedPreview {
  return {
    artifact: {
      contentHash,
      scriptLocation: `file:///artifacts/entry-${contentHash}.js`,
    },
    dependencies: [REQUEST.documentPath],
    diagnostics: [],
    watchDirectories: [],
  };
}
