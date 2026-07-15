/**
 * Tests application orchestration with in-memory ports so compiler and storage details stay absent.
 */
import { describe, expect, it, vi } from 'vitest';
import { BuildPreview } from '../../src/application/buildPreview';
import type { PreviewArtifactStore } from '../../src/application/previewArtifactStore';
import type { PreviewCompiler } from '../../src/application/previewCompiler';
import type { PreviewBuildRequest, PreviewBundle } from '../../src/domain/preview';

const REQUEST: PreviewBuildRequest = {
  documentPath: '/workspace/Component.tsx',
  language: 'tsx',
  sourceText: 'export default function Component() { return null; }',
  workspaceRoot: '/workspace',
};

const BUNDLE: PreviewBundle = {
  dependencies: ['/workspace/Component.tsx'],
  diagnostics: [],
  javascript: new TextEncoder().encode('export {};'),
};

describe('BuildPreview', () => {
  /** Publishes exactly the bundle produced for the immutable request and returns combined metadata. */
  it('compiles before publishing and exposes a prepared preview', async () => {
    const compile = vi.fn<(request: PreviewBuildRequest) => Promise<PreviewBundle>>();
    compile.mockResolvedValue(BUNDLE);
    const publish = vi.fn<PreviewArtifactStore['publish']>();
    publish.mockResolvedValue({
      contentHash: 'abc123',
      scriptLocation: 'file:///preview/entry.js',
    });
    const pruneExcept = vi.fn<PreviewArtifactStore['pruneExcept']>();
    pruneExcept.mockResolvedValue();
    const compiler: PreviewCompiler = { compile };
    const artifactStore: PreviewArtifactStore = { pruneExcept, publish };
    const useCase = new BuildPreview(compiler, artifactStore);

    const result = await useCase.execute(REQUEST);

    expect(compile).toHaveBeenCalledWith(REQUEST);
    expect(publish).toHaveBeenCalledWith(BUNDLE);
    expect(result).toEqual({
      artifact: {
        contentHash: 'abc123',
        scriptLocation: 'file:///preview/entry.js',
      },
      dependencies: BUNDLE.dependencies,
      diagnostics: BUNDLE.diagnostics,
    });

    await useCase.pruneArtifactsExcept('abc123');
    expect(pruneExcept).toHaveBeenCalledWith('abc123');
  });

  /** Ensures publication cannot run with missing or stale bytes after a compiler failure. */
  it('does not publish when compilation fails', async () => {
    const failure = new Error('compiler failed');
    const compiler: PreviewCompiler = {
      compile: vi.fn().mockRejectedValue(failure),
    };
    const publish = vi.fn<PreviewArtifactStore['publish']>();
    const pruneExcept = vi.fn<PreviewArtifactStore['pruneExcept']>();
    const useCase = new BuildPreview(compiler, { pruneExcept, publish });

    await expect(useCase.execute(REQUEST)).rejects.toBe(failure);
    expect(publish).not.toHaveBeenCalled();
  });
});
