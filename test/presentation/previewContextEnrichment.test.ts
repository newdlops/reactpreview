/** Verifies browser-settlement gating and non-fatal full-context enrichment behavior. */
import { describe, expect, it, vi } from 'vitest';
import type { BuildPreview } from '../../src/application/buildPreview';
import type { PreparedPreview } from '../../src/domain/preview';
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
}

/** Creates one coordinator with observable application and presentation boundaries. */
function createFixture(options: EnrichmentFixtureOptions = {}): EnrichmentFixture {
  const execute = vi.fn<BuildPreview['execute']>((_request, context) => {
    context?.reportProgress?.('bundling-modules');
    return options.failure === undefined
      ? Promise.resolve(createPreparedPreview())
      : Promise.reject(options.failure);
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
