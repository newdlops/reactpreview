/**
 * Verifies virtual-entry generation independently from the heavier real esbuild integration test.
 */
import { describe, expect, it } from 'vitest';
import { createPreviewEntry } from '../../../src/adapters/esbuild/createPreviewEntry';

describe('createPreviewEntry', () => {
  /** Uses project React, the modern client root, and the selected module's default export. */
  it('creates a browser entry for the selected component', () => {
    const entry = createPreviewEntry();

    expect(entry).toContain("import * as React from 'react'");
    expect(entry).toContain("import { createRoot } from 'react-dom/client'");
    expect(entry).toContain('import("react-preview:target")');
    expect(entry).toContain('PreviewErrorBoundary');
    expect(entry).toContain("window.addEventListener('unhandledrejection'");
  });

  /** Keeps filesystem paths out of the runtime entry behind the private target bridge. */
  it('does not expose a workspace path in generated runtime source', () => {
    const entry = createPreviewEntry();

    expect(entry).not.toContain('/workspace/');
  });
});
