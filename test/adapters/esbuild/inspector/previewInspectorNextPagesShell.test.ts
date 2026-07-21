/** Verifies strict filesystem discovery of the implicit Next.js Pages Router application shell. */
import { describe, expect, it } from 'vitest';
import { collectPreviewInspectorNextPagesShell } from '../../../../src/adapters/esbuild/inspector/previewInspectorNextPagesShell';

describe('collectPreviewInspectorNextPagesShell', () => {
  /** Connects a nested index page to the nearest same-project `_app` and filesystem route. */
  it('discovers the app wrapper and materializes a short dynamic pathname', () => {
    const pagePath = '/workspace/projects/web/pages/company/[companyId]/index.tsx';
    const appPath = '/workspace/projects/web/pages/_app.tsx';

    const shell = collectPreviewInspectorNextPagesShell({
      exportName: 'default',
      pagePath,
      sourcePaths: [pagePath, appPath, '/workspace/projects/other/pages/_app.tsx'],
    });

    expect(shell).toEqual({
      app: { exportName: 'default', sourcePath: appPath },
      routeLocation: {
        componentName: 'NextPagesPage',
        evidenceKind: 'next-pages-filesystem',
        pathname: '/company/companyId',
        pattern: '/company/[companyId]',
        sourcePath: pagePath,
      },
    });
  });

  /** Keeps ordinary pages folders, API endpoints, and the special app module framework-neutral. */
  it('fails closed without an exact eligible page and sibling app convention', () => {
    const pagePath = '/workspace/src/pages/report.tsx';

    expect(
      collectPreviewInspectorNextPagesShell({
        exportName: 'default',
        pagePath,
        sourcePaths: [pagePath],
      }),
    ).toBeUndefined();
    expect(
      collectPreviewInspectorNextPagesShell({
        exportName: 'default',
        pagePath: '/workspace/pages/api/report.ts',
        sourcePaths: ['/workspace/pages/api/report.ts', '/workspace/pages/_app.tsx'],
      }),
    ).toBeUndefined();
    expect(
      collectPreviewInspectorNextPagesShell({
        exportName: 'default',
        pagePath: '/workspace/pages/_app.tsx',
        sourcePaths: ['/workspace/pages/_app.tsx'],
      }),
    ).toBeUndefined();
  });
});
