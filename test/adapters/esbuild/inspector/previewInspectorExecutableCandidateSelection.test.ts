/** Verifies the pure one-candidate execution policy used before esbuild starts traversing imports. */
import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorVirtualPageCandidates,
  selectPreviewInspectorExecutableCandidate,
  type PreviewInspectorPageCandidate,
} from '../../../../src/adapters/esbuild/inspector';

/** Builds a minimal independently executable page candidate. */
function createCandidate(id: string, sourcePath: string): PreviewInspectorPageCandidate {
  return {
    complete: false,
    dependencyPaths: [sourcePath],
    edges: [],
    id,
    root: { exportName: 'default', sourcePath },
    rootAutomaticProps: {},
    rootOwnsRouter: false,
    stopReason: 'render-path-checkpoint',
    targetAutomaticProps: {},
  };
}

describe('selectPreviewInspectorExecutableCandidate', () => {
  /** Selects the ranked default without serializing alternate page imports into the first build. */
  it('returns the first candidate when no persisted selection exists', () => {
    const pages = createPreviewInspectorVirtualPageCandidates([
      createCandidate('first', '/workspace/First.tsx'),
      createCandidate('second', '/workspace/Second.tsx'),
    ]);

    expect(
      selectPreviewInspectorExecutableCandidate(pages, undefined)?.active.browserCandidate.id,
    ).toBe('first');
  });

  /** Uses a valid user choice and falls back honestly when a source update removed it. */
  it('selects a requested candidate or reports that it disappeared', () => {
    const pages = createPreviewInspectorVirtualPageCandidates([
      createCandidate('first', '/workspace/First.tsx'),
      createCandidate('second', '/workspace/Second.tsx'),
    ]);

    expect(selectPreviewInspectorExecutableCandidate(pages, 'second')).toMatchObject({
      active: { browserCandidate: { id: 'second' } },
      requestedCandidateWasUnavailable: false,
    });
    expect(selectPreviewInspectorExecutableCandidate(pages, 'removed')).toMatchObject({
      active: { browserCandidate: { id: 'first' } },
      requestedCandidateWasUnavailable: true,
    });
  });
});
