/** Verifies the persistence boundary between user-authored and automatic preview state. */
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorStateRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorStateRuntimeSource';

describe('Preview Inspector state runtime source', () => {
  /** Persists explicit JSON props while keeping modal auto-reveal values revision-local. */
  it('does not serialize the automatic resolver prop layer as user state', () => {
    const source = createPreviewInspectorStateRuntimeSource();

    expect(source).toContain('previewInspectorSession.overridesByExport');
    expect(source).toContain('overrides,');
    expect(source).toContain(
      'userSelectedPageCandidateId: previewInspectorSession.userSelectedPageCandidateId',
    );
    expect(source).not.toContain('resolverPropsByExport');
    expect(source).not.toContain('resolverPropsRevision');
  });
});
