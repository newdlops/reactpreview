/** Verifies background artifact identities and strict host-side metadata validation. */
import { describe, expect, it } from 'vitest';
import type { PreviewBundle } from '../../../src/domain/preview';
import {
  attachPreviewArtifactMetadata,
  planPreviewArtifactLayout,
} from '../../../src/adapters/vscode/previewArtifactLayout';

const BUNDLE: PreviewBundle = {
  chunks: [{ contents: new Uint8Array([3, 4]), relativePath: 'chunks/lazy.js' }],
  dependencies: [],
  diagnostics: [],
  javascript: new Uint8Array([1, 2]),
  stylesheet: new Uint8Array([5]),
  watchDirectories: [],
};

describe('previewArtifactLayout metadata', () => {
  /** Produces the same layout when trusted worker digests replace host-side byte hashing. */
  it('attaches reusable publication identities', () => {
    const directLayout = planPreviewArtifactLayout(BUNDLE);
    const preparedBundle = attachPreviewArtifactMetadata(BUNDLE);
    const preparedLayout = planPreviewArtifactLayout(preparedBundle);

    expect(preparedBundle.artifactMetadata).toBeDefined();
    expect(preparedLayout).toEqual(directLayout);
  });

  /** Keeps metadata validation independent from host-locale punctuation and case ordering. */
  it('validates several chunk paths with the artifact byte-order policy', () => {
    const bundle: PreviewBundle = {
      ...BUNDLE,
      chunks: [
        { contents: new Uint8Array([1]), relativePath: 'chunks/a-file.js' },
        { contents: new Uint8Array([2]), relativePath: 'chunks/A_file.js' },
        { contents: new Uint8Array([3]), relativePath: 'chunks/Z.js' },
        { contents: new Uint8Array([4]), relativePath: 'chunks/z.css' },
      ],
    };

    const preparedBundle = attachPreviewArtifactMetadata(bundle);

    expect(planPreviewArtifactLayout(preparedBundle)).toEqual(planPreviewArtifactLayout(bundle));
  });

  /** Rejects malformed worker metadata before it can enter shared artifact path state. */
  it('validates digest shape and exact chunk alignment', () => {
    const preparedBundle = attachPreviewArtifactMetadata(BUNDLE);
    const metadata = preparedBundle.artifactMetadata;
    expect(metadata).toBeDefined();
    if (metadata === undefined) {
      return;
    }

    expect(() =>
      planPreviewArtifactLayout({
        ...preparedBundle,
        artifactMetadata: { ...metadata, entryDigest: 'not-a-digest' },
      }),
    ).toThrow('Invalid background preview artifact metadata');
  });
});
