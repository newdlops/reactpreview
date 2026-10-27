/** Preserves filtered nested Route slots and their real authored Provider through owner composition. */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createVariableRouteFactoryFixture } from './previewInspectorVariableRouteFactoryFixture';
import { renderVariableRouteFactoryCase } from './previewInspectorVariableRouteFactoryRuntime';

describe('filtered factory route owner runtime', () => {
  it('renders a selected page below the authored nested outlet and Provider', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'filtered-factory-owner-'));
    try {
      const fixture = await createVariableRouteFactoryFixture(root, {
        wrapCallbacks: false,
        sourceOverrides: {
          'src/app.tsx': [
            "import { Outlet, Route, Routes } from 'react-router-dom';",
            "import { createAppModule } from './create-app-module';",
            "import { ListPage } from './pages/list-page';",
            "import { ManagementProvider } from './management/provider';",
            "import { NotFound } from './not-found';",
            'function Group() { return <ManagementProvider><main>OUTER_LAYOUT_MARKER<Outlet /></main></ManagementProvider>; }',
            "export const FeatureApp = createAppModule('/feature', { ListPage }, [], ({ entries: routes }) => {",
            '  const selected = routes.filter(route => route.key === "ListPage");',
            '  return <Routes><Route element={<Group />}>{selected}</Route><Route path="*" element={<NotFound />} /></Routes>;',
            '});',
          ].join('\n'),
          'src/pages.json': JSON.stringify({ feature: { index: 'ListPage' } }),
          'src/pages/list-page.tsx': [
            "import { useContext } from 'react';",
            "import { ManagedContext } from '../management/provider';",
            "export function ListPage() { if (!useContext(ManagedContext)) throw new Error('Authored owner Provider lost'); return <p>LIST_PAGE_MARKER</p>; }",
          ].join('\n'),
        },
      });
      const inventory = await fixture.collect();
      expect(
        inventory.primary?.routeMounts?.find((mount) => mount.exportName === 'FeatureApp')
          ?.routeSlotCount,
      ).toBe(1);
      const result = await renderVariableRouteFactoryCase(fixture, {
        name: 'filtered-nested-provider',
        selection: 'ListPage',
        marker: 'LIST_PAGE_MARKER',
        frozen: true,
      });
      expect(result.html).toContain('LIST_PAGE_MARKER');
      expect(result.html).toContain('OUTER_LAYOUT_MARKER');
      expect(result.html).toContain('INNER_PROVIDER_MARKER');
      expect(result.html).not.toContain('NOT_FOUND_MARKER');
      expect(result.warnings.some((warning) => warning.includes('No routes matched'))).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
