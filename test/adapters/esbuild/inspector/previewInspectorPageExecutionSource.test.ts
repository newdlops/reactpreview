import { describe, expect, it } from 'vitest';
import { createPreviewInspectorPageExecutionSource } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionSource';
import type { PreviewInspectorPageExecutionCandidate } from '../../../../src/adapters/esbuild/inspector/previewInspectorPageExecutionTypes';

describe('createPreviewInspectorPageExecutionSource', () => {
  it('uses only exact composition modes and routes sliced surfaces through virtual specifiers', () => {
    const candidate = {
      compositionEdges: [
        {
          childSurfaceId: 'page',
          mode: 'route-outlet',
          parentSurfaceId: 'route',
          placementIndex: 0,
        },
        {
          childSurfaceId: 'target',
          mode: 'component-prop-slot',
          parentSurfaceId: 'page',
          placementIndex: 0,
          slotName: 'content',
        },
        {
          childSurfaceId: 'header',
          mode: 'sibling-before',
          parentSurfaceId: 'page',
          placementIndex: 0,
        },
      ],
      criticalSurfaces: [
        {
          bypassedWrapperNames: [],
          exportName: 'Route',
          id: 'route',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/Route.tsx',
          strategy: 'authentic-module-export',
          watchSourcePaths: [],
        },
        {
          bypassedWrapperNames: [],
          exportName: 'default',
          id: 'page',
          omittedTopLevelEffectCount: 2,
          sourcePath: '/workspace/Page.tsx',
          strategy: 'selected-export-slice',
          watchSourcePaths: [],
        },
        {
          bypassedWrapperNames: [],
          exportName: 'Target',
          id: 'target',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/Target.tsx',
          strategy: 'authentic-module-export',
          watchSourcePaths: [],
        },
        {
          bypassedWrapperNames: [],
          exportName: 'Header',
          id: 'header',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/Header.tsx',
          strategy: 'authentic-module-export',
          watchSourcePaths: [],
        },
      ],
    } as unknown as PreviewInspectorPageExecutionCandidate;

    const source = createPreviewInspectorPageExecutionSource({
      candidate,
      target: { exportName: 'Target', sourcePath: '/workspace/Target.tsx' },
    });

    expect(source).toContain('react-preview:page-surface/page');
    expect(source).toContain('React.createElement(Surface0, null');
    expect(source).toContain('"content": React.createElement(Surface2, null)');
    expect(source).toContain('react-preview:inspector-target-facade');
    expect(source).toContain('Surface3');
    expect(source).not.toContain('ShellBoundary');
  });

  it('installs a generic selected route without importing a route registry or executing loaders', () => {
    const candidate = {
      browserCandidate: { id: 'selected' },
      compositionEdges: [],
      criticalSurfaces: [
        {
          bypassedWrapperNames: [],
          exportName: 'default',
          id: 'page',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/Page.tsx',
          strategy: 'authentic-module-export',
          watchSourcePaths: [],
        },
      ],
      routeRecipe: {
        kind: 'generic-memory-location',
        loaderPolicy: 'never-execute',
        mounts: [],
        params: {},
        pattern: '/orders/:id',
        pathname: '/orders/42',
        rootOwnsRouter: false,
        searchParams: { filter: ['open', 'mine'] },
      },
    } as unknown as PreviewInspectorPageExecutionCandidate;

    const source = createPreviewInspectorPageExecutionSource({
      candidate,
      target: { exportName: 'default', sourcePath: '/workspace/Page.tsx' },
    });

    expect(source).toContain('react-preview:inspector-page-route-state');
    expect(source).not.toContain('useLayoutEffect');
    expect(source).not.toContain('loader(');
    expect(source).not.toContain('action(');
  });

  it('publishes bounded Next route state and composes a Pages `_app` Component surface', () => {
    const candidate = {
      compositionEdges: [
        {
          childSurfaceId: 'page',
          mode: 'component-prop-slot',
          parentSurfaceId: 'app',
          placementIndex: 0,
          slotName: 'Component',
        },
      ],
      criticalSurfaces: [
        {
          bypassedWrapperNames: [],
          exportName: 'default',
          id: 'app',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/pages/_app.tsx',
          strategy: 'framework-page-surface',
          watchSourcePaths: [],
        },
        {
          bypassedWrapperNames: [],
          exportName: 'default',
          id: 'page',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/pages/products/[id].tsx',
          strategy: 'authentic-module-export',
          watchSourcePaths: [],
        },
      ],
      routeRecipe: {
        kind: 'next-pages',
        loaderPolicy: 'never-execute',
        mounts: [],
        params: { id: '42' },
        pattern: '/products/[id]',
        pathname: '/products/42',
        rootOwnsRouter: false,
        searchParams: {},
      },
    } as unknown as PreviewInspectorPageExecutionCandidate;

    const source = createPreviewInspectorPageExecutionSource({
      candidate,
      target: { exportName: 'default', sourcePath: '/workspace/pages/products/[id].tsx' },
    });

    expect(source).toContain('react-preview:inspector-page-route-state');
    expect(source).toContain('"Component": () => React.createElement(Surface1, null)');
    expect(source).toContain('"pageProps": {}');
    expect(source).not.toContain('route registry');
  });

  it('creates only the selected React Router v6 branch and no application registry', () => {
    const candidate = {
      compositionEdges: [],
      criticalSurfaces: [
        {
          bypassedWrapperNames: [],
          exportName: 'default',
          id: 'layout',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/Layout.tsx',
          strategy: 'authentic-module-export',
          watchSourcePaths: [],
        },
        {
          bypassedWrapperNames: [],
          exportName: 'default',
          id: 'page',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/Page.tsx',
          strategy: 'authentic-module-export',
          watchSourcePaths: [],
        },
      ],
      routeRecipe: {
        kind: 'react-router-v6',
        loaderPolicy: 'never-execute',
        params: {},
        pattern: '/orders/:id',
        pathname: '/orders/42',
        rootOwnsRouter: false,
        searchParams: {},
        routerModuleSpecifier: 'react-router',
        mounts: [
          {
            basePath: '/',
            childSurfaceId: 'page',
            hasWildcardFallback: false,
            parentSurfaceId: 'layout',
            pattern: '/orders/:id',
          },
        ],
      },
    } as unknown as PreviewInspectorPageExecutionCandidate;

    const source = createPreviewInspectorPageExecutionSource({
      candidate,
      target: { exportName: 'default', sourcePath: '/workspace/Page.tsx' },
    });

    expect(source).toContain("import { MemoryRouter, Route, Routes } from 'react-router';");
    expect(source).toContain('initialEntries: ["/orders/42"]');
    expect(source).toContain('path: "/orders/:id"');
    expect(source).toContain('React.createElement(Routes, null');
    expect(source).not.toContain('RouteRegistry');
    expect(source).not.toContain('loader:');
  });

  it('places an inline route wrapper and leaf page inside exactly one generated Router', () => {
    const candidate = {
      browserCandidate: { id: 'selected-leaf' },
      compositionEdges: [
        {
          childSurfaceId: 'page',
          mode: 'children-slot',
          parentSurfaceId: 'layout',
          placementIndex: 0,
        },
      ],
      criticalSurfaces: [
        {
          bypassedWrapperNames: [],
          exportName: 'default',
          id: 'layout',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/RouteLayout.tsx',
          strategy: 'selected-export-slice',
          watchSourcePaths: [],
        },
        {
          bypassedWrapperNames: [],
          exportName: 'default',
          id: 'page',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/SelectedPage.tsx',
          strategy: 'authentic-module-export',
          watchSourcePaths: [],
        },
      ],
      routeRecipe: {
        kind: 'react-router-v6',
        loaderPolicy: 'never-execute',
        mounts: [],
        params: { selectedId: '42' },
        pattern: '/selected/:selectedId(\\d+)',
        pathname: '/selected/42',
        rootOwnsRouter: false,
        routerModuleSpecifier: 'react-router-dom',
        searchParams: { tab: 'details' },
      },
    } as unknown as PreviewInspectorPageExecutionCandidate;

    const source = createPreviewInspectorPageExecutionSource({
      candidate,
      target: { exportName: 'Target', sourcePath: '/workspace/App.tsx' },
    });

    expect(source).toContain(
      'element: React.createElement(Surface0, null, React.createElement(Surface1, null))',
    );
    expect(source).toContain('initialEntries: ["/selected/42?tab=details"]');
    expect(source).toContain('path: "/selected/:selectedId"');
    expect(source).not.toContain('index: true');
    expect(source.match(/React\.createElement\(MemoryRouter/gu)).toHaveLength(1);
    expect(source).not.toContain('RouterProvider');
    expect(source).not.toContain('react-preview:inspector-target-facade');
  });

  it('does not nest a generated MemoryRouter around an authored React Router root', () => {
    const candidate = {
      compositionEdges: [],
      criticalSurfaces: [
        {
          bypassedWrapperNames: [],
          exportName: 'default',
          id: 'app',
          omittedTopLevelEffectCount: 0,
          sourcePath: '/workspace/App.tsx',
          strategy: 'authentic-module-export',
          watchSourcePaths: [],
        },
      ],
      routeRecipe: {
        kind: 'react-router-v6',
        loaderPolicy: 'never-execute',
        mounts: [],
        params: {},
        pattern: '/selected',
        pathname: '/selected',
        rootOwnsRouter: true,
        routerModuleSpecifier: 'react-router-dom',
        searchParams: {},
      },
    } as unknown as PreviewInspectorPageExecutionCandidate;

    const source = createPreviewInspectorPageExecutionSource({
      candidate,
      target: { exportName: 'default', sourcePath: '/workspace/App.tsx' },
    });

    expect(source).toContain('react-preview:inspector-page-route-state');
    expect(source).toContain('return React.createElement(Surface0, null)');
    expect(source).not.toContain('MemoryRouter');
    expect(source).not.toContain('React.createElement(Routes');
  });
});
