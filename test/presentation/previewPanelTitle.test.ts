/** Verifies that editor chrome stays compact without weakening path-rich runtime diagnostics. */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createPreviewPanelTitle } from '../../src/presentation/previewPanelTitle';

describe('createPreviewPanelTitle', () => {
  /** Keeps only the target filename regardless of the workspace nesting depth. */
  it('returns the basename including its source extension', () => {
    const documentPath = path.join(
      path.parse(process.cwd()).root,
      'workspace',
      'packages',
      'legal',
      'company-owner-breadcrumb.tsx',
    );

    expect(createPreviewPanelTitle(documentPath)).toBe('company-owner-breadcrumb.tsx');
  });
});
