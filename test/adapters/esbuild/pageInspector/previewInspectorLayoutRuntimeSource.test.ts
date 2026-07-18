/** Verifies Inspector layout CSS invariants without requiring a browser or project component tree. */
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorLayoutRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorLayoutRuntimeSource';

describe('Preview Inspector layout runtime source', () => {
  /** Deep nesting must increase intrinsic width so the scroll container owns horizontal overflow. */
  it('keeps deeply nested tree rows readable through horizontal scrolling', () => {
    const source = createPreviewInspectorLayoutRuntimeSource();

    expect(source).toContain(
      '.rpi-tree-scroll{min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable}',
    );
    expect(source).toContain(
      '.rpi-tree,.rpi-tree-group{box-sizing:border-box;list-style:none;margin:0;min-width:100%;width:max-content}',
    );
    expect(source).toContain('flex-wrap:nowrap');
    expect(source).toContain('max-width:none;min-height:27px;min-width:360px');
  });
});
