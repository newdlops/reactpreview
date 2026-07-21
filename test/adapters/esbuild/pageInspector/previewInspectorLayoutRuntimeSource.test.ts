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

  /** Keeps authored logical-AND choices compact and readable inside the component-tree row. */
  it('styles inline boolean switches without pushing controls outside narrow tree rows', () => {
    const source = createPreviewInspectorLayoutRuntimeSource();

    expect(source).toContain('.rpi-tree-condition-controls{align-items:center;display:inline-flex');
    expect(source).toContain(
      '.rpi-tree-condition-controls>.rpi-row-action{flex:0 0 auto;margin-left:0}',
    );
    expect(source).toContain('.rpi-tree-condition-switch[aria-checked="true"]');
    expect(source).toContain('.rpi-tree-condition-reset{max-width:64px');
    expect(source).toContain(
      '.rpi-tree-condition-controls{flex:0 0 auto;margin-left:auto}.rpi-tree-condition-controls>.rpi-row-action{flex:0 0 auto;margin-left:0}',
    );
  });

  /** Removes every graph/setup stylesheet while preserving owner-local blocker detail styling. */
  it('omits retired graph, setup navigation, and simple resolver CSS', () => {
    const source = createPreviewInspectorLayoutRuntimeSource();

    expect(source).toContain('.rpi-blocker-editor{min-height:100%}');
    expect(source).toContain('@container rpi-inspector (max-width:460px)');
    expect(source).not.toContain('.rpi-flowchart');
    expect(source).not.toContain('.rpi-flow-overview');
    expect(source).not.toContain('.rpi-blocker-navigation-scroll');
    expect(source).not.toContain('.rpi-simple-resolver');
  });
});
