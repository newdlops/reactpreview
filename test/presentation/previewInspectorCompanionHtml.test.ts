/** Verifies that the dedicated Inspector tab remains inert and forwards only bounded controls. */
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { createPreviewInspectorCompanionHtml } from '../../src/presentation/webview/previewInspectorCompanionHtml';

describe('Preview Inspector companion HTML', () => {
  /** Uses a nonce-only script policy and never loads the generated project preview entry. */
  it('creates a self-contained extension-owned Inspector document', () => {
    const html = createPreviewInspectorCompanionHtml({
      cspSource: 'vscode-webview://inspector-test',
      documentName: 'Target.tsx',
      nonce: 'test-nonce',
    });

    expect(html).toContain('script-src &#39;nonce-test-nonce&#39;');
    expect(html).toContain('React Inspector: Target.tsx');
    expect(html).toContain('Waiting for Target.tsx to finish its first render.');
    expect(html).toContain("type: 'react-preview-inspector-companion-ready'");
    expect(html).toContain("type: 'react-preview-inspector-companion-action'");
    expect(html).toContain("type: 'react-preview-inspector-companion-open-source'");
    expect(html).toContain("message?.type === 'react-preview-inspector-companion-snapshot'");
    expect(html).not.toContain('script-src vscode-webview://inspector-test');
    expect(html).not.toContain('type="module"');
    const embeddedScript = /<script nonce="[^"]+">([\s\S]+)<\/script>/u.exec(html)?.[1];
    if (embeddedScript === undefined) throw new Error('Companion script was not emitted.');
    expect(() => new Script(embeddedScript)).not.toThrow();
  });

  /** Removes active markup/resource attributes and forces the shell into the dedicated tab bounds. */
  it('sanitizes mirrored markup before insertion', () => {
    const html = createPreviewInspectorCompanionHtml({
      cspSource: 'vscode-webview://inspector-test',
      documentName: '<Unsafe>.tsx',
      nonce: 'nonce-value',
    });

    expect(html).toContain('const allowedTags = new Set([');
    expect(html).toContain("'ARTICLE', 'ASIDE'");
    expect(html).toContain("'DIV', 'HEADER', 'INPUT'");
    expect(html).toContain("'checked', 'class', 'disabled', 'hidden', 'id'");
    expect(html).toContain("name.startsWith('data-rpi-')");
    expect(html).toContain(".replace(/@import[^;]*(?:;|$)/giu, '')");
    expect(html).toContain('data-react-preview-companion-source="true"');
    expect(html).toContain('display:grid!important');
    expect(html).toContain('max-width:100%!important;min-width:0!important');
    expect(html).toContain('overflow:hidden!important');
    expect(html).toContain('&lt;Unsafe&gt;.tsx');
  });

  /** Keeps pane resizing local to the inert tab with responsive and persisted proportions. */
  it('installs an accessible responsive Components and Details splitter', () => {
    const html = createPreviewInspectorCompanionHtml({
      cspSource: 'vscode-webview://inspector-test',
      documentName: 'Resizable.tsx',
      nonce: 'resize-nonce',
    });

    expect(html).toContain(
      "PREVIEW_INSPECTOR_COMPANION_PANE_STATE_KEY = 'reactPreviewInspectorPaneLayout'",
    );
    expect(html).toContain("handle.setAttribute('role', 'separator')");
    expect(html).toContain(
      "handle.setAttribute('aria-label', 'Resize Components and Details panes')",
    );
    expect(html).toContain('installPreviewInspectorCompanionPaneResize();');
    expect(html).not.toContain('installPreviewInspectorCompanionFlowchartViewport();');
    expect(html).toContain('data-rpi-flow-resolver-collapsed="true"');
    expect(html).toContain('new ResizeObserver(refresh)');
    expect(html).toContain('vscode.setState?.({');
    expect(html).toContain('.rpi-workbench[data-rpi-pane-axis="columns"]');
    expect(html).toContain('.rpi-workbench[data-rpi-pane-axis="rows"]');
  });

  /** Leaves retired blocker-graph camera code out of the boolean-switch Inspector. */
  it('does not install the retired render-flow camera bridge', () => {
    const html = createPreviewInspectorCompanionHtml({
      cspSource: 'vscode-webview://inspector-test',
      documentName: 'Flowchart.tsx',
      nonce: 'flowchart-nonce',
    });

    expect(html).not.toContain('PREVIEW_INSPECTOR_COMPANION_FLOWCHART_STATE_KEY');
    expect(html).not.toContain('handlePreviewInspectorCompanionFlowchartCommand');
    expect(html).not.toContain('--rpi-companion-flowchart-zoom');
    const clickBridge = html.slice(
      html.indexOf("mirror.addEventListener('click'"),
      html.indexOf("mirror.addEventListener('dblclick'"),
    );
    expect(clickBridge).toContain("postControlEvent(control, 'click')");
  });

  /** Preserves every named Inspector viewport while allowing only explicit tree reveals. */
  it('restores document and named navigation scroll regions across inert snapshots', () => {
    const html = createPreviewInspectorCompanionHtml({
      cspSource: 'vscode-webview://inspector-test',
      documentName: 'Scrollable.tsx',
      nonce: 'scroll-nonce',
    });

    expect(html).toContain('function captureCompanionScrollSnapshot()');
    expect(html).toContain('function restoreCompanionScrollSnapshot(snapshot)');
    expect(html).toContain('function readCompanionScrollRegionKey(viewport)');
    expect(html).toContain('function readCompanionScrollRegions()');
    expect(html).toContain("mirror.querySelectorAll?.('[data-rpi-scroll-key]')");
    expect(html).toContain("['.rpi-tree-scroll', 'components-tree']");
    expect(html).toContain("['.rpi-detail-scroll', 'component-details']");
    expect(html).toContain("['.rpi-console-list', 'component-console']");
    expect(html).toContain("['textarea.rpi-json', 'component-json-editor']");
    expect(html).toContain('previewInspectorCompanionScrollState.regionByKey');
    expect(html).toContain('rememberCompanionScrollBeforeInteraction();');
    expect(html).toContain('if (control.matches(\'[data-react-preview-source-open="true"]\'))');
    expect(html).toContain('scheduleCompanionScrollRestoration(');
    expect(html).toContain('PREVIEW_INSPECTOR_COMPANION_SCROLL_SETTLE_MS');
    expect(html).toContain('controlScrollLeft');
    expect(html).toContain('() => revealCompanionTreeRow(message.treeReveal)');
    expect(html).toContain('.rpi-console-list,.rpi-json{overflow-anchor:none!important}');
    expect(html).toContain("row?.closest?.('.rpi-tree-scroll')");
    expect(html).not.toContain('hasTreeViewport');
    expect(html).not.toContain('scrollIntoView');
  });
});
