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
    expect(html).toContain('<div id="react-preview-root"></div>');
    expect(html).not.toContain('<main id="react-preview-root">');
  });

  /** Keeps gallery chrome identifiable without imposing presentation rules on target descendants. */
  it('scopes minimal multi-export chrome outside rendered component styles', () => {
    const html = createPreviewHtml(CSP_SOURCE, {
      documentName: 'Components.tsx',
      kind: 'ready',
      scriptUri: 'vscode-webview://unit-test/entry.js',
    });
    const stylesheet = readInlineStylesheet(html);
    const galleryRule = readCssRule(stylesheet, '.react-preview-gallery');
    const labelRule = readCssRule(stylesheet, '.react-preview-export-label');
    const runtimeErrorRule = readCssRule(
      stylesheet,
      '#react-preview-root .react-preview-runtime-error',
    );
    const errorRule = readCssRule(stylesheet, '#react-preview-root .react-preview-export-error');

    expect(stylesheet).toContain('.react-preview-empty-gallery');
    expect(stylesheet).toContain('.react-preview-export-label::before');
    expect(galleryRule).toContain('counter-reset: react-preview-export');
    expect(labelRule).toContain('all: initial');
    expect(labelRule).toContain('counter-increment: react-preview-export');
    expect(runtimeErrorRule).toContain('all: initial !important');
    expect(errorRule).toContain('all: initial !important');
    expect(stylesheet).not.toMatch(/\.react-preview-gallery\s+[^,{]+\{/u);
    expect(readAllInitialSelectors(stylesheet)).toEqual([
      '#react-preview-root .react-preview-runtime-error',
      '.react-preview-export-label',
      '#react-preview-root .react-preview-export-error',
    ]);
    expect(galleryRule).not.toMatch(
      /\b(?:all|font|color|background|overflow|contain|transform|padding)\s*:/u,
    );
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

/**
 * Reads the extension-owned inline stylesheet without including an optional project stylesheet.
 *
 * @param html Complete webview document returned by the presentation adapter.
 * @returns CSS text from the first inline style element.
 */
function readInlineStylesheet(html: string): string {
  const match = /<style>([\s\S]*?)<\/style>/u.exec(html);
  if (match?.[1] === undefined) {
    throw new Error('Expected the preview document to contain an inline stylesheet.');
  }
  return match[1];
}

/**
 * Extracts one flat chrome rule so tests can reject inherited target styling independently.
 *
 * @param stylesheet Inline extension stylesheet containing the requested selector.
 * @param selector Exact class selector whose declarations should be inspected.
 * @returns Declaration text between the selector's braces.
 */
function readCssRule(stylesheet: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, 'u').exec(stylesheet);
  if (match?.[1] === undefined) {
    throw new Error(`Expected the preview stylesheet to contain ${selector}.`);
  }
  return match[1];
}

/**
 * Lists the exact selectors that establish an isolated extension-chrome presentation boundary.
 *
 * @param stylesheet Inline extension stylesheet inspected for `all: initial` declarations.
 * @returns Selector text in stylesheet order with surrounding whitespace removed.
 */
function readAllInitialSelectors(stylesheet: string): readonly string[] {
  return [...stylesheet.matchAll(/([^{}]+)\{[^{}]*\ball:\s*initial\b[^{}]*\}/gu)].map(
    (match) => match[1]?.trim() ?? '',
  );
}
