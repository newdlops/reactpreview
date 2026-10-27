/** Renders unresolved factory owners through the production frozen root and the real Router. */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createVariableRouteFactoryFixture } from './previewInspectorVariableRouteFactoryFixture';
import { renderVariableRouteFactoryCase } from './previewInspectorVariableRouteFactoryRuntime';

describe('unresolved factory owner real-Router context', () => {
  it.each(['/feature', '/feature/', '/feature//', '/'])(
    'renders the authored index and Provider at base %s',
    async (basePath) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'factory-owner-context-'));
      try {
        const absoluteIndex = basePath.replace(/\/+$/u, '') || '/';
        const fixture = await createVariableRouteFactoryFixture(root, {
          wrapCallbacks: false,
          sourceOverrides: {
            'src/app.tsx': [
              "import { Route, Routes } from 'react-router-dom';",
              "import { createAppModule } from './create-app-module';",
              "import { ListPage } from './pages/list-page';",
              "import { ManagementProvider } from './management/provider';",
              "import { NotFound } from './not-found';",
              'function readOverrides() { return {}; }',
              'const pages = { ListPage, ...readOverrides() };',
              `export const FeatureApp = createAppModule(${JSON.stringify(basePath)}, pages, [],`,
              '({ entries: ownRoutes }) => <ManagementProvider><main>OUTER_LAYOUT_MARKER<Routes>{ownRoutes}<Route path="*" element={<NotFound />} /></Routes></main></ManagementProvider>);',
            ].join('\n'),
            // The opaque page-map spread cannot prove a selectable page. Its original slots
            // remain authored runtime code, with a real catalog and no fabricated branch choice.
            'src/pages.json': JSON.stringify(
              absoluteIndex === '/' ? { index: 'ListPage' } : { feature: { index: 'ListPage' } },
            ),
            'src/pages/list-page.tsx': [
              "import { useContext } from 'react';",
              "import { ManagedContext } from '../management/provider';",
              "export function ListPage() { if (!useContext(ManagedContext)) throw new Error('Authored owner Provider lost'); return <p>LIST_PAGE_MARKER</p>; }",
            ].join('\n'),
          },
        });
        const branch = await fixture.collect();
        expect(branch.primary?.componentName).toBe('FeatureApp');
        expect(branch.branches.every((item) => item.selectable === false)).toBe(true);

        const result = await renderVariableRouteFactoryCase(fixture, {
          name: `unresolved-owner-${basePath}`,
          frozen: true,
          marker: 'LIST_PAGE_MARKER',
        });
        expect(
          result.html,
          JSON.stringify({ html: result.html, warnings: result.warnings }),
        ).toContain('LIST_PAGE_MARKER');
        expect(result.html).toContain('OUTER_LAYOUT_MARKER');
        expect(result.html).toContain('INNER_PROVIDER_MARKER');
        expect(result.html).toContain('data-audit-provider="true"');
        expect(result.html).not.toContain('NOT_FOUND_MARKER');
        expect(result.warnings.some((message) => message.includes('No routes matched'))).toBe(
          false,
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
