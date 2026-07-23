/**
 * Tests application orchestration with in-memory ports so compiler and storage details stay absent.
 */
import { describe, expect, it, vi } from 'vitest';
import { BuildPreview } from '../../src/application/buildPreview';
import type { PreviewArtifactStore } from '../../src/application/previewArtifactStore';
import type { PreviewCompiler } from '../../src/application/previewCompiler';
import type { PreviewBuildRequest, PreviewBundle } from '../../src/domain/preview';
import { PreviewBuildCancelledError } from '../../src/domain/previewBuildExecution';
import type { PreviewProgressStage } from '../../src/domain/previewProgress';

const REQUEST: PreviewBuildRequest = {
  dependencySnapshots: [],
  documentPath: '/workspace/Component.tsx',
  language: 'tsx',
  sourceText: 'export default function Component() { return null; }',
  workspaceRoot: '/workspace',
};

const BUNDLE: PreviewBundle = {
  chunks: [],
  dependencies: ['/workspace/Component.tsx'],
  diagnostics: [],
  javascript: new TextEncoder().encode('export {};'),
  watchDirectories: ['/workspace/pages'],
};

describe('BuildPreview', () => {
  /** Publishes exactly the bundle produced for the immutable request and returns combined metadata. */
  it('compiles before publishing and exposes a prepared preview', async () => {
    const reportedStages: PreviewProgressStage[] = [];
    const compile = vi.fn<PreviewCompiler['compile']>();
    compile.mockImplementation((_request, context) => {
      context?.reportProgress?.('discovering-components');
      return Promise.resolve(BUNDLE);
    });
    const publish = vi.fn<PreviewArtifactStore['publish']>();
    publish.mockResolvedValue({
      contentHash: 'abc123',
      scriptLocation: 'file:///preview/entry.js',
    });
    const release = vi.fn<PreviewArtifactStore['release']>();
    release.mockResolvedValue();
    const compiler: PreviewCompiler = { compile };
    const artifactStore: PreviewArtifactStore = { publish, release };
    const useCase = new BuildPreview(compiler, artifactStore);

    const context = { reportProgress: (stage: PreviewProgressStage) => reportedStages.push(stage) };
    const result = await useCase.execute(REQUEST, context);

    expect(compile).toHaveBeenCalledWith(REQUEST, context);
    expect(publish).toHaveBeenCalledWith(BUNDLE);
    expect(reportedStages).toEqual([
      'analyzing-project',
      'discovering-components',
      'publishing-artifacts',
    ]);
    expect(result).toEqual({
      artifact: {
        contentHash: 'abc123',
        scriptLocation: 'file:///preview/entry.js',
      },
      contextCoverage: 'partial',
      dependencies: BUNDLE.dependencies,
      diagnostics: BUNDLE.diagnostics,
      watchDirectories: BUNDLE.watchDirectories,
    });

    await useCase.releaseArtifact('abc123');
    expect(release).toHaveBeenCalledWith('abc123');
  });

  /** Ensures publication cannot run with missing or stale bytes after a compiler failure. */
  it('does not publish when compilation fails', async () => {
    const failure = new Error('compiler failed');
    const compiler: PreviewCompiler = {
      compile: vi.fn().mockRejectedValue(failure),
    };
    const publish = vi.fn<PreviewArtifactStore['publish']>();
    const release = vi.fn<PreviewArtifactStore['release']>();
    const useCase = new BuildPreview(compiler, { publish, release });

    await expect(useCase.execute(REQUEST)).rejects.toBe(failure);
    expect(publish).not.toHaveBeenCalled();
  });

  /** Carries the compiler-only Inspector gesture key to its panel without persisting it as an asset. */
  it('preserves a Page Inspector source gesture key across publication', async () => {
    const securedBundle = {
      ...BUNDLE,
      inspectorSourceGestureSecret: Buffer.alloc(32, 9).toString('base64url'),
    };
    const compile = vi.fn<PreviewCompiler['compile']>().mockResolvedValue(securedBundle);
    const publish = vi.fn<PreviewArtifactStore['publish']>().mockResolvedValue({
      contentHash: 'secured',
      scriptLocation: 'file:///preview/secured/entry.js',
    });
    const useCase = new BuildPreview({ compile }, { publish, release: vi.fn() });

    const result = await useCase.execute(REQUEST);

    expect(result.inspectorSourceGestureSecret).toBe(securedBundle.inspectorSourceGestureSecret);
    expect(publish).toHaveBeenCalledWith(securedBundle);
  });

  /** Prevents already-cancelled revisions from entering compiler or artifact side effects. */
  it('stops before compilation when the execution was already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const compile = vi.fn<PreviewCompiler['compile']>();
    const publish = vi.fn<PreviewArtifactStore['publish']>();
    const release = vi.fn<PreviewArtifactStore['release']>();
    const useCase = new BuildPreview({ compile }, { publish, release });

    await expect(useCase.execute(REQUEST, { signal: controller.signal })).rejects.toBeInstanceOf(
      PreviewBuildCancelledError,
    );
    expect(compile).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
  });

  /** Releases publication's acquired lease when cancellation races with asynchronous disk IO. */
  it('releases an artifact published after its revision was cancelled', async () => {
    const controller = new AbortController();
    const compile = vi.fn<PreviewCompiler['compile']>().mockResolvedValue(BUNDLE);
    const publish = vi.fn<PreviewArtifactStore['publish']>().mockImplementation(() => {
      controller.abort();
      return Promise.resolve({
        contentHash: 'cancelled-after-publish',
        scriptLocation: 'file:///preview/cancelled/entry.js',
      });
    });
    const release = vi.fn<PreviewArtifactStore['release']>().mockResolvedValue();
    const useCase = new BuildPreview({ compile }, { publish, release });

    await expect(useCase.execute(REQUEST, { signal: controller.signal })).rejects.toBeInstanceOf(
      PreviewBuildCancelledError,
    );
    expect(release).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledWith('cancelled-after-publish');
  });
});
