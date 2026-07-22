/** Verifies Next App Router's implicit page-to-layout ancestry without executing project code. */
import { describe, expect, it } from 'vitest';
import { collectPreviewInspectorNextAppLayoutChain } from '../../../../src/adapters/esbuild/inspector/previewInspectorNextAppLayoutChain';

describe('collectPreviewInspectorNextAppLayoutChain', () => {
  /** Preserves root-to-leaf wrappers while omitting route groups from the browser pathname. */
  it('collects every segment layout for a nested App Router page', () => {
    const pagePath = '/workspace/src/app/(account)/profile/edit/page.tsx';
    const result = collectPreviewInspectorNextAppLayoutChain({
      exportName: 'default',
      pagePath,
      sourcePaths: [
        pagePath,
        '/workspace/src/app/layout.tsx',
        '/workspace/src/app/(account)/layout.tsx',
        '/workspace/src/app/(account)/profile/layout.jsx',
      ],
    });

    expect(result).toEqual({
      layouts: [
        { exportName: 'default', params: {}, sourcePath: '/workspace/src/app/layout.tsx' },
        {
          exportName: 'default',
          params: {},
          sourcePath: '/workspace/src/app/(account)/layout.tsx',
        },
        {
          exportName: 'default',
          params: {},
          sourcePath: '/workspace/src/app/(account)/profile/layout.jsx',
        },
      ],
      routeLocation: {
        componentName: 'NextAppPage',
        evidenceKind: 'next-app-filesystem',
        pathname: '/profile/edit',
        params: {},
        pattern: '/profile/edit',
        searchParams: {},
        sourcePath: pagePath,
      },
    });
  });

  /** Materializes dynamic parameters while keeping authored segment syntax for diagnostics. */
  it('derives a bounded pathname from dynamic and optional catch-all segments', () => {
    const pagePath = '/workspace/app/company/[companyId]/[...section]/[[...tab]]/page.tsx';
    const result = collectPreviewInspectorNextAppLayoutChain({
      exportName: 'default',
      pagePath,
      sourcePaths: [
        pagePath,
        '/workspace/app/layout.tsx',
        '/workspace/app/company/[companyId]/layout.tsx',
      ],
    });

    expect(result?.routeLocation).toMatchObject({
      pathname: '/company/companyId/section',
      params: { companyId: 'companyId', section: ['section'], tab: [] },
      pattern: '/company/[companyId]/[...section]/[[...tab]]',
      searchParams: {},
    });
    expect(result?.layouts).toEqual([
      { exportName: 'default', params: {}, sourcePath: '/workspace/app/layout.tsx' },
      {
        exportName: 'default',
        params: { companyId: 'companyId' },
        sourcePath: '/workspace/app/company/[companyId]/layout.tsx',
      },
    ]);
  });

  /** Keeps every authored catch-all item because each value occupies one pathname segment. */
  it('preserves authored required and optional catch-all arrays', () => {
    const pagePath = '/workspace/app/docs/[...slug]/[[...view]]/page.tsx';
    const result = collectPreviewInspectorNextAppLayoutChain({
      dynamicParameterValues: { slug: ['guides', 'routing'], view: ['print', 'compact'] },
      exportName: 'default',
      pagePath,
      sourcePaths: ['/workspace/app/layout.tsx', pagePath],
    });

    expect(result?.routeLocation).toMatchObject({
      params: { slug: ['guides', 'routing'], view: ['print', 'compact'] },
      pathname: '/docs/guides/routing/print/compact',
    });
  });

  /** Next allows separate root layouts under leading route groups instead of `app/layout`. */
  it('accepts a multiple-root application whose root layout lives below a route group', () => {
    const pagePath = '/workspace/src/app/(shop)/cart/page.tsx';
    const groupLayout = '/workspace/src/app/(shop)/layout.tsx';
    const result = collectPreviewInspectorNextAppLayoutChain({
      exportName: 'default',
      pagePath,
      sourcePaths: ['/workspace/src/app/template.tsx', groupLayout, pagePath],
    });

    expect(result?.layouts.map((layout) => layout.sourcePath)).toEqual([groupLayout]);
    expect(result?.routeLocation.pathname).toBe('/cart');
  });

  /** An ordinary URL folder named `app` must not replace the outer App Router root. */
  it('keeps a nested ordinary app directory as a pathname segment', () => {
    const pagePath = '/workspace/src/app/download/app/page.tsx';
    const result = collectPreviewInspectorNextAppLayoutChain({
      exportName: 'default',
      pagePath,
      sourcePaths: ['/workspace/src/app/layout.tsx', pagePath],
    });

    expect(result?.routeLocation).toMatchObject({
      pathname: '/download/app',
      pattern: '/download/app',
    });
  });

  /** Segment templates wrap children inside their same-directory layouts in authored order. */
  it('collects root and nested templates in Next wrapper order', () => {
    const pagePath = '/workspace/app/dashboard/page.tsx';
    const result = collectPreviewInspectorNextAppLayoutChain({
      exportName: 'default',
      pagePath,
      sourcePaths: [
        '/workspace/app/layout.tsx',
        '/workspace/app/template.tsx',
        '/workspace/app/dashboard/layout.tsx',
        '/workspace/app/dashboard/template.jsx',
        pagePath,
      ],
    });

    expect(result?.layouts.map((layout) => layout.sourcePath)).toEqual([
      '/workspace/app/layout.tsx',
      '/workspace/app/template.tsx',
      '/workspace/app/dashboard/layout.tsx',
      '/workspace/app/dashboard/template.jsx',
    ]);
  });

  /** Private folders are excluded, while Next's encoded leading underscore remains routable. */
  it('rejects private folders and decodes an authored percent-escaped underscore route', () => {
    const sourcePaths = ['/workspace/app/layout.tsx'];
    expect(
      collectPreviewInspectorNextAppLayoutChain({
        exportName: 'default',
        pagePath: '/workspace/app/_components/page.tsx',
        sourcePaths,
      }),
    ).toBeUndefined();

    expect(
      collectPreviewInspectorNextAppLayoutChain({
        exportName: 'default',
        pagePath: '/workspace/app/%5Fadmin/page.tsx',
        sourcePaths,
      })?.routeLocation.pathname,
    ).toBe('/_admin');
  });

  /** Refuses to misrepresent a named parallel slot page as a layout's ordinary children branch. */
  it('omits an unproven parallel-slot page shell', () => {
    const pagePath = '/workspace/app/dashboard/@modal/(.)photo/[id]/page.tsx';
    expect(
      collectPreviewInspectorNextAppLayoutChain({
        exportName: 'default',
        pagePath,
        sourcePaths: [
          pagePath,
          '/workspace/app/layout.tsx',
          '/workspace/app/dashboard/layout.tsx',
          '/workspace/app/dashboard/@modal/default.tsx',
        ],
      }),
    ).toBeUndefined();
  });

  /** Intercepted branches also need active-route evidence that the bounded inventory cannot prove. */
  it('omits an intercepted page shell outside a named slot', () => {
    const pagePath = '/workspace/app/feed/(..)photo/[id]/page.tsx';
    expect(
      collectPreviewInspectorNextAppLayoutChain({
        exportName: 'default',
        pagePath,
        sourcePaths: [pagePath, '/workspace/app/layout.tsx'],
      }),
    ).toBeUndefined();
  });

  /** A sibling slot does not invalidate a page proven to occupy the ordinary children branch. */
  it('keeps an ordinary page shell when parallel slots are only siblings', () => {
    const pagePath = '/workspace/app/dashboard/page.tsx';
    const result = collectPreviewInspectorNextAppLayoutChain({
      exportName: 'default',
      pagePath,
      sourcePaths: [
        pagePath,
        '/workspace/app/layout.tsx',
        '/workspace/app/dashboard/layout.tsx',
        '/workspace/app/dashboard/@modal/default.tsx',
      ],
    });

    expect(result?.layouts.map((layout) => layout.sourcePath)).toEqual([
      '/workspace/app/layout.tsx',
      '/workspace/app/dashboard/layout.tsx',
    ]);
    expect(result?.routeLocation.pathname).toBe('/dashboard');
  });

  /** Requires a real root layout so similarly named framework-neutral folders remain untouched. */
  it('ignores page conventions without a Next root layout', () => {
    expect(
      collectPreviewInspectorNextAppLayoutChain({
        exportName: 'default',
        pagePath: '/workspace/app/profile/page.tsx',
        sourcePaths: ['/workspace/app/profile/page.tsx'],
      }),
    ).toBeUndefined();
  });

  /** Keeps named helper exports in a page module out of the implicit route wrapper. */
  it('ignores a named export from an otherwise valid page module', () => {
    expect(
      collectPreviewInspectorNextAppLayoutChain({
        exportName: 'ProfileCard',
        pagePath: '/workspace/app/profile/page.tsx',
        sourcePaths: ['/workspace/app/layout.tsx', '/workspace/app/profile/page.tsx'],
      }),
    ).toBeUndefined();
  });
});
