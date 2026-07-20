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

  /** Keeps current-file blockers visibly distinct without relying on color alone. */
  it('emits current-file blocker card, border, badge, and summary emphasis', () => {
    const source = createPreviewInspectorLayoutRuntimeSource();

    expect(source).toContain(
      '.rpi-flow-node-shell[data-current-file-blocker="true"]>.rpi-flow-card',
    );
    expect(source).toContain('border-inline-start:4px solid var(--vscode-charts-yellow,#cca700)');
    expect(source).toContain('.rpi-current-file-blocker-badge');
    expect(source).toContain('.rpi-current-file-blocker-summary');
  });

  /** Keeps the debugger canvas readable in narrow companion tabs without inline geometry. */
  it('composes the responsive rank/lane flowchart stylesheet', () => {
    const source = createPreviewInspectorLayoutRuntimeSource();

    expect(source).toContain('.rpi-flowchart-viewport');
    expect(source).toContain('overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable');
    expect(source).toContain('.rpi-flowchart-canvas');
    expect(source).toContain('.rpi-flowchart-edge-cell[data-rpi-path=\\"start-down\\"]');
    expect(source).toContain('.rpi-flow-inspector-locate-guide');
    expect(source).toContain('.rpi-flowchart-camera-status');
    expect(source).toContain('@container rpi-inspector (max-width:460px)');
  });
});
