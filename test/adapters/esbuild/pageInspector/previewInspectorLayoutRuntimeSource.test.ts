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

  /** Keeps a usable content viewport after wrapped chrome consumes a compact display's height. */
  it('provides a shell scroll fallback without removing section-owned scrolling', () => {
    const source = createPreviewInspectorLayoutRuntimeSource();

    expect(source).toContain(
      'grid-template-rows:28px minmax(0,var(--rpi-toolbar-section-height,auto)) 9px 28px minmax(0,var(--rpi-context-section-height,auto)) 9px minmax(0,1fr)',
    );
    expect(source).toContain('max-height:calc(100dvh - 16px)');
    expect(source).toContain(
      '@media(max-height:560px){.rpi-shell{grid-template-rows:28px minmax(0,var(--rpi-toolbar-section-height,auto)) 9px 28px ',
    );
    expect(source).toContain('minmax(0,var(--rpi-context-section-height,auto)) 9px minmax(0,1fr)');
    expect(source).toContain('.rpi-section-accordion-toggle');
    expect(source).toContain('.rpi-shell-section-height-handle');
    expect(source).toContain(
      '.rpi-shell>.rpi-shell-section-height-handle[data-rpi-shell-region="toolbar"]{grid-row:3}',
    );
    expect(source).toContain(
      '.rpi-shell>.rpi-shell-section-height-handle[data-rpi-shell-region="context"]{grid-row:6}',
    );
    expect(source).toContain('.rpi-components-body>.rpi-section-height-handle{grid-row:2}');
    expect(source).toContain('height:9px;min-height:9px');
    expect(source).toContain('overflow-x:hidden;overflow-y:auto');
    expect(source).toContain('.rpi-workbench{min-height:0}');
    expect(source).toContain(
      '.rpi-detail-scroll{min-height:0;min-width:0;overflow:auto;overscroll-behavior:contain;scrollbar-gutter:stable}',
    );
  });

  /** Prevents page identity, status, and candidate controls from sharing an implicit grid row. */
  it('stacks every page-context item in its own intrinsic row', () => {
    const source = createPreviewInspectorLayoutRuntimeSource();

    expect(source).toContain(
      'display:grid;gap:6px;grid-auto-flow:row;grid-auto-rows:max-content;grid-template-columns:minmax(0,1fr)',
    );
    expect(source).toContain(
      '.rpi-page-context>*{grid-column:1!important;grid-row:auto!important;max-width:100%;min-width:0}',
    );
    expect(source).toContain('align-content:start;align-items:start');
    expect(source).not.toContain('font-weight:700;grid-row:1/3');
  });

  /** Makes collapse state legible without consuming excessive width in a docked tree. */
  it('uses a visible disclosure target and colors the expanded state', () => {
    const source = createPreviewInspectorLayoutRuntimeSource();

    expect(source).toContain('flex:0 0 20px');
    expect(source).toContain('font-size:14px;font-weight:800;height:20px');
    expect(source).toContain('.rpi-tree-row[aria-expanded="true"]>.rpi-twisty');
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

  /** Makes current-file switch dominance visible without replacing the table's scroll boundary. */
  it('styles nested JSX scenario guides and blocked descendants', () => {
    const source = createPreviewInspectorLayoutRuntimeSource();

    expect(source).toContain('.rpi-scenario-lineage-guide');
    expect(source).toContain('.rpi-scenario-lineage-summary');
    expect(source).toContain('tr[data-lineage-blocked="true"]');
    expect(source).toContain('.rpi-scenario-scroll{min-height:0;min-width:0;overflow:auto');
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
