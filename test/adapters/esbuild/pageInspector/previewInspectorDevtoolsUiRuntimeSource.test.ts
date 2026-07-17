/** Verifies the isolated DevTools-style Page Inspector shell without executing project React code. */
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorDevtoolsUiRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewInspectorDevtoolsUiRuntimeSource';
import { createPreviewPageInspectorRuntimeSource } from '../../../../src/adapters/esbuild/pageInspector/previewPageInspectorRuntimeSource';

describe('Page Inspector DevTools UI runtime source', () => {
  /** Provides the requested docked Elements layout without inserting a wrapper into the app tree. */
  it('renders a collapsible two-pane inspector through the existing portal', () => {
    const source = createPreviewInspectorDevtoolsUiRuntimeSource();

    expect(source).toContain('\'.rpi-shell[data-dock="bottom"]');
    expect(source).toContain('\'.rpi-shell[data-dock="right"]');
    expect(source).toContain("'.rpi-workbench{display:grid");
    expect(source).toContain("'data-collapsed': collapsed");
    expect(source).toContain("dock === 'bottom' ? 'Dock right' : 'Dock bottom'");
    expect(source).toContain(
      "React.createElement('style', undefined, previewInspectorDevtoolsCss)",
    );
    expect(source).not.toContain("React.createElement('div', undefined, children");
  });

  /** Proves the composed Page Inspector entry uses this shell instead of the legacy floating form. */
  it('is integrated into the generated Page Inspector runtime', () => {
    const source = createPreviewPageInspectorRuntimeSource();

    expect(source).toContain('const previewInspectorDevtoolsCss');
    expect(source).toContain('function PreviewInspectorComponentsPane');
    expect(source).toContain('function PreviewInspectorDetailsPane');
    expect(source).not.toContain('const inspectorControlStyle');
  });

  /** Keeps the left pane component-only, searchable, accessible, and keyboard navigable. */
  it('emits an ARIA React component tree with filtering and directional keys', () => {
    const source = createPreviewInspectorDevtoolsUiRuntimeSource();

    expect(source).toContain("kind !== 'host' && kind !== 'html' && kind !== 'dom'");
    expect(source).toContain("'aria-label': 'Filter React components'");
    expect(source).toContain("role: 'tree'");
    expect(source).toContain("role: 'treeitem'");
    expect(source).toContain("event.key === 'ArrowDown' || event.key === 'ArrowUp'");
    expect(source).toContain("event.key === 'ArrowRight'");
    expect(source).toContain("event.key === 'ArrowLeft'");
    expect(source).toContain("event.key === 'Enter' || event.key === ' '");
    expect(source).toContain('onDoubleClick: toggle');
    expect(source).toContain('event.stopPropagation();');
    expect(source).toContain("'selected'");
    expect(source).toContain("'target'");
  });

  /** Separates editable instrumented props from observational Fiber props, state, and source. */
  it('renders guarded Props, read-only State, and adapter-owned Source details', () => {
    const source = createPreviewInspectorDevtoolsUiRuntimeSource();

    expect(source).toContain("['props', 'Props']");
    expect(source).toContain("['state', 'State']");
    expect(source).toContain("['source', 'Source']");
    expect(source).toContain('isPreviewInspectorUiNodeEditable');
    expect(source).toContain('Editable instrumented target/root props');
    expect(source).toContain('Read-only Fiber props snapshot');
    expect(source).toContain('Read-only component state / hooks snapshot');
    expect(source).toContain('previewInspectorApi.openSource(source)');
    expect(source).not.toContain('postMessage(');
    expect(source).not.toContain('acquireVsCodeApi');
  });

  /** Remains useful before a live collector or editor bridge has registered its optional methods. */
  it('falls back to static exports and bounds untrusted collector snapshots', () => {
    const source = createPreviewInspectorDevtoolsUiRuntimeSource();

    expect(source).toContain('createFallbackPreviewInspectorTreeSnapshot');
    expect(source).toContain("typeof collectTree !== 'function'");
    expect(source).toContain('counter.count >= 4096');
    expect(source).toContain('depth > 64');
    expect(source).toContain('normalized.occurrenceStart = source.occurrenceStart');
    expect(source).toContain("typeof source.path === 'string' ? source.path : source.sourcePath");
    expect(source).toContain("status: typeof snapshot?.status === 'string'");
    expect(source).toContain('truncated: snapshot?.truncated === true');
    expect(source).toContain("truncated ? 'bounded tree' : status ?? 'live tree'");
    expect(source).toContain("typeof previewInspectorApi.subscribeTree === 'function'");
    expect(source).toContain('setInterval(refresh, 750)');
    expect(source).not.toContain('_reactInternals');
    expect(source).not.toContain('_reactInternalFiber');
  });
});
