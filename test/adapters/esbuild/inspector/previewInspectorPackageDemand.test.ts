import { describe, expect, it } from 'vitest';
import { createPreviewInspectorPackageDemandPathSet } from '../../../../src/adapters/esbuild/inspector/previewInspectorPackageDemand';

describe('createPreviewInspectorPackageDemandPathSet', () => {
  it('deduplicates, sorts, and caps initial demand before an esbuild rebuild starts', () => {
    expect([
      ...createPreviewInspectorPackageDemandPathSet(['/z.ts', '/a.ts', '/z.ts', '/m.ts'], 2),
    ]).toEqual(['/a.ts', '/m.ts']);
  });
});
