/** Verifies the compact UI contract for exact picked-host visibility controls. */
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorHiddenElementsUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorHiddenElementsUiRuntimeSource';
import { createPreviewInspectorTreeNodeUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorTreeNodeUiRuntimeSource';

describe('Preview Inspector hidden-element UI runtime source', () => {
  /** Keeps hiding explicit, reversible, and understandable without adding a new details tab. */
  it('renders pick-dependent hide and bounded restore controls', () => {
    const source = createPreviewInspectorHiddenElementsUiRuntimeSource();

    expect(source).toContain('function PreviewInspectorHiddenElementControls()');
    expect(source).toContain('canHidePreviewInspectorPickedElement()');
    expect(source).toContain('hidePreviewInspectorPickedElement');
    expect(source).toContain('restoreLastPreviewInspectorHiddenElement');
    expect(source).toContain('restoreAllPreviewInspectorHiddenElements');
    expect(source).toContain("'Hide picked'");
    expect(source).toContain("'Undo hide'");
    expect(source).toContain("'Hidden: '");
  });

  /** Shows visibility ownership on the exact component row without rescanning hidden records there. */
  it('adds one cached hidden-host count badge to component rows', () => {
    const source = createPreviewInspectorTreeNodeUiRuntimeSource();

    expect(source).toContain('countPreviewInspectorHiddenElementsForTreeNode(node.id)');
    expect(source).toContain("'hidden ' + String(hiddenHostCount)");
  });
});
