/**
 * Owns a bounded set of persistent esbuild contexts for serialized preview rebuilds.
 * Context options and virtual-module plans are immutable per cache key, while editor snapshots and
 * the compilation-scoped source transformer advance through one explicit mutable state boundary.
 */
import { context, type BuildContext, type BuildOptions, type BuildResult } from 'esbuild';
import type { PreviewCompilerNativeBuildActivity } from '../../domain/previewCompilerActivity';
import {
  createPreviewSassPlugin,
  type PreviewSassBoundary,
  type PreviewSassPluginOptions,
} from './previewSassPlugin';
import {
  MutableWorkspaceSourceState,
  type WorkspaceSourceCompilationState,
} from './workspaceSourcePlugin';

/** Exact esbuild result contract consumed by the preview output planner. */
export type PreviewIncrementalBuildResult = BuildResult<{ metafile: true; write: false }>;

/** Static options required for an in-memory build whose dependency graph remains reusable. */
export type PreviewIncrementalBuildOptions = BuildOptions & {
  readonly metafile: true;
  readonly write: false;
};

/** Native context transition telemetry; compiler code supplies the safe graph summary separately. */
export type PreviewIncrementalBuildActivityReporter = (
  activity: Pick<PreviewCompilerNativeBuildActivity, 'contextAction' | 'phase'>,
) => void;

/** One rebuild request carrying immutable plan identity and current editor state. */
export interface PreviewIncrementalBuildRequest {
  /** Abort signal owned by the current panel revision. */
  readonly signal?: AbortSignal;
  readonly reportActivity?: PreviewIncrementalBuildActivityReporter;
  /** Stable digest of target, runtime, plugin, and virtual-module options. */
  readonly contextKey: string;
  /** Current snapshots and fresh transformer used only by this serialized rebuild. */
  readonly sourceCompilation: WorkspaceSourceCompilationState;
  /** Creates fixed context options around the supplied mutable source-state object. */
  readonly createOptions: (
    sourceState: MutableWorkspaceSourceState,
    sassBoundary: PreviewSassBoundary | undefined,
  ) => PreviewIncrementalBuildOptions;
  /** Receives an immutable style graph snapshot before the next serialized rebuild can clear it. */
  readonly captureSassState?: (
    dependencyPaths: readonly string[],
    watchDirectories: readonly string[],
  ) => void;
  /** Fixed package roots used to create a Sass boundary owned by the persistent context. */
  readonly sassOptions?: PreviewSassPluginOptions;
}

/** Persistent native context plus a queue preventing mutable source state from overlapping. */
interface CachedBuildContext {
  /** Native esbuild context that retains parsed dependency graph state. */
  readonly buildContext: BuildContext<PreviewIncrementalBuildOptions>;
  /** Resolves after the latest queued rebuild, regardless of its result. */
  queue: Promise<void>;
  /** Style compiler/cache that must live exactly as long as its native context plugins. */
  readonly sassBoundary?: PreviewSassBoundary;
  /** Mutable source boundary read by the persistent workspace plugin. */
  readonly sourceState: MutableWorkspaceSourceState;
}

/**
 * LRU-like cache for native build contexts shared by previews in one extension host.
 * Same-plan requests serialize on one context; unrelated targets may still build concurrently.
 */
export class PreviewIncrementalBuildCache {
  /** True once shutdown has started; no native context may be created after this boundary. */
  private closed = false;
  /** Detached LRU and one-shot disposals that shutdown must await before stopping esbuild. */
  private readonly disposalPromises = new Set<Promise<void>>();
  private readonly entries = new Map<string, Promise<CachedBuildContext>>();
  /** Serializes every physical context create/rebuild/dispose transition. */
  private contextTransition: Promise<void> = Promise.resolve();
  /** Storybook builds use isolated contexts but still participate in orderly shutdown. */
  private readonly oneShotBuilds = new Set<Promise<PreviewIncrementalBuildResult>>();
  private shutdownPromise: Promise<void> | undefined;

  /**
   * Rebuilds one immutable plan with the latest editor overlays and supports active cancellation.
   *
   * @param request Context identity, current source state, factory, and optional revision signal.
   * @returns In-memory output and metafile produced by the persistent native context.
   */
  public async rebuild(
    request: PreviewIncrementalBuildRequest,
  ): Promise<PreviewIncrementalBuildResult> {
    throwIfIncrementalBuildCacheClosed(this.closed);
    throwIfPreviewBuildAborted(request.signal);
    return this.enqueueContextTransition(async () => {
      throwIfIncrementalBuildCacheClosed(this.closed);
      throwIfPreviewBuildAborted(request.signal);
      const entry = await this.getOrCreateEntry(request);
      throwIfIncrementalBuildCacheClosed(this.closed);
      throwIfPreviewBuildAborted(request.signal);
      const operation = entry.queue.then(async () => {
        request.reportActivity?.({ contextAction: 'reuse', phase: 'rebuilding' });
        throwIfPreviewBuildAborted(request.signal);
        entry.sourceState.update(request.sourceCompilation);
        const cancelCurrentBuild = (): void => void entry.buildContext.cancel();
        request.signal?.addEventListener('abort', cancelCurrentBuild, { once: true });
        try {
          const result = await entry.buildContext.rebuild();
          throwIfPreviewBuildAborted(request.signal);
          request.captureSassState?.(
            entry.sassBoundary?.getDependencyPaths() ?? [],
            entry.sassBoundary?.getWatchDirectories() ?? [],
          );
          request.reportActivity?.({ contextAction: 'reuse', phase: 'processing-output' });
          return result;
        } catch (error) {
          throwIfPreviewBuildAborted(request.signal);
          throw error;
        } finally {
          request.signal?.removeEventListener('abort', cancelCurrentBuild);
        }
      });
      entry.queue = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    }).catch(async (error: unknown) => {
      // A failed native rebuild can retain a partially parsed graph and plugin caches. Dispose it
      // before exposing the rejection so the next foreground attempt always starts clean.
      await this.evict(request.contextKey, {
        contextAction: 'dispose',
        ...(request.reportActivity === undefined ? {} : { reportActivity: request.reportActivity }),
      });
      throw error;
    });
  }

  /**
   * Removes one reusable native context after queued work has settled.
   *
   * Corrective/adaptive builds call this before changing a broad graph plan; removing the map entry
   * first ensures a concurrent later request receives a fresh context instead of the retiring one.
   */
  public async evict(
    contextKey: string,
    options: {
      readonly contextAction: 'dispose' | 'replace';
      readonly reportActivity?: PreviewIncrementalBuildActivityReporter;
    } = { contextAction: 'dispose' },
  ): Promise<void> {
    await this.enqueueContextTransition(async () => {
      const entry = this.entries.get(contextKey);
      if (entry === undefined) return;
      this.entries.delete(contextKey);
      options.reportActivity?.({
        contextAction: options.contextAction,
        phase: 'retiring-previous-context',
      });
      await disposeCachedBuildContext(entry);
    });
  }

  /**
   * Runs a cancellation-aware isolated context for stateful fallback plugins such as Storybook.
   * The context is never cached, and its disposal is registered before any asynchronous work starts
   * so compiler shutdown cannot stop esbuild while the build or cleanup is still active.
   */
  public buildOnce(
    options: PreviewIncrementalBuildOptions,
    signal?: AbortSignal,
    reportActivity?: PreviewIncrementalBuildActivityReporter,
  ): Promise<PreviewIncrementalBuildResult> {
    throwIfIncrementalBuildCacheClosed(this.closed);
    throwIfPreviewBuildAborted(signal);
    const operation = this.enqueueContextTransition(async () => {
      await this.retireAllEntries();
      reportActivity?.({ contextAction: 'one-shot', phase: 'creating-context' });
      const result = await rebuildOneShotContext(options, signal, () => this.closed);
      reportActivity?.({ contextAction: 'one-shot', phase: 'processing-output' });
      return result;
    });
    this.oneShotBuilds.add(operation);
    void operation.then(
      () => this.oneShotBuilds.delete(operation),
      () => this.oneShotBuilds.delete(operation),
    );
    return operation;
  }

  /** Disposes every cached context after its currently serialized rebuild settles. */
  public shutdown(): Promise<void> {
    if (this.shutdownPromise !== undefined) {
      return this.shutdownPromise;
    }
    this.closed = true;
    const retire = this.enqueueContextTransition(() => this.retireAllEntries());
    const activeOneShotBuilds = [...this.oneShotBuilds].map((operation) =>
      operation.then(
        () => undefined,
        () => undefined,
      ),
    );
    this.shutdownPromise = Promise.all([
      retire,
      ...this.disposalPromises,
      ...activeOneShotBuilds,
    ]).then(() => undefined);
    return this.shutdownPromise;
  }

  /** Returns an LRU-refreshed entry promise or installs one new native context. */
  private async getOrCreateEntry(
    request: PreviewIncrementalBuildRequest,
  ): Promise<CachedBuildContext> {
    throwIfIncrementalBuildCacheClosed(this.closed);
    const cached = this.entries.get(request.contextKey);
    if (cached !== undefined) {
      this.entries.delete(request.contextKey);
      this.entries.set(request.contextKey, cached);
      return cached;
    }

    await this.retireAllEntries(request.reportActivity);
    throwIfIncrementalBuildCacheClosed(this.closed);
    throwIfPreviewBuildAborted(request.signal);

    const sourceState = new MutableWorkspaceSourceState(request.sourceCompilation);
    const sassBoundary =
      request.sassOptions === undefined ? undefined : createPreviewSassPlugin(request.sassOptions);
    request.reportActivity?.({ contextAction: 'create', phase: 'creating-context' });
    const created = context(request.createOptions(sourceState, sassBoundary)).then(
      (buildContext): CachedBuildContext => ({
        buildContext,
        queue: Promise.resolve(),
        ...(sassBoundary === undefined ? {} : { sassBoundary }),
        sourceState,
      }),
    );
    this.entries.set(request.contextKey, created);
    void created.catch(() => {
      if (this.entries.get(request.contextKey) === created) {
        this.entries.delete(request.contextKey);
      }
    });
    return created;
  }

  /** Evicts least-recently-used contexts without interrupting their current rebuild. */
  private async retireAllEntries(
    reportActivity?: PreviewIncrementalBuildActivityReporter,
  ): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) {
      reportActivity?.({ contextAction: 'dispose', phase: 'retiring-previous-context' });
      await disposeCachedBuildContext(entry);
    }
  }

  /** Serializes native context transitions so stale rebuilds cannot observe partial state. */
  private enqueueContextTransition<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.contextTransition.then(operation, operation);
    this.contextTransition = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Retains an asynchronous cleanup until shutdown has either captured or observed its settlement. */
  private trackDisposal(disposal: Promise<void>): void {
    this.disposalPromises.add(disposal);
    void disposal.then(
      () => this.disposalPromises.delete(disposal),
      () => this.disposalPromises.delete(disposal),
    );
  }
}

/** Waits for queued work before releasing a native esbuild context. */
async function disposeCachedBuildContext(entryPromise: Promise<CachedBuildContext>): Promise<void> {
  try {
    const entry = await entryPromise;
    await entry.queue;
    await entry.buildContext.dispose();
  } catch {
    // Failed context creation or disposal leaves no reusable native state in the cache.
  }
}

/** Creates, rebuilds, actively cancels, and always disposes one non-reusable native context. */
async function rebuildOneShotContext(
  options: PreviewIncrementalBuildOptions,
  signal: AbortSignal | undefined,
  isClosed: () => boolean,
): Promise<PreviewIncrementalBuildResult> {
  const buildContext = await context(options);
  const cancelCurrentBuild = (): void => {
    void buildContext.cancel();
  };
  try {
    throwIfIncrementalBuildCacheClosed(isClosed());
    throwIfPreviewBuildAborted(signal);
    signal?.addEventListener('abort', cancelCurrentBuild, { once: true });
    try {
      const result = await buildContext.rebuild();
      throwIfPreviewBuildAborted(signal);
      return result;
    } catch (error) {
      throwIfPreviewBuildAborted(signal);
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancelCurrentBuild);
    }
  } finally {
    await buildContext.dispose();
  }
}

/** Fails closed when a late compiler continuation reaches a cache whose shutdown already began. */
function throwIfIncrementalBuildCacheClosed(closed: boolean): void {
  if (closed) {
    throw new DOMException('React preview build cache is already closed.', 'AbortError');
  }
}

/** Throws the caller's reason, or a stable AbortError, at every expensive phase boundary. */
function throwIfPreviewBuildAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) {
    return;
  }
  if (signal.reason instanceof Error) {
    throw signal.reason;
  }
  throw new DOMException('React preview build was superseded by a newer revision.', 'AbortError');
}
