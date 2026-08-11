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

  /** Retains the variable binding that gives an anonymous arrow component its importable name. */
  it('recovers an anonymous arrow page binding behind a project HOC', () => {
    const sourceText = [
      'const DashboardPage = () => <main>Dashboard</main>;',
      'export default withPagePermission(DashboardPage, "DashboardPage");',
    ].join('\n');

    expect(
      resolvePreviewReactLocalComponentSurface({
        exportName: 'default',
        sourcePath: '/workspace/DashboardPage.tsx',
        sourceText,
      }),
    ).toMatchObject({
      bypassedWrapperNames: ['withPagePermission'],
      localName: 'DashboardPage',
      preservedWrapperKinds: [],
    });
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
