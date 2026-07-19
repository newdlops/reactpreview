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
    expect(html).toContain('new ResizeObserver(refresh)');
    expect(html).toContain('vscode.setState?.({');
    expect(html).toContain('.rpi-workbench[data-rpi-pane-axis="columns"]');
    expect(html).toContain('.rpi-workbench[data-rpi-pane-axis="rows"]');
  });
});
