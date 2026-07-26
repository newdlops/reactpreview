import { describe, expect, it } from 'vitest';
import { resolvePreviewReactLocalComponentSurface } from '../../../../src/adapters/esbuild/staticResources/previewReactLocalComponentSurface';

describe('resolvePreviewReactLocalComponentSurface', () => {
  it('recovers a local page body from project HOCs while retaining React wrapper semantics', () => {
    const sourceText = [
      "import { memo, forwardRef } from 'react';",
      'const Page = forwardRef(function PageBody() { return <main />; });',
      'export default withPermission(memo(Page));',
    ].join('\n');

    const surface = resolvePreviewReactLocalComponentSurface({
      exportName: 'default',
      sourcePath: '/workspace/Page.tsx',
      sourceText,
    });

    expect(surface).toMatchObject({
      bypassedWrapperNames: ['withPermission'],
      localName: 'PageBody',
      preservedWrapperKinds: ['memo', 'forward-ref'],
    });
    expect(surface?.functionRange.start).toBeGreaterThan(0);
  });

  it('fails closed for an external export without a same-file body', () => {
    expect(
      resolvePreviewReactLocalComponentSurface({
        exportName: 'default',
        sourcePath: '/workspace/Page.tsx',
        sourceText: "export { default } from './ExternalPage';",
      }),
    ).toBeUndefined();
  });
});
