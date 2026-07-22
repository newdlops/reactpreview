/** Verifies browser-settlement gating and non-fatal full-context enrichment behavior. */
import { describe, expect, it, vi } from 'vitest';
import type { BuildPreview } from '../../src/application/buildPreview';
import type { PreparedPreview } from '../../src/domain/preview';
import {
  PreviewBuildCancelledError,
  PreviewBuildStalledError,
} from '../../src/domain/previewBuildExecution';
import type { ResolvedPreviewTarget } from '../../src/presentation/activePreviewTarget';
import {
  PreviewContextEnrichmentCoordinator,
  type PreviewContextEnrichmentCallbacks,
} from '../../src/presentation/previewContextEnrichment';

describe('PreviewContextEnrichmentCoordinator', () => {
  /** Starts only after the exact fast artifact and revision settle in the browser. */
  it('gates a full build on the matching runtime acknowledgement', async () => {
    const fixture = createFixture();
    const signal = new AbortController().signal;

    fixture.coordinator.schedule(TARGET, 'fast', 4, signal, true);
    fixture.coordinator.settle('another', 4);
    fixture.coordinator.settle('fast', 3);
    expect(fixture.execute).not.toHaveBeenCalled();

    fixture.coordinator.settle('fast', 4);
    await vi.waitFor(() => {
      expect(fixture.callbacks.commit).toHaveBeenCalledOnce();
    });

    expect(fixture.execute.mock.calls[0]?.[0]).toMatchObject({
      preparationMode: 'full',
      renderMode: 'page-inspector',
    });
    expect(fixture.callbacks.complete).toHaveBeenCalledWith(4);
  });

  /** Keeps the fast tree and reports only a warning callback when full discovery fails. */
  it('contains enrichment failure without committing or releasing the displayed fast artifact', async () => {
    const failure = new Error('reverse graph failed');
    const fixture = createFixture({ failure });

    fixture.coordinator.schedule(TARGET, 'fast', 7, new AbortController().signal, false);
    await vi.waitFor(() => {
      expect(fixture.callbacks.reportFailure).toHaveBeenCalledWith(failure, TARGET, 7);
    });

    expect(fixture.callbacks.commit).not.toHaveBeenCalled();
    expect(fixture.releaseArtifact).not.toHaveBeenCalled();
    expect(fixture.callbacks.complete).toHaveBeenCalledWith(7);
  });

  /** Returns a published full artifact when its revision became stale before commit. */
  it('releases a stale enrichment artifact', async () => {
    const fixture = createFixture({ current: false });

    fixture.coordinator.schedule(TARGET, 'fast', 8, new AbortController().signal, false);
    await vi.waitFor(() => {
      expect(fixture.releaseArtifact).toHaveBeenCalledWith('full');
    });

    expect(fixture.callbacks.commit).not.toHaveBeenCalled();
    expect(fixture.callbacks.reportFailure).not.toHaveBeenCalled();
  });

  /** An identical expensive graph is not allowed to restart the compiler after a resource stall. */
  it('suppresses repeated full enrichment for the same stalled source revision', async () => {
    const failure = new PreviewBuildStalledError(
      TARGET.request.documentPath,
      'bundling-modules',
      45_000,
      'memory',
    );
    const fixture = createFixture({ failure });

    fixture.coordinator.schedule(TARGET, 'same-fast', 10, new AbortController().signal, false);
    await vi.waitFor(() => {
      expect(fixture.callbacks.reportFailure).toHaveBeenCalledOnce();
    });
    fixture.coordinator.schedule(TARGET, 'rebuilt-fast', 11, new AbortController().signal, false);
    await vi.waitFor(() => {
      expect(fixture.callbacks.complete).toHaveBeenCalledWith(11);
    });

    expect(fixture.execute).toHaveBeenCalledOnce();
    expect(fixture.callbacks.reportFailure).toHaveBeenCalledOnce();

    fixture.coordinator.schedule(TARGET, 'third-fast', 12, new AbortController().signal, false);
    await vi.waitFor(() => {
      expect(fixture.execute).toHaveBeenCalledTimes(2);
    });
  });

  /** Native esbuild service loss receives the same one-refresh protection as worker heap failure. */
  it('suppresses one identical enrichment after native service failure', async () => {
    const failure = new PreviewBuildStalledError(
      TARGET.request.documentPath,
      'bundling-modules',
      12_000,
      'native-service',
    );
    const fixture = createFixture({ failure });

    fixture.coordinator.schedule(TARGET, 'before-restart', 20, new AbortController().signal, false);
    await vi.waitFor(() => {
      expect(fixture.callbacks.reportFailure).toHaveBeenCalledOnce();
    });
    fixture.coordinator.schedule(TARGET, 'after-restart', 21, new AbortController().signal, false);
    await vi.waitFor(() => {
      expect(fixture.callbacks.complete).toHaveBeenCalledWith(21);
    });

    expect(fixture.execute).toHaveBeenCalledOnce();
  });

  /** Editing the selected source changes the graph identity and admits one fresh full attempt. */
  it('retries resource-stalled enrichment after a source edit', async () => {
    const failure = new PreviewBuildStalledError(
      TARGET.request.documentPath,
      'bundling-modules',
      45_000,
      'watchdog',
    );
    const fixture = createFixture({ failure });
    const editedTarget = {
      ...TARGET,
      request: { ...TARGET.request, sourceText: `${TARGET.request.sourceText}\n// edited` },
    } as ResolvedPreviewTarget;

    fixture.coordinator.schedule(TARGET, 'fast-1', 12, new AbortController().signal, false);
    await vi.waitFor(() => {
      expect(fixture.execute).toHaveBeenCalledTimes(1);
    });
    fixture.coordinator.schedule(editedTarget, 'fast-2', 13, new AbortController().signal, false);
    await vi.waitFor(() => {
      expect(fixture.execute).toHaveBeenCalledTimes(2);
    });
  });

  /** A target edit unlocks retry through bounded editor metadata without hashing its full text. */
  it('retries resource-stalled enrichment after the target document version changes', async () => {
    const failure = new PreviewBuildStalledError(
      TARGET.request.documentPath,
      'bundling-modules',
      45_000,
      'watchdog',
    );
    const fixture = createFixture({ failure });
    const versionedTarget = createVersionedTarget(7, 3);
    const editedTarget = createVersionedTarget(8, 3);

    fixture.coordinator.schedule(
      versionedTarget,
      'fast-1',
      30,
      new AbortController().signal,
      false,
    );
    await vi.waitFor(() => {
      expect(fixture.execute).toHaveBeenCalledTimes(1);
    });
    fixture.coordinator.schedule(editedTarget, 'fast-2', 31, new AbortController().signal, false);
    await vi.waitFor(() => {
      expect(fixture.execute).toHaveBeenCalledTimes(2);
    });
  });

  /** Unsaved dependency edits also unlock retry through their exact document revisions. */
  it('retries resource-stalled enrichment after a dependency document version changes', async () => {
    const failure = new PreviewBuildStalledError(
      TARGET.request.documentPath,
      'bundling-modules',
      45_000,
      'memory',
    );
    const fixture = createFixture({ failure });
    const versionedTarget = createVersionedTarget(7, 3);
    const editedDependencyTarget = createVersionedTarget(7, 4);

    fixture.coordinator.schedule(
      versionedTarget,
      'fast-1',
      32,
      new AbortController().signal,
      false,
    );
    await vi.waitFor(() => {
      expect(fixture.execute).toHaveBeenCalledTimes(1);
    });
    fixture.coordinator.schedule(
      editedDependencyTarget,
      'fast-2',
      33,
      new AbortController().signal,
      false,
    );
    await vi.waitFor(() => {
      expect(fixture.execute).toHaveBeenCalledTimes(2);
    });
  });

  /** Scheduler preemption with a live owning revision is retried once behind foreground work. */
  it('retries context enrichment after scheduler preemption', async () => {
    const fixture = createFixture({
      failureSequence: [new PreviewBuildCancelledError(), undefined],
    });

    fixture.coordinator.schedule(TARGET, 'fast', 14, new AbortController().signal, false);
    await vi.waitFor(() => {
      expect(fixture.callbacks.commit).toHaveBeenCalledOnce();
    });

    expect(fixture.execute).toHaveBeenCalledTimes(2);
    expect(fixture.execute.mock.calls[0]?.[0]).toMatchObject({
      buildIntent: 'context-enrichment',
      preparationMode: 'full',
    });
  });

  /** Transient queue pressure is not remembered as a deterministic graph-cost failure. */
  it('does not suppress a retry after queue-capacity pressure', async () => {
    const fixture = createFixture({
      failure: new PreviewBuildStalledError(
        TARGET.request.documentPath,
        undefined,
        0,
        'queue-capacity',
      ),
    });

    fixture.coordinator.schedule(TARGET, 'same-fast', 15, new AbortController().signal, false);
    await vi.waitFor(() => {
      expect(fixture.execute).toHaveBeenCalledTimes(1);
    });
    fixture.coordinator.schedule(TARGET, 'same-fast', 16, new AbortController().signal, false);
    await vi.waitFor(() => {
      expect(fixture.execute).toHaveBeenCalledTimes(2);
    });
  });
});

/** Observable coordinator collaborators created for one isolated behavior assertion. */
interface EnrichmentFixture {
  readonly callbacks: {
    [Key in keyof PreviewContextEnrichmentCallbacks]: ReturnType<typeof vi.fn>;
  };
  readonly coordinator: PreviewContextEnrichmentCoordinator;
  readonly execute: ReturnType<typeof vi.fn>;
  readonly releaseArtifact: ReturnType<typeof vi.fn>;
}

/** Optional result and ownership controls for a coordinator fixture. */
interface EnrichmentFixtureOptions {
  readonly current?: boolean;
  readonly failure?: Error;
  readonly failureSequence?: readonly (Error | undefined)[];
}

/** Creates one coordinator with observable application and presentation boundaries. */
function createFixture(options: EnrichmentFixtureOptions = {}): EnrichmentFixture {
  let attempt = 0;
  const execute = vi.fn<BuildPreview['execute']>((_request, context) => {
    context?.reportProgress?.('bundling-modules');
    const failure =
      options.failureSequence === undefined ? options.failure : options.failureSequence[attempt++];
    return failure === undefined
      ? Promise.resolve(createPreparedPreview())
      : Promise.reject(failure);
  });
  const releaseArtifact = vi.fn(() => Promise.resolve());
  const callbacks = {
    commit: vi.fn(),
    complete: vi.fn(),
    isCurrent: vi.fn(() => options.current ?? true),
    reportFailure: vi.fn(),
  };
  const coordinator = new PreviewContextEnrichmentCoordinator({
    buildPreview: {
      execute,
      releaseArtifact,
    },
    callbacks,
    renderMode: 'page-inspector',
  });
  return { callbacks, coordinator, execute, releaseArtifact };
}

/** Immutable source target retained across fast and full preparation passes. */
const TARGET = {
  documentName: 'src/Target.tsx',
  documentUri: {},
  request: {
    dependencySnapshots: [],
    documentPath: '/workspace/src/Target.tsx',
    language: 'tsx',
    sourceText: 'export default function Target() { return null; }',
    workspaceRoot: '/workspace',
  },
} as unknown as ResolvedPreviewTarget;

/** Creates editor-backed snapshots whose source bytes stay fixed while revisions change. */
function createVersionedTarget(
  documentVersion: number,
  dependencyVersion: number,
): ResolvedPreviewTarget {
  return {
    ...TARGET,
    request: {
      ...TARGET.request,
      dependencySnapshots: [
        {
          documentPath: '/workspace/src/Dependency.tsx',
          documentVersion: dependencyVersion,
          language: 'tsx',
          sourceText: 'export const Dependency = () => null;',
        },
      ],
      documentVersion,
    },
  };
}

/** Creates one complete-context artifact produced after browser settlement. */
function createPreparedPreview(): PreparedPreview {
  return {
    artifact: {
      contentHash: 'full',
      scriptLocation: 'file:///artifacts/entry-full.js',
    },
    dependencies: [TARGET.request.documentPath],
    diagnostics: [],
    watchDirectories: [],
  };
}
