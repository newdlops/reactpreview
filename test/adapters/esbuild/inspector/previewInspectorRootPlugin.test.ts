/** Verifies that an ancestor plan becomes the existing browser target descriptor contract. */
import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorRootSource,
  type PreviewInspectorAncestorPlan,
} from '../../../../src/adapters/esbuild/inspector';

const TARGET_PATH = '/workspace/application/Target.tsx';
const PAGE_PATH = '/workspace/application/Page.tsx';

/** Creates the minimum immutable plan used by source-generation assertions. */
function createPlan(root: PreviewInspectorAncestorPlan['root']): PreviewInspectorAncestorPlan {
  return {
    complete: true,
    dependencyPaths: [PAGE_PATH, TARGET_PATH],
    edges: [
      {
        child: { exportName: 'Target', sourcePath: TARGET_PATH },
        childAutomaticProps: { enabled: true },
        localOwnerDepth: 0,
        localOwnerNames: [],
        occurrenceStart: 42,
        owner: { exportName: 'Page', sourcePath: PAGE_PATH },
      },
    ],
    root,
    rootAutomaticProps: { route: '/preview' },
    stopReason: 'root-reached',
    target: { exportName: 'Target', sourcePath: TARGET_PATH },
    targetAutomaticProps: { enabled: true },
  };
}

describe('createPreviewInspectorRootSource', () => {
  /** Imports an actual named owner and exposes ancestry plus editable target/root props. */
  it('emits one real-owner descriptor for the unchanged preview browser entry', () => {
    const source = createPreviewInspectorRootSource({
      displayName: 'Target inspector',
      plan: createPlan({ exportName: 'Page', sourcePath: PAGE_PATH }),
    });

    expect(source).toContain(
      'import { Page as __reactPreviewInspectorRoot } from "/workspace/application/Page.tsx";',
    );
    expect(source).toContain('"automaticProps":{"route":"/preview"}');
    expect(source).toContain('"targetAutomaticProps":{"enabled":true}');
    expect(source).toContain('"displayName":"Target inspector"');
    expect(source).toContain('"stopReason":"root-reached"');
    expect(source).toContain('export const previewTheme = undefined;');
  });

  /** Uses the direct facade when the target itself is the best importable mount root. */
  it('keeps direct-root target instrumentation active', () => {
    const source = createPreviewInspectorRootSource({
      plan: createPlan({ exportName: 'Target', sourcePath: TARGET_PATH }),
    });

    expect(source).toContain(
      'import { Target as __reactPreviewInspectorRoot } from "react-preview:inspector-target-facade";',
    );
  });
});
