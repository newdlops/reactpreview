/**
 * Tests CSP constraints and contextual escaping for generated preview webview documents.
 */
import { describe, expect, it } from 'vitest';
import { createPreviewHtml } from '../../src/presentation/webview/previewHtml';

const CSP_SOURCE = 'vscode-webview://unit-test';

describe('createPreviewHtml', () => {
  /** Loads generated artifacts externally while keeping scripts and connections tightly restricted. */
  it('renders a ready document with a restrictive CSP', () => {
    const html = createPreviewHtml(CSP_SOURCE, {
      documentName: 'Card.tsx',
      kind: 'ready',
      scriptUri: 'vscode-webview://unit-test/entry.js?x=1&y=2',
      stylesheetUri: 'vscode-webview://unit-test/entry.css',
    });

    expect(html).toContain(`script-src ${CSP_SOURCE}`);
    expect(html).toContain('connect-src &#39;none&#39;');
    expect(html).toContain('worker-src &#39;none&#39;');
    expect(html).not.toContain('unsafe-eval');
    expect(html).not.toContain("script-src 'unsafe-inline'");
    expect(html).toContain('type="module"');
    expect(html).toContain('entry.js?x=1&amp;y=2');
  });

  /** Escapes compiler-controlled text so diagnostics cannot create webview tags or scripts. */
  it('escapes dynamic error content', () => {
    const attack = '<img src=x onerror="alert(1)">';
    const html = createPreviewHtml(CSP_SOURCE, {
      details: attack,
      kind: 'error',
      message: attack,
      title: attack,
    });

    expect(html).not.toContain(attack);
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });
});
