/** Verifies publication concurrency decreases before large byte arrays enter filesystem promises. */
import { describe, expect, it } from 'vitest';
import { selectPreviewArtifactIoConcurrency } from '../../../src/adapters/vscode/previewArtifactIoPolicy';

/** Creates a minimal artifact-file-like record without depending on storage layout hashing. */
function createFile(bytes: number): never {
  return { contents: new Uint8Array(bytes), relativePath: 'entry.js' } as never;
}

describe('selectPreviewArtifactIoConcurrency', () => {
  it('reduces concurrent writes as total artifact bytes grow', () => {
    expect(selectPreviewArtifactIoConcurrency([])).toBe(8);
    expect(selectPreviewArtifactIoConcurrency([createFile(16 * 1024 * 1024)])).toBe(8);
    expect(selectPreviewArtifactIoConcurrency([createFile(16 * 1024 * 1024 + 1)])).toBe(4);
    expect(selectPreviewArtifactIoConcurrency([createFile(64 * 1024 * 1024 + 1)])).toBe(2);
  });
});
