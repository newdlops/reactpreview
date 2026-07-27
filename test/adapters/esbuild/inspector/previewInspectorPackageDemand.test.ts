import { describe, expect, it } from 'vitest';
import { createPreviewInspectorPackageDemandPathSet } from '../../../../src/adapters/esbuild/inspector/previewInspectorPackageDemand';

describe('createPreviewInspectorPackageDemandPathSet', () => {
  it('deduplicates and sorts every demanded source before an esbuild rebuild starts', () => {
    expect([
      ...createPreviewInspectorPackageDemandPathSet(['/z.ts', '/a.ts', '/z.ts', '/m.ts']),
    ]).toEqual(['/a.ts', '/m.ts', '/z.ts']);
  });
});
