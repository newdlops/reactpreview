import { describe, expect, it } from 'vitest';
import {
  createPreviewInspectorLocalComponentSlice,
  createPreviewInspectorSelectedExportSlice,
} from '../../../../src/adapters/esbuild/inspector/previewInspectorMountSurfaceSlice';

describe('createPreviewInspectorSelectedExportSlice', () => {
  it('keeps the selected declaration closure and direct styles while omitting unrelated exports/effects', () => {
    const result = createPreviewInspectorSelectedExportSlice({
      exportName: 'Selected',
      sourcePath: '/workspace/Views.tsx',
      sourceText: [
        "'use client';",
        "import React from 'react';",
        "import './views.css';",
        "import './bootstrap';",
        'const helper = () => <span />;',
        'export const Selected = () => <main><React.Fragment>{helper()}</React.Fragment></main>;',
        "import { Huge } from './Huge';",
        'export const Unrelated = () => <Huge />;',
      ].join('\n'),
    });

    expect(result).toMatchObject({ kind: 'success' });
    if (result.kind !== 'success') throw new Error('Expected selected export slice.');
    expect(result.slice.contents).toContain("import './views.css';");
    expect(result.slice.contents).toContain('const helper');
    expect(result.slice.contents).toContain('export const Selected');
    expect(result.slice.contents).not.toContain('Unrelated');
    expect(result.slice.contents).not.toContain("'./Huge'");
    expect(result.slice.contents).not.toContain("'./bootstrap'");
    expect(result.slice.omittedTopLevelEffectCount).toBe(1);
  });

  it('fails closed for top-level await', () => {
    expect(
      createPreviewInspectorSelectedExportSlice({
        exportName: 'Selected',
        sourcePath: '/workspace/Views.tsx',
        sourceText: 'await preload(); export const Selected = () => null;',
      }),
    ).toEqual({ kind: 'failure', reason: 'top-level-await' });
  });

  it('exports a proven local body while bypassing only its project-owned outer HOC', () => {
    const result = createPreviewInspectorLocalComponentSlice({
      localName: 'Page',
      preservedWrapperKinds: ['memo', 'forward-ref'],
      sourcePath: '/workspace/Page.tsx',
      sourceText: [
        "import { forwardRef, memo } from 'react';",
        'const Page = forwardRef(function PageBody() { return <main />; });',
        'export default withPermission(memo(Page));',
      ].join('\n'),
    });

    expect(result).toMatchObject({ kind: 'success' });
    if (result.kind !== 'success') throw new Error('Expected local component slice.');
    expect(result.slice.contents).toContain('const Page = forwardRef');
    expect(result.slice.contents).toContain('export default memo(Page);');
    expect(result.slice.contents).not.toContain('withPermission');
  });
});
