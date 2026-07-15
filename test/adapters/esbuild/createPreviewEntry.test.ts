/**
 * Verifies virtual-entry generation independently from the heavier real esbuild integration test.
 */
import { describe, expect, it } from 'vitest';
import { createPreviewEntry } from '../../../src/adapters/esbuild/createPreviewEntry';

describe('createPreviewEntry', () => {
  /** Uses project React, the modern client root, and the selected module's default export. */
  it('creates a browser entry for the selected component', () => {
    const entry = createPreviewEntry('/workspace/components/Card.tsx');

    expect(entry).toContain("import * as React from 'react'");
    expect(entry).toContain("import { createRoot } from 'react-dom/client'");
    expect(entry).toContain('import("/workspace/components/Card.tsx")');
    expect(entry).toContain('PreviewErrorBoundary');
    expect(entry).toContain("window.addEventListener('unhandledrejection'");
  });

  /** Encodes quotes and normalizes Windows separators instead of interpolating executable syntax. */
  it('encodes unusual path characters as a JavaScript string literal', () => {
    const entry = createPreviewEntry('C:\\workspace\\a"quote.tsx');

    expect(entry).toContain('C:/workspace/a\\"quote.tsx');
  });
});
