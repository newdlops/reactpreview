import { describe, expect, it } from 'vitest';
import { freezePreviewInspectorPageCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorAncestorFreezing';

describe('freezePreviewInspectorPageCandidate', () => {
  /** A data/branch-gated child still belongs at its authored position inside the retained page. */
  it('does not detach a deferred JSX target from its page flow', () => {
    const candidate = freezePreviewInspectorPageCandidate({
      complete: true,
      dependencies: new Set(['/workspace/Feed.tsx', '/workspace/Page.tsx']),
      edges: [],
      id: 'conditional-feed',
      renderPath: {
        id: 'conditional-feed-path',
        steps: [
          {
            certainty: 'conditional',
            invocation: { deferred: true, mode: 'jsx' },
            kind: 'component-render',
            label: 'Feed',
            occurrenceStart: 20,
            sourcePath: '/workspace/Feed.tsx',
            wrapperNames: [],
          },
          {
            certainty: 'confirmed',
            kind: 'component-render',
            label: 'Page',
            occurrenceStart: 10,
            sourcePath: '/workspace/Page.tsx',
            wrapperNames: [],
          },
        ],
      },
      root: { exportName: 'Page', sourcePath: '/workspace/Page.tsx' },
      rootAutomaticProps: {},
      rootOwnsRouter: false,
      stopReason: 'root-reached',
      targetAutomaticProps: {},
    });

    expect(candidate.detachedTargetPlacement).toBeUndefined();
  });

  /** Compiler-proven overlay wrappers remain intentionally detached from document flow. */
  it('retains detached placement for an overlay target', () => {
    const candidate = freezePreviewInspectorPageCandidate({
      complete: true,
      dependencies: new Set(['/workspace/DialogContent.tsx']),
      edges: [],
      id: 'dialog-content',
      renderPath: {
        id: 'dialog-content-path',
        steps: [
          {
            certainty: 'conditional',
            invocation: { deferred: true, mode: 'jsx' },
            kind: 'component-render',
            label: 'DialogContent',
            occurrenceStart: 10,
            sourcePath: '/workspace/DialogContent.tsx',
            wrapperNames: ['DialogPortal'],
          },
        ],
      },
      root: { exportName: 'DialogContent', sourcePath: '/workspace/DialogContent.tsx' },
      rootAutomaticProps: {},
      rootOwnsRouter: false,
      stopReason: 'root-reached',
      targetAutomaticProps: {},
    });

    expect(candidate.detachedTargetPlacement).toBe('overlay-sibling');
  });
});
