/** Exercises safe static HTML-shell parsing independently from VS Code webview rendering. */
import { describe, expect, it } from 'vitest';
import { parsePreviewDocumentShell } from '../../../src/adapters/esbuild/previewDocumentShell';
import { createPreviewDocumentShellRuntimeSource } from '../../../src/adapters/esbuild/previewDocumentShellRuntimeSource';

describe('parsePreviewDocumentShell', () => {
  /** Preserves selector/layout attributes while excluding executable and unrelated document data. */
  it('extracts html, body, and preferred React mount attributes', () => {
    const shell = parsePreviewDocumentShell(`<!doctype html>
      <html lang="ko" dir="ltr" onload="unsafe()">
        <body class="body normal" data-tenant="preview" aria-label="ignored">
          <div id="splash"></div>
          <main id="root" class="application-shell" style="min-height: 100vh"></main>
        </body>
      </html>`);

    expect(shell).toEqual({
      bodyAttributes: [
        { name: 'class', value: 'body normal' },
        { name: 'data-tenant', value: 'preview' },
      ],
      htmlAttributes: [
        { name: 'lang', value: 'ko' },
        { name: 'dir', value: 'ltr' },
      ],
      rootAttributes: [
        { name: 'id', value: 'root' },
        { name: 'class', value: 'application-shell' },
        { name: 'style', value: 'min-height: 100vh' },
      ],
    });
  });

  /** Encodes values as data for DOM APIs rather than copying authored HTML into the webview. */
  it('generates an idempotent DOM-attribute adapter', () => {
    const shell = parsePreviewDocumentShell(
      '<html lang="ko"><body class="body"><div id="root"></div></body></html>',
    );
    const source = createPreviewDocumentShellRuntimeSource(shell);

    expect(source).toContain('initializePreviewDocumentShell');
    expect(source).toContain('applyPreviewDocumentAttributes');
    expect(source).toContain('"bodyAttributes":[{"name":"class","value":"body"}]');
    expect(source).toContain('"rootAttributes":[{"name":"id","value":"root"}]');
    expect(source).not.toContain('<body');
  });
});
