/** Verifies native esbuild context reuse, mutable editor overlays, cancellation, and disposal. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildContext, BuildResult } from 'esbuild';
import {
  PreviewIncrementalBuildCache,
  type PreviewIncrementalBuildOptions,
} from '../../../src/adapters/esbuild/previewIncrementalBuildCache';
import type { PreviewSassBoundary } from '../../../src/adapters/esbuild/previewSassPlugin';
import { PreviewSourceTransformer } from '../../../src/adapters/esbuild/staticResources/previewSourceTransformer';
import type {
  MutableWorkspaceSourceState,
  WorkspaceSourceCompilationState,
} from '../../../src/adapters/esbuild/workspaceSourcePlugin';

const esbuildMocks = vi.hoisted(() => ({ context: vi.fn() }));

vi.mock('esbuild', async (importOriginal) => ({
  ...(await importOriginal<typeof import('esbuild')>()),
  context: esbuildMocks.context,
}));

describe('PreviewIncrementalBuildCache', () => {
  beforeEach(() => {
    esbuildMocks.context.mockReset();
  });

  /** Reuses one context key while atomically advancing its editor snapshot and transformer. */
  it('rebuilds a compatible plan through one persistent native context', async () => {
    const native = createNativeContext();
    esbuildMocks.context.mockResolvedValue(native.context);
    const cache = new PreviewIncrementalBuildCache();
    const sourceStates: MutableWorkspaceSourceState[] = [];
    const createOptions = vi.fn((state: MutableWorkspaceSourceState) => {
      sourceStates.push(state);
      return createBuildOptions();
    });

    await cache.rebuild({
      contextKey: 'stable-plan',
      createOptions,
      sourceCompilation: createCompilation('first'),
    });
    await cache.rebuild({
      contextKey: 'stable-plan',
      createOptions,
      sourceCompilation: createCompilation('second'),
    });

    expect(esbuildMocks.context).toHaveBeenCalledOnce();
    expect(createOptions).toHaveBeenCalledOnce();
    expect(native.rebuild).toHaveBeenCalledTimes(2);
    expect(sourceStates[0]?.readLexicalSnapshot('/workspace/src/Target.tsx')?.sourceText).toBe(
      'second',
    );
    await cache.shutdown();
    expect(native.dispose).toHaveBeenCalledOnce();
  });

  /** Keeps the project Sass compiler and its dependency snapshot attached to the reused context. */
  it('reuses one Sass boundary and captures its state after every serialized rebuild', async () => {
    const native = createNativeContext();
    esbuildMocks.context.mockResolvedValue(native.context);
    const cache = new PreviewIncrementalBuildCache();
    const sassBoundaries: PreviewSassBoundary[] = [];
    const captureSassState = vi.fn();
    const createOptions = vi.fn(
      (_state: MutableWorkspaceSourceState, sassBoundary: PreviewSassBoundary | undefined) => {
        if (sassBoundary !== undefined) {
          sassBoundaries.push(sassBoundary);
        }
        return createBuildOptions();
      },
    );

    for (const sourceText of ['first', 'second']) {
      await cache.rebuild({
        captureSassState,
        contextKey: 'sass-plan',
        createOptions,
        sassOptions: {
          projectRoot: '/workspace',
          workspaceRoot: '/workspace',
        },
        sourceCompilation: createCompilation(sourceText),
      });
    }

    expect(createOptions).toHaveBeenCalledOnce();
    expect(sassBoundaries).toHaveLength(1);
    expect(captureSassState).toHaveBeenCalledTimes(2);
    expect(captureSassState).toHaveBeenNthCalledWith(1, [], []);
    expect(captureSassState).toHaveBeenNthCalledWith(2, [], []);
    await cache.shutdown();
  });

  /** Requests native cancellation and surfaces a standard AbortError for a superseded revision. */
  it('cancels an active rebuild through its revision signal', async () => {
    let rejectRebuild: ((error: Error) => void) | undefined;
    const rebuild = vi.fn(
      () =>
        new Promise<BuildResult<{ metafile: true; write: false }>>((_resolve, reject) => {
          rejectRebuild = reject;
        }),
    );
    const cancel = vi.fn(() => {
      rejectRebuild?.(new Error('native build cancelled'));
      return Promise.resolve();
    });
    const native = createNativeContext({ cancel, rebuild });
    esbuildMocks.context.mockResolvedValue(native.context);
    const cache = new PreviewIncrementalBuildCache();
    const controller = new AbortController();

    const operation = cache.rebuild({
      contextKey: 'cancelled-plan',
      createOptions: () => createBuildOptions(),
      signal: controller.signal,
      sourceCompilation: createCompilation('pending'),
    });
    await vi.waitFor(() => {
      expect(rebuild).toHaveBeenCalledOnce();
    });
    controller.abort();

    await expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledOnce();
    await cache.shutdown();
  });

  /** Keeps unrelated static plans isolated and disposes every retained native context. */
  it('creates separate contexts for incompatible plans', async () => {
    const first = createNativeContext();
    const second = createNativeContext();
    esbuildMocks.context.mockResolvedValueOnce(first.context).mockResolvedValueOnce(second.context);
    const cache = new PreviewIncrementalBuildCache();

    for (const contextKey of ['plan-a', 'plan-b']) {
      await cache.rebuild({
        contextKey,
        createOptions: () => createBuildOptions(),
        sourceCompilation: createCompilation(contextKey),
      });
    }
    await cache.shutdown();

    expect(esbuildMocks.context).toHaveBeenCalledTimes(2);
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(second.dispose).toHaveBeenCalledOnce();
  });

  /** Uses an isolated cancellable context for stateful fallback plugins and disposes it immediately. */
  it('runs one-shot builds without retaining their native context', async () => {
    const native = createNativeContext();
    esbuildMocks.context.mockResolvedValue(native.context);
    const cache = new PreviewIncrementalBuildCache();

    await expect(cache.buildOnce(createBuildOptions())).resolves.toEqual(createBuildResult());

    expect(native.rebuild).toHaveBeenCalledOnce();
    expect(native.dispose).toHaveBeenCalledOnce();
    await cache.shutdown();
  });

  /** Rejects late work after shutdown so a compiler continuation cannot restart esbuild. */
  it('closes context creation before shutdown disposes native state', async () => {
    const cache = new PreviewIncrementalBuildCache();
    await cache.shutdown();

    await expect(
      cache.rebuild({
        contextKey: 'late-plan',
        createOptions: () => createBuildOptions(),
        sourceCompilation: createCompilation('late'),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(() => cache.buildOnce(createBuildOptions())).toThrow(
      expect.objectContaining({ name: 'AbortError' }),
    );
    expect(esbuildMocks.context).not.toHaveBeenCalled();
  });

  /** Prevents a context whose asynchronous creation crosses shutdown from ever starting a build. */
  it('disposes a context that finishes creation after the cache closes', async () => {
    const native = createNativeContext();
    let resolveContext:
      ((context: BuildContext<PreviewIncrementalBuildOptions>) => void) | undefined;
    esbuildMocks.context.mockReturnValue(
      new Promise<BuildContext<PreviewIncrementalBuildOptions>>((resolve) => {
        resolveContext = resolve;
      }),
    );
    const cache = new PreviewIncrementalBuildCache();
    const operation = cache.rebuild({
      contextKey: 'creating-plan',
      createOptions: () => createBuildOptions(),
      sourceCompilation: createCompilation('creating'),
    });
    const shutdown = cache.shutdown();

    resolveContext?.(native.context);

    await expect(operation).rejects.toMatchObject({ name: 'AbortError' });
    await shutdown;
    expect(native.rebuild).not.toHaveBeenCalled();
    expect(native.dispose).toHaveBeenCalledOnce();
  });
});

/** Optional native methods used to customize one fake context. */
interface NativeContextOverrides {
  readonly cancel?: ReturnType<typeof vi.fn>;
  readonly rebuild?: ReturnType<typeof vi.fn>;
}

/** Creates an observable subset of esbuild's persistent context contract. */
function createNativeContext(overrides: NativeContextOverrides = {}): {
  readonly cancel: ReturnType<typeof vi.fn>;
  readonly context: BuildContext<PreviewIncrementalBuildOptions>;
  readonly dispose: ReturnType<typeof vi.fn>;
  readonly rebuild: ReturnType<typeof vi.fn>;
} {
  const cancel = overrides.cancel ?? vi.fn(() => Promise.resolve());
  const dispose = vi.fn(() => Promise.resolve());
  const rebuild = overrides.rebuild ?? vi.fn(() => Promise.resolve(createBuildResult()));
  return {
    cancel,
    context: {
      cancel,
      dispose,
      rebuild,
    } as unknown as BuildContext<PreviewIncrementalBuildOptions>,
    dispose,
    rebuild,
  };
}

/** Creates minimal static options accepted by the mocked native context boundary. */
function createBuildOptions(): PreviewIncrementalBuildOptions {
  return { metafile: true, write: false };
}

/** Creates current editor state with a fresh per-build source transformer. */
function createCompilation(sourceText: string): WorkspaceSourceCompilationState {
  return {
    snapshots: [
      {
        documentPath: '/workspace/src/Target.tsx',
        language: 'tsx',
        sourceText,
      },
    ],
    transformer: new PreviewSourceTransformer({
      projectRoot: '/workspace',
      workspaceRoot: '/workspace',
    }),
  };
}

/** Creates the in-memory result shape returned by a successful esbuild rebuild. */
function createBuildResult(): BuildResult<{ metafile: true; write: false }> {
  return {
    errors: [],
    mangleCache: {},
    metafile: { inputs: {}, outputs: {} },
    outputFiles: [],
    warnings: [],
  };
}
