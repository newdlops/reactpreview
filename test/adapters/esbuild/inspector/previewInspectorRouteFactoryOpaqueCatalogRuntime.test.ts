/** Compares source-proven and runtime-only route catalogs without executing a user project. */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createVariableRouteFactoryFixture } from './previewInspectorVariableRouteFactoryFixture';
import { renderVariableRouteFactoryCase } from './previewInspectorVariableRouteFactoryRuntime';

const catalogs = [
  { name: 'imported-json', source: undefined },
  { name: 'runtime-literal', source: 'export const pagePaths = { ListPage: "/feature" };' },
  {
    name: 'runtime-json-parse',
    source: `export const pagePaths = JSON.parse(${JSON.stringify(JSON.stringify({ ListPage: '/feature' }))});`,
  },
  {
    name: 'runtime-json-unmatched',
    source: `export const pagePaths = JSON.parse(${JSON.stringify(JSON.stringify({ ListPage: '/feature/other' }))});`,
  },
] as const;

describe('route factory runtime-only catalog preservation', () => {
  it.each(catalogs.flatMap((catalog) => [false, true].map((frozen) => ({ ...catalog, frozen }))))(
    '$name keeps authored index output and Provider (frozen: $frozen)',
    async (variant) => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'factory-runtime-catalog-'));
      try {
        const fixture = await createVariableRouteFactoryFixture(root, {
          wrapCallbacks: false,
          sourceOverrides: {
            'src/app.tsx': [
              "import { Route, Routes } from 'react-router-dom';",
              "import { createAppModule } from './create-app-module';",
              "import { ListPage } from './pages/list-page';",
              "import { ManagementProvider } from './management/provider';",
              "import { NotFound } from './not-found';",
              "export const FeatureApp = createAppModule('/feature', { ListPage }, [],",
              '({ entries: ownRoutes }) => <ManagementProvider><main>OUTER_LAYOUT_MARKER<Routes>{ownRoutes}<Route path="*" element={<NotFound />} /></Routes></main></ManagementProvider>);',
            ].join('\n'),
            'src/pages.json': JSON.stringify(
              variant.source === undefined ? { feature: { index: 'ListPage' } } : {},
            ),
            ...(variant.source === undefined ? {} : { 'src/page-map.ts': variant.source }),
            'src/pages/list-page.tsx': [
              "import { useContext } from 'react';",
              "import { ManagedContext } from '../management/provider';",
              "export function ListPage() { if (!useContext(ManagedContext)) throw new Error('Authored catalog Provider lost'); return <p>LIST_PAGE_MARKER</p>; }",
            ].join('\n'),
          },
        });
        const branch = await fixture.collect();
        if (variant.source !== undefined) {
          expect(branch.branches.every((item) => item.selectable === false)).toBe(true);
        }
        const result = await renderVariableRouteFactoryCase(fixture, {
          name: `opaque-catalog-${variant.name}-${variant.frozen.toString()}`,
          frozen: variant.frozen,
          marker: 'LIST_PAGE_MARKER',
        });
        const diagnostic = JSON.stringify({
          html: result.html,
          entry: result.initialEntry,
          bundledPageMarkers: result.bundledPageMarkers,
          warnings: result.warnings,
        });
        expect(result.bundledPageMarkers, diagnostic).toContain('LIST_PAGE_MARKER');
        const authoredFallback = variant.name === 'runtime-json-unmatched';
        expect(result.html, diagnostic).toContain(
          authoredFallback ? 'NOT_FOUND_MARKER' : 'LIST_PAGE_MARKER',
        );
        expect(result.html).toContain('OUTER_LAYOUT_MARKER');
        expect(result.html).toContain('INNER_PROVIDER_MARKER');
        expect(result.html).not.toContain(
          authoredFallback ? 'LIST_PAGE_MARKER' : 'NOT_FOUND_MARKER',
        );
        if (!variant.frozen) expect(result.fallbackHtml).toContain('NOT_FOUND_MARKER');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
